"""
caixa.py — Módulo de Caixa integrado ao painel administrativo.

Usa a MESMA sessão, usuários e permissões do painel (sem login próprio).

Fluxo:
  Orçamento finalizado ("Finalizar orçamento") -> o sistema cria uma conta a
  receber em `financeiro` (tipo='receber', os_id = orçamento). O caixa lista
  essas cobranças como "Aguardando pagamento" e, ao receber:
    - grava o recebimento em caixa_pagamentos (+ formas em caixa_pagamento_formas);
    - lança as entradas em caixa_mov (uma por forma de pagamento);
    - marca o financeiro como pago (alimenta o fluxo financeiro/relatórios);
    - marca a OS/orçamento (e as OS vinculadas) com status_pagamento='pago'.
  Nada é apagado: estorno muda o status e lança a saída no caixa aberto.

Permissões (módulo "caixa"): 1 = visualizar, 2 = operar (receber, lançar, fechar).
Estorno: somente administrador e gerente.
"""

from flask import Blueprint, request, jsonify, session
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from database.database import query, now, registrar_log
from api.usuarios import _autenticar, login_obrigatorio, perfil_permitido
from api.configuracoes import obter_config

caixa_bp = Blueprint("caixa", __name__)

FORMAS = ("dinheiro", "pix", "debito", "credito", "transferencia", "outros")
ROTULO_FORMA = {"dinheiro": "Dinheiro", "pix": "Pix", "debito": "Cartão de débito",
                "credito": "Cartão de crédito", "transferencia": "Transferência",
                "outros": "Outros"}
PERFIS_ESTORNO = ("administrador", "gerente")
TOKEN_VALIDADE = 60 * 60 * 12  # 12 horas


# --------------------------------------------------------- token próprio
def _serializer():
    from flask import current_app
    return URLSafeTimedSerializer(current_app.secret_key, salt="caixa-token")


def _tem_acesso(perfil):
    if perfil == "administrador":
        return True
    from api.permissoes import nivel_de
    return nivel_de(perfil, "caixa") > 0


def _operador():
    """Identifica o operador pelo token X-Caixa-Token (não usa cookie do ERP)."""
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


@caixa_bp.route("/api/caixa/login", methods=["POST"])
def caixa_login():
    d = request.get_json(force=True) or {}
    u = _autenticar(d.get("email", ""), d.get("senha", ""))
    if not u:
        return jsonify({"erro": "Usuário ou senha inválidos"}), 401
    if not _tem_acesso(u["perfil"]):
        return jsonify({"erro": "Este usuário não tem acesso ao caixa"}), 403
    token = _serializer().dumps({"uid": u["id"]})
    cfg = obter_config()
    return jsonify({"ok": True, "token": token, "nome": u["nome"],
                    "config": {"empresa_nome": cfg.get("empresa_nome"),
                               "empresa_logo": cfg.get("empresa_logo")}})


# ------------------------------------------------------------- permissões
def _nivel():
    from api.permissoes import nivel_de
    op = _operador()
    if not op: return 0
    return nivel_de(op["perfil"], "caixa")


def _exige(nivel_min):
    """Retorna uma resposta de erro se o usuário não tiver o nível exigido."""
    if _nivel() < nivel_min:
        msg = "Sem permissão para operar o caixa" if nivel_min > 1 else "Sem acesso ao caixa"
        return jsonify({"erro": msg}), 403
    return None


def _uid():
    op = _operador()
    return op["id"] if op else None


def _nome_operador():
    op = _operador()
    return op["nome"] if op else ""


# --------------------------------------------------------------- helpers
def _aberto(uid):
    return query("SELECT * FROM caixa WHERE usuario_id=? AND status='aberto' "
                 "ORDER BY id DESC LIMIT 1", (uid,), fetchone=True)


def _forma_normal(f):
    f = (f or "").lower().strip()
    if f in FORMAS:
        return f
    if f in ("cartao", "cartão"):
        return "credito"
    return "outros"


