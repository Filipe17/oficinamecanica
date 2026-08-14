"""
caixa.py — Módulo de Caixa com autenticação PRÓPRIA (independente do ERP).

O caixa abre numa aba separada e faz login com um usuário de perfil "caixa"
(ou outro com permissão de caixa). A autenticação NÃO usa o cookie de sessão
do ERP — usa um token assinado enviado no cabeçalho X-Caixa-Token. Assim, o
login do admin e o do caixa ficam desvinculados (sair de um não desloga o
outro), mas os dois conversam com o MESMO banco de dados.
"""

from flask import Blueprint, request, jsonify, current_app
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from database.database import query, now, registrar_log
from api.usuarios import _autenticar, login_obrigatorio, perfil_permitido
from flask import session
from api.configuracoes import obter_config

caixa_bp = Blueprint("caixa", __name__)

TOKEN_VALIDADE = 60 * 60 * 12   # 12 horas


# ---------------------------------------------------------------- auth própria
def _serializer():
    return URLSafeTimedSerializer(current_app.secret_key, salt="caixa-token")


def _tem_acesso(perfil):
    if perfil == "administrador":
        return True
    from api.permissoes import nivel_de
    return nivel_de(perfil, "caixa") > 0


def _operador():
    """Identifica o operador do caixa pelo token do cabeçalho (não pelo cookie)."""
    token = request.headers.get("X-Caixa-Token", "")
    if not token:
        return None
    try:
        dados = _serializer().loads(token, max_age=TOKEN_VALIDADE)
    except (BadSignature, SignatureExpired):
        return None
    u = query("SELECT id, nome, perfil FROM usuarios WHERE id=? AND ativo=1",
              (dados.get("uid"),), fetchone=True)
    if u and _tem_acesso(u["perfil"]):
        return u
    return None


def _config_empresa():
    c = obter_config()
    return {"empresa_nome": c.get("empresa_nome"), "empresa_logo": c.get("empresa_logo")}


# ------------------------------------------------------------------- login
@caixa_bp.route("/api/caixa/login", methods=["POST"])
def caixa_login():
    d = request.get_json(force=True)
    u = _autenticar(d.get("email", ""), d.get("senha", ""))
    if not u:
        return jsonify({"erro": "E-mail ou senha inválidos"}), 401
    if not _tem_acesso(u["perfil"]):
        return jsonify({"erro": "Este usuário não tem acesso ao caixa"}), 403
    token = _serializer().dumps({"uid": u["id"]})
    return jsonify({"ok": True, "token": token, "nome": u["nome"], "config": _config_empresa()})


# --------------------------------------------------------------- caixa helpers
def _aberto(uid):
    return query("SELECT * FROM caixa WHERE usuario_id=? AND status='aberto' "
                 "ORDER BY id DESC LIMIT 1", (uid,), fetchone=True)


def _soma(caixa_id, tipo):
    return query("SELECT COALESCE(SUM(valor),0) AS t FROM caixa_mov "
                 "WHERE caixa_id=? AND tipo=?", (caixa_id, tipo), fetchone=True)["t"]


def _totais(caixa):
    cid = caixa["id"]
    recebimentos = _soma(cid, "recebimento")
    suprimentos = _soma(cid, "suprimento")
    sangrias = _soma(cid, "sangria")
    vendas = query("SELECT COALESCE(SUM(total),0) AS t FROM vendas WHERE caixa_id=?",
                   (cid,), fetchone=True)["t"]
    abertura = caixa["valor_abertura"] or 0
    saldo = abertura + recebimentos + vendas + suprimentos - sangrias
    return {"abertura": abertura, "recebimentos": recebimentos, "vendas": vendas,
            "suprimentos": suprimentos, "sangrias": sangrias, "saldo": saldo}


# ------------------------------------------------------------------- rotas
@caixa_bp.route("/api/caixa/status", methods=["GET"])
def status():
    op = _operador()
    if not op:
        return jsonify({"erro": "Sessão de caixa inválida"}), 401
    caixa = _aberto(op["id"])
    return jsonify({
        "aberto": bool(caixa),
        "caixa": caixa,
        "totais": _totais(caixa) if caixa else None,
        "operador": op["nome"],
        "config": _config_empresa(),
    })


