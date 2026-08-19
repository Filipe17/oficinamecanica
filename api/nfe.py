"""
nfe.py — Módulo fiscal (NF-e de produtos e NFS-e de serviços).

Estratégia:
    - A emissão parte do ORÇAMENTO finalizado (ordens_servico, eh_orcamento=1).
    - Itens do tipo 'produto'  -> compõem a NF-e  (ICMS, estadual).
    - Itens do tipo 'servico'  -> compõem a NFS-e (ISS, municipal).
    - Uma OS pode gerar as duas notas (uma de cada), conforme os itens.

    Este módulo é AGNÓSTICO de gateway: ele monta um "payload" genérico a
    partir da OS e delega a transmissão a um ADAPTADOR (função enviar_*),
    que você implementa depois para o gateway escolhido (Focus NFe, PlugNotas,
    etc.). Enquanto não houver gateway, o adaptador roda em modo simulado.

    Cada nota é registrada na tabela 'notas_fiscais' com seu status.

IMPORTANTE (limite de responsabilidade):
    A montagem fiscal correta (CFOP, CST/CSOSN conforme o regime, código de
    serviço municipal, alíquotas) depende do enquadramento da empresa e deve
    ser confirmada com o contador. Aqui há apenas a ESTRUTURA; os valores
    fiscais são lidos dos cadastros (produtos: NCM/CFOP/CEST; serviços:
    codigo_servico/iss_percentual; empresa: regime, IE, CNPJ nas configurações).
"""

import os
from flask import Blueprint, request, jsonify, session
from database.database import query, now, registrar_log
from api.usuarios import login_obrigatorio, perfil_permitido
from api.configuracoes import obter_config

nfe_bp = Blueprint("nfe", __name__)


def _modulo_nfe_ativo():
    """Retorna False se o módulo NF-e estiver desabilitado nas configurações."""
    return (obter_config().get("modulo_nfe") or "habilitado") != "desabilitado"


# =========================================================================
# Configuração do gateway (lida do ambiente / configurações)
# =========================================================================
def _gateway_cfg():
    """
    Credenciais e ambiente do gateway fiscal.
    Como cada oficina tem sua própria instância (banco/deploy separados),
    guardamos isso por variável de ambiente OU nas configurações da empresa.
    """
    cfg = obter_config()
    return {
        "provedor": os.getenv("NFE_PROVEDOR", cfg.get("nfe_provedor", "")),  # ex.: 'focus', 'plugnotas'
        "token": os.getenv("NFE_TOKEN", cfg.get("nfe_token", "")),
        "ambiente": os.getenv("NFE_AMBIENTE", cfg.get("nfe_ambiente", "homologacao")),
    }


# =========================================================================
# Montagem do payload a partir da OS (genérico, independente de gateway)
# =========================================================================
def _dados_os(oid):
    """Carrega a OS + cliente + itens necessários para montar as notas."""
    o = query(
        "SELECT o.*, c.nome AS cliente_nome, c.cpf_cnpj AS cliente_doc, "
        "c.email AS cliente_email, c.endereco, c.numero, c.bairro, c.cidade, "
        "c.estado, c.cep FROM ordens_servico o "
        "LEFT JOIN clientes c ON c.id=o.cliente_id WHERE o.id=?",
        (oid,), fetchone=True)
    if not o:
        return None, [], []
    itens = query("SELECT * FROM os_itens WHERE os_id=?", (oid,))
    produtos = [i for i in itens if i.get("tipo") == "produto"]
    servicos = [i for i in itens if i.get("tipo") == "servico"]
    return o, produtos, servicos


def _montar_nfe(o, itens_produto):
    """
    Monta o payload GENÉRICO de uma NF-e (produtos). Os dados fiscais de cada
    produto (NCM/CFOP/CEST) vêm do cadastro. CST/CSOSN e demais regras devem
    ser ajustados conforme o regime — a confirmar com o contador/gateway.
    """
    cfg = obter_config()
    emitente = {
        "cnpj": cfg.get("empresa_cnpj"),
        "nome": cfg.get("empresa_nome"),
        "ie": cfg.get("empresa_inscricao_estadual"),
        "regime": cfg.get("empresa_regime_tributario"),
        "endereco": {
            "logradouro": cfg.get("empresa_endereco"), "numero": cfg.get("empresa_numero"),
            "bairro": cfg.get("empresa_bairro"), "cidade": cfg.get("empresa_cidade"),
            "uf": cfg.get("empresa_estado"), "cep": cfg.get("empresa_cep"),
        },
    }
    itens = []
    for it in itens_produto:
        prod = query("SELECT ncm, cfop, cest, ean, codigo FROM produtos WHERE id=?",
                     (it.get("referencia_id"),), fetchone=True) or {}
        itens.append({
            "descricao": it.get("descricao"),
            "quantidade": it.get("quantidade") or 0,
            "valor_unitario": it.get("valor_unitario") or 0,
            "ncm": prod.get("ncm"), "cfop": prod.get("cfop"),
            "cest": prod.get("cest"), "ean": prod.get("ean"),
            "codigo": prod.get("codigo"),
        })
    total = sum((i["quantidade"] * i["valor_unitario"]) for i in itens)
    return {"emitente": emitente, "destinatario": _destinatario(o),
            "itens": itens, "valor_total": round(total, 2)}