def _totais(caixa):
    """
    Totais do caixa a partir de caixa_mov (+ vendas do PDV):
      entradas = recebimentos + vendas + suprimentos
      saídas   = sangrias + estornos
    'dinheiro_gaveta' é o que deve existir fisicamente na gaveta.
    """
    cid = caixa["id"]
    movs = query("SELECT tipo, forma_pagamento, COALESCE(SUM(valor),0) AS t, COUNT(*) AS n "
                 "FROM caixa_mov WHERE caixa_id=? GROUP BY tipo, forma_pagamento", (cid,))
    por_forma = {f: 0.0 for f in FORMAS}
    rec = sup = sang = est = 0.0
    est_dinheiro = 0.0
    for m in movs:
        v = float(m["t"] or 0)
        forma = _forma_normal(m["forma_pagamento"])
        if m["tipo"] == "recebimento":
            rec += v
            por_forma[forma] += v
        elif m["tipo"] == "suprimento":
            sup += v
        elif m["tipo"] == "sangria":
            sang += v
        elif m["tipo"] == "estorno":
            est += v
            por_forma[forma] -= v
            if forma == "dinheiro":
                est_dinheiro += v
    vendas_rows = query("SELECT forma_pagamento, COALESCE(SUM(total),0) AS t FROM vendas "
                        "WHERE caixa_id=? GROUP BY forma_pagamento", (cid,))
    vendas = 0.0
    for v in vendas_rows:
        vendas += float(v["t"] or 0)
        por_forma[_forma_normal(v["forma_pagamento"])] += float(v["t"] or 0)
    abertura = float(caixa["valor_abertura"] or 0)
    entradas = rec + vendas + sup
    saidas = sang + est
    qtd = query("SELECT COUNT(*) AS n FROM caixa_pagamentos WHERE caixa_id=?",
                (cid,), fetchone=True)["n"]
    # dinheiro recebido já está líquido de estornos em por_forma["dinheiro"]
    gaveta = abertura + por_forma["dinheiro"] + sup - sang
    return {
        "abertura": round(abertura, 2),
        "recebimentos": round(rec, 2), "vendas": round(vendas, 2),
        "suprimentos": round(sup, 2), "sangrias": round(sang, 2), "estornos": round(est, 2),
        "entradas": round(entradas, 2), "saidas": round(saidas, 2),
        "total_recebido": round(rec + vendas - est, 2),
        "saldo": round(abertura + entradas - saidas, 2),
        "por_forma": {k: round(v, 2) for k, v in por_forma.items()},
        "dinheiro_gaveta": round(gaveta, 2),
        "qtd_transacoes": qtd,
    }


def _restante(fin):
    total = (fin["valor"] or 0) + (fin.get("juros") or 0) + (fin.get("multa") or 0)
    return round(max(total - (fin["valor_pago"] or 0), 0), 2)


SQL_COBRANCA = (
    "SELECT f.id, f.descricao, f.valor, f.valor_pago, f.juros, f.multa, f.status, "
    "f.vencimento, f.os_id, f.cliente_id, f.criado_em, "
    "o.numero AS os_numero, o.data AS os_data, o.desconto AS os_desconto, "
    "c.nome AS cliente_nome, c.cpf_cnpj AS cliente_doc, c.telefone AS cliente_telefone, "
    "c.whatsapp AS cliente_whatsapp, c.email AS cliente_email, "
    "v.marca AS veiculo_marca, v.modelo AS veiculo_modelo, v.placa AS veiculo_placa "
    "FROM financeiro f "
    "JOIN ordens_servico o ON o.id=f.os_id "
    "LEFT JOIN clientes c ON c.id=f.cliente_id "
    "LEFT JOIN veiculos v ON v.id=o.veiculo_id "
)


# ------------------------------------------------------------------ status
@caixa_bp.route("/api/caixa/status", methods=["GET"])
def status():
    erro = _exige(1)
    if erro:
        return erro
    caixa = _aberto(_uid())
    return jsonify({
        "aberto": bool(caixa),
        "caixa": caixa,
        "totais": _totais(caixa) if caixa else None,
        "operador": _nome_operador(),
        "nivel": _nivel(),
        "pode_estornar": ((_operador() or {}).get("perfil")) in PERFIS_ESTORNO,
    })


@caixa_bp.route("/api/caixa/abrir", methods=["POST"])
def abrir():
    erro = _exige(2)
    if erro:
        return erro
    if _aberto(_uid()):
        return jsonify({"erro": "Você já tem um caixa aberto"}), 400
    d = request.get_json(force=True) or {}
    try:
        valor = float(d.get("valor_abertura", 0) or 0)
    except (TypeError, ValueError):
        return jsonify({"erro": "Valor inválido"}), 400
    if valor < 0:
        return jsonify({"erro": "O saldo inicial não pode ser negativo"}), 400
    res = query("INSERT INTO caixa (usuario_id, valor_abertura, aberto_em, status) "
                "VALUES (?,?,?, 'aberto')", (_uid(), valor, now()), commit=True)
    registrar_log(_uid(), "abrir_caixa", f"{res['_lastid']} saldo={valor}")
    return jsonify({"ok": True, "id": res["_lastid"]})