@caixa_bp.route("/api/caixa/abrir", methods=["POST"])
def abrir():
    op = _operador()
    if not op:
        return jsonify({"erro": "Sessão de caixa inválida"}), 401
    if _aberto(op["id"]):
        return jsonify({"erro": "Você já tem um caixa aberto"}), 400
    d = request.get_json(force=True)
    res = query("INSERT INTO caixa (usuario_id, valor_abertura, aberto_em, status) "
                "VALUES (?,?,?, 'aberto')",
                (op["id"], float(d.get("valor_abertura", 0) or 0), now()), commit=True)
    registrar_log(op["id"], "abrir_caixa", str(res["_lastid"]))
    return jsonify({"ok": True, "id": res["_lastid"]})


@caixa_bp.route("/api/caixa/movimento", methods=["POST"])
def movimento():
    op = _operador()
    if not op:
        return jsonify({"erro": "Sessão de caixa inválida"}), 401
    caixa = _aberto(op["id"])
    if not caixa:
        return jsonify({"erro": "Nenhum caixa aberto"}), 400
    d = request.get_json(force=True)
    if d.get("tipo") not in ("sangria", "suprimento"):
        return jsonify({"erro": "Tipo inválido"}), 400
    valor = float(d.get("valor", 0) or 0)
    if valor <= 0:
        return jsonify({"erro": "Informe um valor válido"}), 400
    query("INSERT INTO caixa_mov (caixa_id, tipo, valor, motivo, criado_em) VALUES (?,?,?,?,?)",
          (caixa["id"], d["tipo"], valor, d.get("motivo"), now()), commit=True)
    registrar_log(op["id"], f"caixa_{d['tipo']}", str(valor))
    return jsonify({"ok": True, "totais": _totais(caixa)})


@caixa_bp.route("/api/caixa/receber", methods=["GET"])
def cobrancas_abertas():
    op = _operador()
    if not op:
        return jsonify({"erro": "Sessão de caixa inválida"}), 401
    lista = query(
        "SELECT f.id, f.descricao, f.valor, f.vencimento, f.status, f.os_id, "
        "c.nome AS cliente_nome FROM financeiro f "
        "LEFT JOIN clientes c ON c.id=f.cliente_id "
        "WHERE f.tipo='receber' AND f.status IN ('aberto','atrasado') "
        "ORDER BY f.id DESC")
    return jsonify({"dados": lista})


@caixa_bp.route("/api/caixa/cartao-calcular", methods=["POST"])
def cartao_calcular():
    """Calcula taxa e líquido do cartão usando a sessão do caixa (token próprio)."""
    op = _operador()
    if not op:
        return jsonify({"erro": "Sessão de caixa inválida"}), 401
    from api.cartao import taxa_aplicavel
    d = request.get_json(force=True)
    valor = float(d.get("valor") or 0)
    t = taxa_aplicavel(d.get("modalidade"), d.get("parcelas"), d.get("bandeira") or None)
    pct = float(t["percentual"]) if t else 0.0
    desconto = round(valor * pct / 100, 2)
    return jsonify({"percentual": pct, "desconto": desconto,
                    "valor_liquido": round(valor - desconto, 2),
                    "sem_taxa_cadastrada": t is None})