def _montar_nfse(o, itens_servico):
    """
    Monta o payload GENÉRICO de uma NFS-e (serviços). Código do serviço e ISS
    vêm do cadastro de serviços (codigo_servico, iss_percentual).
    """
    cfg = obter_config()
    prestador = {
        "cnpj": cfg.get("empresa_cnpj"), "nome": cfg.get("empresa_nome"),
        "im": cfg.get("empresa_inscricao_municipal"),
        "cidade": cfg.get("empresa_cidade"), "uf": cfg.get("empresa_estado"),
    }
    itens = []
    for it in itens_servico:
        srv = query("SELECT codigo_servico, iss_percentual FROM servicos WHERE id=?",
                    (it.get("referencia_id"),), fetchone=True) or {}
        itens.append({
            "descricao": it.get("descricao"),
            "quantidade": it.get("quantidade") or 0,
            "valor_unitario": it.get("valor_unitario") or 0,
            "codigo_servico": srv.get("codigo_servico"),
            "iss_percentual": srv.get("iss_percentual") or 0,
        })
    total = sum((i["quantidade"] * i["valor_unitario"]) for i in itens)
    return {"prestador": prestador, "tomador": _destinatario(o),
            "servicos": itens, "valor_total": round(total, 2)}


def _destinatario(o):
    return {
        "nome": o.get("cliente_nome"), "documento": o.get("cliente_doc"),
        "email": o.get("cliente_email"),
        "endereco": {
            "logradouro": o.get("endereco"), "numero": o.get("numero"),
            "bairro": o.get("bairro"), "cidade": o.get("cidade"),
            "uf": o.get("estado"), "cep": o.get("cep"),
        },
    }


# =========================================================================
# Adaptador de gateway (IMPLEMENTAR ao escolher Focus/PlugNotas/etc.)
# =========================================================================
def _transmitir(tipo, payload, ambiente):
    """
    Envia o payload ao gateway e retorna um dict padronizado:
        { "status": "...", "numero": ..., "chave": ..., "protocolo": ...,
          "ref_externa": ..., "pdf_url": ..., "xml": ..., "mensagem": ... }

    >>> PONTO DE INTEGRAÇÃO <<<
    Enquanto não houver gateway configurado, roda em modo SIMULADO: não
    transmite nada e devolve status 'pendente' com uma mensagem explicativa.
    Ao contratar o gateway, implemente a chamada HTTP real aqui (requests.post
    para a API do provedor, com o token de _gateway_cfg()).
    """
    gw = _gateway_cfg()
    if not gw["provedor"] or not gw["token"]:
        return {
            "status": "pendente",
            "mensagem": ("Gateway fiscal não configurado. Defina o provedor e o "
                         "token (variáveis NFE_PROVEDOR/NFE_TOKEN ou nas configurações) "
                         "para transmitir de verdade."),
        }
    # Exemplo de estrutura da integração real (a completar por provedor):
    #
    #   import requests
    #   url = _URL_DO_PROVEDOR[tipo][gw["provedor"]]
    #   resp = requests.post(url, json=payload,
    #                        headers={"Authorization": f"Bearer {gw['token']}"})
    #   data = resp.json()
    #   return _normalizar_resposta(gw["provedor"], data)
    #
    return {"status": "erro",
            "mensagem": f"Provedor '{gw['provedor']}' ainda não implementado no adaptador."}