@caixa_bp.route("/api/caixa/movimento", methods=["POST"])
def movimento():
    """Entrada avulsa (suprimento) ou saída (sangria) de dinheiro."""
    erro = _exige(2)
    if erro:
        return erro
    caixa = _aberto(_uid())
    if not caixa:
        return jsonify({"erro": "Nenhum caixa aberto"}), 400
    d = request.get_json(force=True) or {}
    if d.get("tipo") not in ("sangria", "suprimento"):
        return jsonify({"erro": "Tipo inválido"}), 400
    try:
        valor = round(float(d.get("valor", 0) or 0), 2)
    except (TypeError, ValueError):
        return jsonify({"erro": "Valor inválido"}), 400
    if valor <= 0:
        return jsonify({"erro": "Informe um valor válido"}), 400
    motivo = (d.get("motivo") or "").strip()
    if not motivo:
        return jsonify({"erro": "Informe a descrição/motivo"}), 400
    if d["tipo"] == "sangria" and valor > _totais(caixa)["dinheiro_gaveta"] + 0.009:
        return jsonify({"erro": "Saída maior que o dinheiro disponível na gaveta"}), 400
    query("INSERT INTO caixa_mov (caixa_id, tipo, valor, motivo, forma_pagamento, usuario_id, criado_em) "
          "VALUES (?,?,?,?,?,?,?)",
          (caixa["id"], d["tipo"], valor, motivo, "dinheiro", _uid(), now()), commit=True)
    registrar_log(_uid(), f"caixa_{d['tipo']}", f"{valor} {motivo}")
    return jsonify({"ok": True, "totais": _totais(caixa)})


@caixa_bp.route("/api/caixa/movimentos", methods=["GET"])
def movimentos():
    """Movimentações do caixa aberto do operador (extrato do dia)."""
    erro = _exige(1)
    if erro:
        return erro
    caixa = _aberto(_uid())
    if not caixa:
        return jsonify({"dados": []})
    lista = query("SELECT m.*, u.nome AS usuario_nome FROM caixa_mov m "
                  "LEFT JOIN usuarios u ON u.id=m.usuario_id "
                  "WHERE m.caixa_id=? ORDER BY m.id DESC", (caixa["id"],))
    return jsonify({"dados": lista})


# ------------------------------------------------ aguardando pagamento
@caixa_bp.route("/api/caixa/receber", methods=["GET"])
def aguardando():
    """
    Cobranças geradas pelo "Finalizar orçamento" ainda não quitadas.
    Filtros: q (nº OS, cliente, placa), data (YYYY-MM-DD).
    """
    erro = _exige(1)
    if erro:
        return erro
    where = ["f.tipo='receber'", "f.status IN ('aberto','atrasado','parcial')", "f.os_id IS NOT NULL"]
    params = []
    q = (request.args.get("q") or "").strip().lower()
    if q:
        where.append("(LOWER(o.numero) LIKE ? OR LOWER(c.nome) LIKE ? OR "
                     "LOWER(REPLACE(v.placa,'-','')) LIKE ?)")
        params += [f"%{q}%", f"%{q}%", f"%{q.replace('-', '')}%"]
    data = (request.args.get("data") or "").strip()
    if data:
        where.append("substr(f.criado_em,1,10)=?")
        params.append(data)
    lista = query(SQL_COBRANCA + "WHERE " + " AND ".join(where) + " ORDER BY f.id DESC", tuple(params))
    for c in lista:
        c["restante"] = _restante(c)
    return jsonify({"dados": lista})