@caixa_bp.route("/api/caixa/receber/<int:fid>", methods=["POST"])
def receber(fid):
    op = _operador()
    if not op:
        return jsonify({"erro": "Sessão de caixa inválida"}), 401
    caixa = _aberto(op["id"])
    if not caixa:
        return jsonify({"erro": "Abra o caixa antes de receber"}), 400
    reg = query("SELECT * FROM financeiro WHERE id=? AND tipo='receber'", (fid,), fetchone=True)
    if not reg:
        return jsonify({"erro": "Cobrança não encontrada"}), 404
    if reg["status"] == "pago":
        return jsonify({"erro": "Esta cobrança já foi recebida"}), 400
    d = request.get_json(force=True)
    forma = d.get("forma_pagamento")
    if not forma:
        return jsonify({"erro": "Escolha a forma de pagamento"}), 400
    valor_pago = float(d.get("valor_pago", reg["valor"]) or 0)

    # Dados de cartão (quando a forma for cartão): grava bandeira/parcelas/taxa
    # e o valor líquido para alimentar o controle de vendas no cartão.
    if forma == "cartao":
        from api.cartao import taxa_aplicavel
        modalidade = d.get("cartao_modalidade") or "credito"
        parcelas = int(d.get("cartao_parcelas") or 1)
        bandeira = d.get("cartao_bandeira") or None
        t = taxa_aplicavel(modalidade, parcelas, bandeira)
        pct = float(t["percentual"]) if t else 0.0
        liquido = round(valor_pago - (valor_pago * pct / 100), 2)
        query("UPDATE financeiro SET status='pago', valor_pago=?, pago_em=?, forma_pagamento=?, "
              "cartao_bandeira=?, cartao_modalidade=?, cartao_parcelas=?, cartao_taxa=?, "
              "cartao_valor_liquido=? WHERE id=?",
              (valor_pago, now(), forma, bandeira, modalidade, parcelas, pct, liquido, fid),
              commit=True)
    else:
        query("UPDATE financeiro SET status='pago', valor_pago=?, pago_em=?, forma_pagamento=? WHERE id=?",
              (valor_pago, now(), forma, fid), commit=True)
    motivo = f"{reg['descricao'] or 'Recebimento'} ({forma})"
    query("INSERT INTO caixa_mov (caixa_id, tipo, valor, motivo, criado_em) VALUES (?,?,?,?,?)",
          (caixa["id"], "recebimento", valor_pago, motivo, now()), commit=True)
    registrar_log(op["id"], "caixa_receber", f"fin {fid} {forma} {valor_pago}")
    return jsonify({"ok": True, "totais": _totais(caixa)})


@caixa_bp.route("/api/caixa/fechar", methods=["POST"])
def fechar():
    op = _operador()
    if not op:
        return jsonify({"erro": "Sessão de caixa inválida"}), 401
    caixa = _aberto(op["id"])
    if not caixa:
        return jsonify({"erro": "Nenhum caixa aberto"}), 400
    d = request.get_json(force=True)
    t = _totais(caixa)
    informado = float(d.get("valor_informado", t["saldo"]) or 0)
    diferenca = round(informado - t["saldo"], 2)
    query("UPDATE caixa SET status='fechado', fechado_em=?, valor_fechamento=? WHERE id=?",
          (now(), informado, caixa["id"]), commit=True)
    registrar_log(op["id"], "fechar_caixa", str(caixa["id"]))
    qtd_receb = query("SELECT COUNT(*) AS n FROM caixa_mov WHERE caixa_id=? AND tipo='recebimento'",
                      (caixa["id"],), fetchone=True)["n"]
    relatorio = dict(t)
    relatorio.update({"esperado": t["saldo"], "informado": informado, "diferenca": diferenca,
                      "qtd_recebimentos": qtd_receb, "aberto_em": caixa["aberto_em"], "fechado_em": now()})
    return jsonify({"ok": True, "relatorio": relatorio})


# =========================================================================
# NFC-e — Cupom Fiscal Eletrônico (esqueleto dual-mode)
# =========================================================================