# =========================================================================
# Persistência da nota
# =========================================================================
def _registrar_nota(oid, tipo, ambiente, payload, resultado):
    """Grava/atualiza a nota em notas_fiscais com o retorno do gateway."""
    res = query(
        "INSERT INTO notas_fiscais (os_id, tipo, ambiente, numero, serie, chave, "
        "protocolo, status, valor, mensagem, ref_externa, xml, pdf_url, criado_em, atualizado_em) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (oid, tipo, ambiente, resultado.get("numero"), resultado.get("serie"),
         resultado.get("chave"), resultado.get("protocolo"),
         resultado.get("status", "pendente"), payload.get("valor_total", 0),
         resultado.get("mensagem"), resultado.get("ref_externa"),
         resultado.get("xml"), resultado.get("pdf_url"), now(), now()),
        commit=True)
    return res["_lastid"]


# =========================================================================
# Rotas
# =========================================================================
@nfe_bp.route("/api/notas", methods=["GET"])
@login_obrigatorio
def listar_notas():
    if not _modulo_nfe_ativo():
        return jsonify({"erro": "Módulo Nota Fiscal desabilitado"}), 403
    """
    Lista as OS candidatas a emissão + as notas já emitidas de cada uma.
    O front usa isso para montar a tela 'Notas Fiscais'.
    """
    # Orçamentos finalizados — candidatos a nota fiscal.
    oss = query(
        "SELECT o.id, o.numero, o.data, o.total, o.status, c.nome AS cliente_nome "
        "FROM ordens_servico o LEFT JOIN clientes c ON c.id=o.cliente_id "
        "WHERE o.eh_orcamento=1 AND o.status='finalizada' "
        "ORDER BY o.id DESC LIMIT 200")
    notas = query("SELECT * FROM notas_fiscais ORDER BY id DESC")
    por_os = {}
    for n in notas:
        por_os.setdefault(n["os_id"], []).append(n)
    for o in oss:
        o["notas"] = por_os.get(o["id"], [])
    return jsonify({"dados": oss})


@nfe_bp.route("/api/notas/os/<int:oid>", methods=["GET"])
@login_obrigatorio
def notas_da_os(oid):
    if not _modulo_nfe_ativo():
        return jsonify({"erro": "Módulo Nota Fiscal desabilitado"}), 403
    """Detalhe: o que a OS tem (produtos/serviços) e as notas já emitidas."""
    o, produtos, servicos = _dados_os(oid)
    if not o:
        return jsonify({"erro": "OS não encontrada"}), 404
    notas = query("SELECT * FROM notas_fiscais WHERE os_id=? ORDER BY id DESC", (oid,))
    return jsonify({
        "os": {"id": o["id"], "numero": o.get("numero"), "cliente": o.get("cliente_nome"),
               "total": o.get("total")},
        "tem_produtos": len(produtos) > 0,
        "tem_servicos": len(servicos) > 0,
        "notas": notas,
    })


@nfe_bp.route("/api/notas/emitir", methods=["POST"])
@login_obrigatorio
@perfil_permitido("administrador", "gerente", "financeiro")
def emitir():
    if not _modulo_nfe_ativo():
        return jsonify({"erro": "Módulo Nota Fiscal desabilitado"}), 403
    """
    Emite a nota de uma OS. Body: { "os_id": N, "tipo": "nfe" | "nfse" }.
    Monta o payload, transmite via adaptador e registra em notas_fiscais.
    """
    d = request.get_json(force=True)
    oid = d.get("os_id")
    tipo = (d.get("tipo") or "").lower()
    if tipo not in ("nfe", "nfse"):
        return jsonify({"erro": "Tipo deve ser 'nfe' ou 'nfse'"}), 400

    o, produtos, servicos = _dados_os(oid)
    if not o:
        return jsonify({"erro": "OS não encontrada"}), 404

    if tipo == "nfe":
        if not produtos:
            return jsonify({"erro": "Esta OS não tem produtos para NF-e"}), 400
        payload = _montar_nfe(o, produtos)
    else:
        if not servicos:
            return jsonify({"erro": "Esta OS não tem serviços para NFS-e"}), 400
        payload = _montar_nfse(o, servicos)

    ambiente = _gateway_cfg()["ambiente"]

    # Sem gateway configurado, não registra nada (evita notas "pendentes" fantasma).
    gw = _gateway_cfg()
    if not gw["provedor"] or not gw["token"]:
        return jsonify({
            "ok": False, "status": "nao_configurado",
            "mensagem": "Gateway fiscal não configurado. Preencha o provedor e o token "
                        "em Configurações antes de emitir."
        }), 400

    resultado = _transmitir(tipo, payload, ambiente)
    nota_id = _registrar_nota(oid, tipo, ambiente, payload, resultado)

    registrar_log(session["user_id"], f"emitir_{tipo}",
                  f"OS {o.get('numero')} -> status {resultado.get('status')}")
    return jsonify({"ok": resultado.get("status") not in ("erro",),
                    "nota_id": nota_id, "status": resultado.get("status"),
                    "mensagem": resultado.get("mensagem")})