@caixa_bp.route("/api/caixa/receber/<int:fid>", methods=["GET"])
def detalhe_cobranca(fid):
    """Dados da OS para a tela de recebimento (somente leitura)."""
    erro = _exige(1)
    if erro:
        return erro
    c = query(SQL_COBRANCA + "WHERE f.id=? AND f.tipo='receber'", (fid,), fetchone=True)
    if not c:
        return jsonify({"erro": "Cobrança não encontrada"}), 404
    itens = query("SELECT tipo, descricao, quantidade, valor_unitario, subtotal "
                  "FROM os_itens WHERE os_id=? ORDER BY id", (c["os_id"],))
    servicos = round(sum(i["subtotal"] or 0 for i in itens if i["tipo"] == "servico"), 2)
    pecas = round(sum(i["subtotal"] or 0 for i in itens if i["tipo"] != "servico"), 2)
    c["itens"] = itens
    c["resumo"] = {
        "servicos": servicos, "pecas": pecas,
        "desconto": round(float(c.get("os_desconto") or 0), 2),
        "acrescimo": round(float(c.get("juros") or 0) + float(c.get("multa") or 0), 2),
        "ja_pago": round(float(c.get("valor_pago") or 0), 2),
        "total": _restante(c),
    }
    return jsonify(c)


@caixa_bp.route("/api/caixa/cartao-calcular", methods=["POST"])
def cartao_calcular():
    """Taxa e valor líquido do cartão (usa o cadastro de taxas existente)."""
    erro = _exige(1)
    if erro:
        return erro
    from api.cartao import taxa_aplicavel
    d = request.get_json(force=True) or {}
    valor = float(d.get("valor") or 0)
    t = taxa_aplicavel(d.get("modalidade"), d.get("parcelas"), d.get("bandeira") or None)
    pct = float(t["percentual"]) if t else 0.0
    desconto = round(valor * pct / 100, 2)
    return jsonify({"percentual": pct, "desconto": desconto,
                    "valor_liquido": round(valor - desconto, 2),
                    "sem_taxa_cadastrada": t is None})