@caixa_bp.route("/api/nfce/emitir", methods=["POST"])
@login_obrigatorio
@perfil_permitido("administrador", "gerente", "caixa")
def emitir_nfce():
    from api.configuracoes import obter_config
    d = request.get_json(force=True)
    financeiro_id = d.get("financeiro_id")
    cpf_cnpj = d.get("cpf_cnpj_consumidor", "")

    if not financeiro_id:
        return jsonify({"erro": "financeiro_id é obrigatório"}), 400

    cfg = obter_config()
    modo     = cfg.get("nfe_modo", "")
    provedor = cfg.get("nfe_provedor", "")
    token    = cfg.get("nfe_token", "")
    ambiente = cfg.get("nfe_ambiente", "homologacao")

    if cfg.get("nfce_ativo") != "1":
        return jsonify({"erro": "NFC-e não está ativa nas configurações"}), 400

    fin = query("SELECT * FROM financeiro WHERE id=?", (financeiro_id,), fetchone=True)
    if not fin:
        return jsonify({"erro": "Lançamento não encontrado"}), 404

    # ================================================================
    # MODO 1: VIA PROVEDOR (Focus NFe, PlugNotas, NFe.io, eNotas...)
    # ================================================================
    if modo == "provedor":
        if not provedor or not token:
            return jsonify({"erro": "Configure o provedor e token em Configurações"}), 400

        # TODO: descomentar e adaptar conforme o provedor do cliente
        #
        # if provedor == "focus":
        #     import requests
        #     base = "homologacao" if ambiente == "homologacao" else "api"
        #     url = f"https://{base}.focusnfe.com.br/v2/nfce"
        #     payload = {
        #         "cnpj_emitente": cfg.get("empresa_cnpj","").replace(".","").replace("/","").replace("-",""),
        #         "ref": f"nfce_{financeiro_id}",
        #         "consumidor": {"cpf": cpf_cnpj} if cpf_cnpj else {},
        #         "items": [],  # montar com os itens da venda
        #     }
        #     resp = requests.post(url, json=payload, auth=(token, ""))
        #     data = resp.json()
        #     return jsonify({"ok": True, "danfe_url": data.get("danfe_url")})
        #
        # elif provedor == "plugnotas":
        #     import requests
        #     url = "https://api.plugnotas.com.br/nfce"
        #     headers = {"x-api-key": token, "Content-Type": "application/json"}
        #     resp = requests.post(url, json={}, headers=headers)
        #     return jsonify(resp.json())
        #
        # elif provedor == "nfeio":
        #     import requests
        #     url = f"https://api.nfe.io/v1/companies/{cfg.get('empresa_cnpj','')}/consumernotes"
        #     resp = requests.post(url, json={}, headers={"Authorization": token})
        #     return jsonify(resp.json())

        registrar_log(session["user_id"], "nfce_tentativa", f"financeiro={financeiro_id} modo=provedor")
        return jsonify({
            "ok": False,
            "erro": f"Provedor '{provedor}' — implemente em api/caixa.py → emitir_nfce() → MODO 1.",
            "modo": "provedor", "provedor": provedor,
        }), 501

    # ================================================================
    # MODO 2: CERTIFICADO PRÓPRIO A1 — DIRETO COM SEFAZ
    # ================================================================
    elif modo == "certificado":
        cert_b64  = cfg.get("nfe_certificado_pfx", "")
        cert_pass = cfg.get("nfe_certificado_senha", "")

        if not cert_b64:
            return jsonify({"erro": "Certificado A1 não carregado nas configurações"}), 400
        if not cert_pass:
            return jsonify({"erro": "Senha do certificado não configurada"}), 400

        # TODO: implementar emissão direta com SEFAZ
        # Passos:
        # 1. cert_bytes = base64.b64decode(cert_b64.split(",")[1])
        # 2. pfx = load_pkcs12(cert_bytes, cert_pass.encode())  # cryptography
        # 3. xml = _gerar_xml_nfce(fin, cfg, cpf_cnpj)          # layout 4.00
        # 4. signed = XMLSigner().sign(xml, key=pfx.key, ...)   # signxml
        # 5. resp = requests.post(url_sefaz_uf, data=signed)
        # 6. Parsear retorno e gerar DANFE
        #
        # Libs necessárias no requirements.txt:
        #   cryptography, signxml, lxml, requests

        registrar_log(session["user_id"], "nfce_tentativa", f"financeiro={financeiro_id} modo=certificado")
        return jsonify({
            "ok": False,
            "erro": "Certificado A1 configurado — implemente em api/caixa.py → emitir_nfce() → MODO 2.",
            "modo": "certificado",
            "dica": "Libs: cryptography, signxml, lxml",
        }), 501

    return jsonify({"erro": "Configure o modo NF-e em Configurações → Nota Fiscal"}), 400