@nfe_bp.route("/api/notas/<int:nid>", methods=["GET"])
@login_obrigatorio
def detalhe_nota(nid):
    if not _modulo_nfe_ativo():
        return jsonify({"erro": "Módulo Nota Fiscal desabilitado"}), 403
    n = query("SELECT * FROM notas_fiscais WHERE id=?", (nid,), fetchone=True)
    if not n:
        return jsonify({"erro": "Nota não encontrada"}), 404
    return jsonify(n)


# =========================================================================
# Exportação de XMLs para o contador (SPED é gerado por ele a partir daqui)
# =========================================================================
@nfe_bp.route("/api/notas/exportar", methods=["GET"])
@login_obrigatorio
@perfil_permitido("administrador", "gerente", "financeiro")
def exportar_lista():
    if not _modulo_nfe_ativo():
        return jsonify({"erro": "Módulo Nota Fiscal desabilitado"}), 403
    """
    Lista as notas autorizadas do período (para a tela de exportação).
    Parâmetros: inicio, fim (YYYY-MM-DD), tipo (nfe|nfse|'' para ambos).
    """
    inicio = request.args.get("inicio", "").strip()
    fim = request.args.get("fim", "").strip()
    tipo = request.args.get("tipo", "").strip()

    where = ["status='autorizada'"]
    params = []
    if inicio:
        where.append("substr(criado_em,1,10) >= ?"); params.append(inicio)
    if fim:
        where.append("substr(criado_em,1,10) <= ?"); params.append(fim)
    if tipo in ("nfe", "nfse"):
        where.append("tipo = ?"); params.append(tipo)

    notas = query(
        f"SELECT n.id, n.os_id, n.tipo, n.numero, n.chave, n.valor, n.criado_em, "
        f"CASE WHEN n.xml IS NULL OR n.xml='' THEN 0 ELSE 1 END AS tem_xml, "
        f"o.numero AS os_numero FROM notas_fiscais n "
        f"LEFT JOIN ordens_servico o ON o.id=n.os_id "
        f"WHERE {' AND '.join(where)} ORDER BY n.criado_em, n.id", params)
    com_xml = sum(1 for n in notas if n["tem_xml"])
    total_valor = sum(n["valor"] or 0 for n in notas)
    return jsonify({"dados": notas, "total": len(notas),
                    "com_xml": com_xml, "valor_total": round(total_valor, 2)})


@nfe_bp.route("/api/notas/exportar/zip", methods=["GET"])
@login_obrigatorio
@perfil_permitido("administrador", "gerente", "financeiro")
def exportar_zip():
    if not _modulo_nfe_ativo():
        return jsonify({"erro": "Módulo Nota Fiscal desabilitado"}), 403
    """
    Gera um .zip com os XMLs das notas autorizadas do período (download).
    Só inclui notas que tenham XML gravado.
    """
    import io
    import zipfile
    from flask import Response

    inicio = request.args.get("inicio", "").strip()
    fim = request.args.get("fim", "").strip()
    tipo = request.args.get("tipo", "").strip()

    where = ["status='autorizada'", "xml IS NOT NULL", "xml <> ''"]
    params = []
    if inicio:
        where.append("substr(criado_em,1,10) >= ?"); params.append(inicio)
    if fim:
        where.append("substr(criado_em,1,10) <= ?"); params.append(fim)
    if tipo in ("nfe", "nfse"):
        where.append("tipo = ?"); params.append(tipo)

    notas = query(
        f"SELECT id, tipo, numero, chave, xml FROM notas_fiscais "
        f"WHERE {' AND '.join(where)} ORDER BY criado_em, id", params)

    if not notas:
        return jsonify({"erro": "Nenhuma nota com XML no período selecionado"}), 404

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for n in notas:
            base = n.get("chave") or n.get("numero") or f"id{n['id']}"
            nome = f"{n['tipo']}_{base}.xml"
            zf.writestr(nome, n["xml"] or "")
    buf.seek(0)

    periodo = f"{inicio or 'inicio'}_a_{fim or 'fim'}"
    registrar_log(session["user_id"], "exportar_xml_notas", f"{len(notas)} notas ({periodo})")
    return Response(
        buf.getvalue(), mimetype="application/zip",
        headers={"Content-Disposition": f"attachment; filename=notas_{periodo}.zip"})