@caixa_bp.route("/api/caixa/receber/<int:fid>", methods=["POST"])
def receber(fid):
    """
    Recebe a cobrança de uma OS/orçamento. Corpo:
      { formas: [{forma, valor, valor_recebido?, parcelas?, bandeira?,
                  confirmado?, observacao?}, ...] }
    A soma das formas deve ser exatamente o valor restante da cobrança.
    """
    erro = _exige(2)
    if erro:
        return erro
    uid = _uid()
    caixa = _aberto(uid)
    if not caixa:
        return jsonify({"erro": "Abra o caixa antes de receber"}), 400
    fin = query("SELECT * FROM financeiro WHERE id=? AND tipo='receber'", (fid,), fetchone=True)
    if not fin:
        return jsonify({"erro": "Cobrança não encontrada"}), 404
    if fin["status"] == "pago":
        return jsonify({"erro": "Esta cobrança já foi recebida"}), 400
    total = _restante(fin)
    if total <= 0:
        return jsonify({"erro": "Não há valor a receber nesta cobrança"}), 400

    d = request.get_json(force=True) or {}
    formas_in = d.get("formas") or []
    if not formas_in:
        return jsonify({"erro": "Informe ao menos uma forma de pagamento"}), 400

    formas, soma, troco = [], 0.0, 0.0
    from api.cartao import taxa_aplicavel
    for f in formas_in:
        forma = (f.get("forma") or "").lower()
        if forma not in FORMAS:
            return jsonify({"erro": f"Forma de pagamento inválida: {forma}"}), 400
        try:
            valor = round(float(f.get("valor") or 0), 2)
        except (TypeError, ValueError):
            return jsonify({"erro": "Valor inválido"}), 400
        if valor <= 0:
            return jsonify({"erro": f"Informe o valor em {ROTULO_FORMA[forma]}"}), 400
        item = {"forma": forma, "valor": valor, "valor_recebido": None, "parcelas": 1,
                "bandeira": None, "taxa": 0.0, "valor_liquido": valor,
                "confirmado_por": None, "observacao": (f.get("observacao") or "").strip() or None}
        if forma == "dinheiro":
            recebido = round(float(f.get("valor_recebido") or valor), 2)
            if recebido < valor:
                return jsonify({"erro": "Valor recebido em dinheiro menor que o valor da parte em dinheiro"}), 400
            item["valor_recebido"] = recebido
            troco += recebido - valor
        elif forma in ("pix", "transferencia"):
            if not f.get("confirmado"):
                return jsonify({"erro": f"Confirme o recebimento do {ROTULO_FORMA[forma]} antes de concluir"}), 400
            item["confirmado_por"] = uid
        elif forma in ("debito", "credito"):
            parcelas = int(f.get("parcelas") or 1) if forma == "credito" else 1
            if parcelas < 1 or parcelas > 24:
                return jsonify({"erro": "Número de parcelas inválido"}), 400
            item["parcelas"] = parcelas
            item["bandeira"] = (f.get("bandeira") or "").strip() or None
            t = taxa_aplicavel(forma, parcelas, item["bandeira"])
            pct = float(t["percentual"]) if t else 0.0
            item["taxa"] = pct
            item["valor_liquido"] = round(valor - valor * pct / 100, 2)
        formas.append(item)
        soma += valor

    soma = round(soma, 2)
    if abs(soma - total) > 0.009:
        return jsonify({"erro": f"A soma das formas (R$ {soma:.2f}) deve ser igual ao total "
                                f"(R$ {total:.2f})"}), 400

    # "Trava" a cobrança: só um recebimento vence (evita duplo clique / 2 caixas).
    ja_pago = float(fin["valor_pago"] or 0)
    forma_fin = formas[0]["forma"] if len(formas) == 1 else "misto"
    trava = query("UPDATE financeiro SET status='pago', valor_pago=?, pago_em=?, forma_pagamento=? "
                  "WHERE id=? AND status<>'pago'",
                  (round(ja_pago + soma, 2), now(), forma_fin, fid), commit=True)
    if not trava.get("rowcount"):
        return jsonify({"erro": "Esta cobrança acabou de ser recebida por outro operador"}), 409
    cartoes = [f for f in formas if f["forma"] in ("debito", "credito")]
    if len(formas) == 1 and cartoes:
        c = cartoes[0]
        query("UPDATE financeiro SET cartao_bandeira=?, cartao_modalidade=?, cartao_parcelas=?, "
              "cartao_taxa=?, cartao_valor_liquido=? WHERE id=?",
              (c["bandeira"], c["forma"], c["parcelas"], c["taxa"], c["valor_liquido"], fid),
              commit=True)

    momento = now()
    pag = query("INSERT INTO caixa_pagamentos (caixa_id, financeiro_id, os_id, cliente_id, "
                "usuario_id, valor_total, troco, status, criado_em) VALUES (?,?,?,?,?,?,?, 'pago', ?)",
                (caixa["id"], fid, fin["os_id"], fin["cliente_id"], uid, soma,
                 round(troco, 2), momento), commit=True)
    pid = pag["_lastid"]
    os_reg = query("SELECT numero, os_referencia FROM ordens_servico WHERE id=?",
                   (fin["os_id"],), fetchone=True) if fin["os_id"] else None
    ref = (os_reg or {}).get("numero") or fin["descricao"] or f"Cobrança {fid}"
    for f in formas:
        query("INSERT INTO caixa_pagamento_formas (pagamento_id, forma, valor, valor_recebido, "
              "parcelas, bandeira, taxa, valor_liquido, confirmado_por, observacao) "
              "VALUES (?,?,?,?,?,?,?,?,?,?)",
              (pid, f["forma"], f["valor"], f["valor_recebido"], f["parcelas"], f["bandeira"],
               f["taxa"], f["valor_liquido"], f["confirmado_por"], f["observacao"]), commit=True)
        query("INSERT INTO caixa_mov (caixa_id, tipo, valor, motivo, forma_pagamento, "
              "pagamento_id, usuario_id, criado_em) VALUES (?,?,?,?,?,?,?,?)",
              (caixa["id"], "recebimento", f["valor"], f"Recebimento {ref}", f["forma"],
               pid, uid, momento), commit=True)

    # Situação financeira da OS/orçamento e das OS vinculadas a ele
    if fin["os_id"]:
        ids = [fin["os_id"]]
        try:
            import json as _json
            for r in _json.loads((os_reg or {}).get("os_referencia") or "[]"):
                rid = r.get("id") if isinstance(r, dict) else r
                if rid:
                    ids.append(int(rid))
        except Exception:
            pass
        for oid in ids:
            query("UPDATE ordens_servico SET status_pagamento='pago', pago_em=? WHERE id=?",
                  (momento, oid), commit=True)

    registrar_log(uid, "caixa_receber", f"pag {pid} fin {fid} {forma_fin} {soma:.2f}")
    return jsonify({"ok": True, "pagamento_id": pid, "troco": round(troco, 2),
                    "totais": _totais(caixa)})


# ------------------------------------------------------------- histórico
SQL_PAG = (
    "SELECT p.*, u.nome AS operador_nome, c.nome AS cliente_nome, c.cpf_cnpj AS cliente_doc, "
    "c.telefone AS cliente_telefone, c.whatsapp AS cliente_whatsapp, "
    "o.numero AS os_numero, v.marca AS veiculo_marca, v.modelo AS veiculo_modelo, "
    "v.placa AS veiculo_placa, ue.nome AS estornado_por_nome "
    "FROM caixa_pagamentos p "
    "LEFT JOIN usuarios u ON u.id=p.usuario_id "
    "LEFT JOIN usuarios ue ON ue.id=p.estornado_por "
    "LEFT JOIN clientes c ON c.id=p.cliente_id "
    "LEFT JOIN ordens_servico o ON o.id=p.os_id "
    "LEFT JOIN veiculos v ON v.id=o.veiculo_id "
)


def _formas_de(pids):
    if not pids:
        return {}
    marc = ",".join("?" * len(pids))
    out = {}
    for f in query(f"SELECT f.*, u.nome AS confirmado_por_nome FROM caixa_pagamento_formas f "
                   f"LEFT JOIN usuarios u ON u.id=f.confirmado_por "
                   f"WHERE f.pagamento_id IN ({marc}) ORDER BY f.id", tuple(pids)):
        out.setdefault(f["pagamento_id"], []).append(f)
    return out


@caixa_bp.route("/api/caixa/historico", methods=["GET"])
def historico():
    """Filtros: q (OS/cliente/placa), data_ini, data_fim, forma, status."""
    erro = _exige(1)
    if erro:
        return erro
    where, params = ["1=1"], []
    q = (request.args.get("q") or "").strip().lower()
    if q:
        where.append("(LOWER(o.numero) LIKE ? OR LOWER(c.nome) LIKE ? OR "
                     "LOWER(REPLACE(v.placa,'-','')) LIKE ?)")
        params += [f"%{q}%", f"%{q}%", f"%{q.replace('-', '')}%"]
    if request.args.get("data_ini"):
        where.append("substr(p.criado_em,1,10) >= ?")
        params.append(request.args["data_ini"])
    if request.args.get("data_fim"):
        where.append("substr(p.criado_em,1,10) <= ?")
        params.append(request.args["data_fim"])
    if request.args.get("status") in ("pago", "estornado"):
        where.append("p.status=?")
        params.append(request.args["status"])
    forma = request.args.get("forma")
    if forma in FORMAS:
        where.append("EXISTS (SELECT 1 FROM caixa_pagamento_formas x "
                     "WHERE x.pagamento_id=p.id AND x.forma=?)")
        params.append(forma)
    lista = query(SQL_PAG + "WHERE " + " AND ".join(where) + " ORDER BY p.id DESC LIMIT 300",
                  tuple(params))
    fm = _formas_de([p["id"] for p in lista])
    for p in lista:
        p["formas"] = fm.get(p["id"], [])
    return jsonify({"dados": lista})


@caixa_bp.route("/api/caixa/pagamento/<int:pid>", methods=["GET"])
def detalhe_pagamento(pid):
    erro = _exige(1)
    if erro:
        return erro
    p = query(SQL_PAG + "WHERE p.id=?", (pid,), fetchone=True)
    if not p:
        return jsonify({"erro": "Pagamento não encontrado"}), 404
    p["formas"] = _formas_de([pid]).get(pid, [])
    p["itens"] = query("SELECT tipo, descricao, quantidade, valor_unitario, subtotal "
                       "FROM os_itens WHERE os_id=? ORDER BY id", (p["os_id"],)) if p["os_id"] else []
    return jsonify(p)


@caixa_bp.route("/api/caixa/pagamento/<int:pid>/estornar", methods=["POST"])
@login_obrigatorio
@perfil_permitido(*PERFIS_ESTORNO)
def estornar(pid):
    op = _operador()
    if not op: return jsonify({"erro": "Sessão de caixa inválida"}), 401
    if op["perfil"] not in PERFIS_ESTORNO: return jsonify({"erro": "Sem permissão para estornar"}), 403
    """
    Estorna um recebimento sem apagar nada: o pagamento fica 'estornado'
    (com motivo, usuário e data), a saída é lançada no caixa aberto de quem
    estorna e a cobrança volta a ficar em aberto no caixa.
    """
    uid = _uid()
    caixa = _aberto(uid)
    if not caixa:
        return jsonify({"erro": "Abra o seu caixa para registrar o estorno"}), 400
    d = request.get_json(force=True) or {}
    motivo = (d.get("motivo") or "").strip()
    if len(motivo) < 5:
        return jsonify({"erro": "Informe o motivo do estorno"}), 400
    p = query("SELECT * FROM caixa_pagamentos WHERE id=?", (pid,), fetchone=True)
    if not p:
        return jsonify({"erro": "Pagamento não encontrado"}), 404
    if p["status"] != "pago":
        return jsonify({"erro": "Este pagamento já foi estornado"}), 400
    formas = _formas_de([pid]).get(pid, [])
    din = sum(f["valor"] for f in formas if f["forma"] == "dinheiro")
    if din and din > _totais(caixa)["dinheiro_gaveta"] + 0.009:
        return jsonify({"erro": "Não há dinheiro suficiente na gaveta para devolver este estorno"}), 400
    trava = query("UPDATE caixa_pagamentos SET status='estornado', estornado_por=?, estornado_em=?, "
                  "motivo_estorno=? WHERE id=? AND status='pago'",
                  (uid, now(), motivo, pid), commit=True)
    if not trava.get("rowcount"):
        return jsonify({"erro": "Este pagamento já foi estornado"}), 400
    momento = now()
    os_num = query("SELECT numero FROM ordens_servico WHERE id=?", (p["os_id"],),
                   fetchone=True) if p["os_id"] else None
    ref = (os_num or {}).get("numero") or f"pagamento {pid}"
    for f in formas:
        query("INSERT INTO caixa_mov (caixa_id, tipo, valor, motivo, forma_pagamento, "
              "pagamento_id, usuario_id, criado_em) VALUES (?,?,?,?,?,?,?,?)",
              (caixa["id"], "estorno", f["valor"], f"Estorno {ref}: {motivo}", f["forma"],
               pid, uid, momento), commit=True)
    if p["financeiro_id"]:
        fin = query("SELECT valor_pago FROM financeiro WHERE id=?", (p["financeiro_id"],), fetchone=True)
        restante_pago = round(max(float((fin or {}).get("valor_pago") or 0) - float(p["valor_total"]), 0), 2)
        query("UPDATE financeiro SET status=?, valor_pago=?, pago_em=? WHERE id=?",
              ("parcial" if restante_pago > 0 else "aberto", restante_pago,
               None if restante_pago <= 0 else momento, p["financeiro_id"]), commit=True)
    if p["os_id"]:
        query("UPDATE ordens_servico SET status_pagamento='pendente', pago_em=NULL WHERE id=?",
              (p["os_id"],), commit=True)
    registrar_log(uid, "caixa_estorno", f"pag {pid} {p['valor_total']:.2f} motivo: {motivo}")
    return jsonify({"ok": True, "totais": _totais(caixa)})


# --------------------------------------------------------------- fechamento
@caixa_bp.route("/api/caixa/fechar", methods=["POST"])
def fechar():
    """
    Fecha o caixa do operador. O valor informado é o DINHEIRO contado na
    gaveta; a diferença é calculada contra o dinheiro esperado.
    Depois de fechado, só é possível lançar abrindo um novo caixa.
    """
    erro = _exige(2)
    if erro:
        return erro
    uid = _uid()
    caixa = _aberto(uid)
    if not caixa:
        return jsonify({"erro": "Nenhum caixa aberto"}), 400
    d = request.get_json(force=True) or {}
    t = _totais(caixa)
    try:
        informado = round(float(d.get("valor_informado", t["dinheiro_gaveta"]) or 0), 2)
    except (TypeError, ValueError):
        return jsonify({"erro": "Valor inválido"}), 400
    diferenca = round(informado - t["dinheiro_gaveta"], 2)
    fechado_em = now()
    r = query("UPDATE caixa SET status='fechado', fechado_em=?, valor_fechamento=?, "
              "valor_esperado=?, diferenca=?, fechado_por=? WHERE id=? AND status='aberto'",
              (fechado_em, informado, t["dinheiro_gaveta"], diferenca, uid, caixa["id"]), commit=True)
    if not r.get("rowcount"):
        return jsonify({"erro": "Este caixa já foi fechado"}), 400
    registrar_log(uid, "fechar_caixa", f"{caixa['id']} informado={informado} dif={diferenca}")
    relatorio = dict(t)
    relatorio.update({"esperado": t["dinheiro_gaveta"], "informado": informado,
                      "diferenca": diferenca, "aberto_em": caixa["aberto_em"],
                      "fechado_em": fechado_em, "operador": _nome_operador()})
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
