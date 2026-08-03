"""
cheques.py — Controle de cheques recebidos (de clientes) e emitidos (a fornecedores).

Status possíveis:
  Recebidos: na_carteira -> depositado -> compensado | devolvido | repassado | cancelado
  Emitidos:  emitido -> compensado | cancelado

Integração com o financeiro:
  - Ao marcar um cheque como 'compensado', gera um lançamento no financeiro:
      * recebido  -> conta a receber já quitada (entrada)
      * emitido   -> conta a pagar já quitada (saída)
    O vínculo fica em cheques.financeiro_id (evita lançar duas vezes).
  - Se o cheque sair de 'compensado' (ex.: estorno), o lançamento é removido.
"""

from flask import Blueprint, request, jsonify, session
from database.database import query, now, registrar_log
from api.usuarios import login_obrigatorio, perfil_permitido

cheques_bp = Blueprint("cheques", __name__)

STATUS_RECEBIDO = {"na_carteira", "depositado", "compensado", "devolvido", "repassado", "cancelado"}
STATUS_EMITIDO = {"emitido", "compensado", "cancelado"}


def _lancar_financeiro(ch):
    """Cria o lançamento no financeiro para um cheque compensado. Retorna o id."""
    if ch["tipo"] == "recebido":
        tipo_fin = "receber"
        desc = f"Cheque recebido nº {ch.get('numero') or ''} - {ch.get('titular') or ''}".strip()
        cli, forn = ch.get("cliente_id"), None
    else:
        tipo_fin = "pagar"
        desc = f"Cheque emitido nº {ch.get('numero') or ''}".strip()
        cli, forn = None, ch.get("fornecedor_id")
    res = query(
        "INSERT INTO financeiro (tipo, descricao, cliente_id, fornecedor_id, valor, "
        "valor_pago, vencimento, pago_em, forma_pagamento, status, criado_em) "
        "VALUES (?,?,?,?,?,?,?,?, 'cheque', 'pago', ?)",
        (tipo_fin, desc, cli, forn, ch.get("valor", 0), ch.get("valor", 0),
         ch.get("bom_para") or now(), now(), now()),
        commit=True)
    return res["_lastid"]


@cheques_bp.route("/api/cheques", methods=["GET"])
@login_obrigatorio
def listar():
    tipo = request.args.get("tipo", "").strip()
    status = request.args.get("status", "").strip()
    where, params = ["1=1"], []
    if tipo in ("recebido", "emitido"):
        where.append("c.tipo=?"); params.append(tipo)
    if status:
        where.append("c.status=?"); params.append(status)
    lista = query(
        f"SELECT c.*, cl.nome AS cliente_nome, f.nome AS fornecedor_nome "
        f"FROM cheques c "
        f"LEFT JOIN clientes cl ON cl.id=c.cliente_id "
        f"LEFT JOIN fornecedores f ON f.id=c.fornecedor_id "
        f"WHERE {' AND '.join(where)} ORDER BY c.bom_para, c.id DESC", params)
    return jsonify({"dados": lista})


@cheques_bp.route("/api/cheques", methods=["POST"])
@login_obrigatorio
@perfil_permitido("administrador", "gerente", "financeiro")
def criar():
    d = request.get_json(force=True)
    tipo = d.get("tipo")
    if tipo not in ("recebido", "emitido"):
        return jsonify({"erro": "Tipo deve ser 'recebido' ou 'emitido'"}), 400
    status_ini = "na_carteira" if tipo == "recebido" else "emitido"
    res = query(
        "INSERT INTO cheques (tipo, numero, banco, agencia, conta, titular, "
        "cliente_id, fornecedor_id, valor, emissao, bom_para, status, os_id, "
        "observacao, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (tipo, d.get("numero"), d.get("banco"), d.get("agencia"), d.get("conta"),
         d.get("titular"), d.get("cliente_id"), d.get("fornecedor_id"),
         float(d.get("valor") or 0), d.get("emissao"), d.get("bom_para"),
         d.get("status", status_ini), d.get("os_id"), d.get("observacao"), now()),
        commit=True)
    registrar_log(session["user_id"], "criar_cheque", str(res["_lastid"]))
    return jsonify({"ok": True, "id": res["_lastid"]}), 201


@cheques_bp.route("/api/cheques/<int:cid>", methods=["PUT"])
@login_obrigatorio
@perfil_permitido("administrador", "gerente", "financeiro")
def editar(cid):
    d = request.get_json(force=True)
    reg = query("SELECT id FROM cheques WHERE id=?", (cid,), fetchone=True)
    if not reg:
        return jsonify({"erro": "Cheque não encontrado"}), 404
    query(
        "UPDATE cheques SET numero=?, banco=?, agencia=?, conta=?, titular=?, "
        "cliente_id=?, fornecedor_id=?, valor=?, emissao=?, bom_para=?, "
        "observacao=?, atualizado_em=? WHERE id=?",
        (d.get("numero"), d.get("banco"), d.get("agencia"), d.get("conta"),
         d.get("titular"), d.get("cliente_id"), d.get("fornecedor_id"),
         float(d.get("valor") or 0), d.get("emissao"), d.get("bom_para"),
         d.get("observacao"), now(), cid),
        commit=True)
    return jsonify({"ok": True})


@cheques_bp.route("/api/cheques/<int:cid>/status", methods=["POST"])
@login_obrigatorio
@perfil_permitido("administrador", "gerente", "financeiro")
def mudar_status(cid):
    d = request.get_json(force=True)
    novo = (d.get("status") or "").strip()
    ch = query("SELECT * FROM cheques WHERE id=?", (cid,), fetchone=True)
    if not ch:
        return jsonify({"erro": "Cheque não encontrado"}), 404
    validos = STATUS_RECEBIDO if ch["tipo"] == "recebido" else STATUS_EMITIDO
    if novo not in validos:
        return jsonify({"erro": "Status inválido para este tipo de cheque"}), 400

    # Integração com o financeiro ao entrar/sair de 'compensado'.
    fin_id = ch.get("financeiro_id")
    if novo == "compensado" and not fin_id:
        fin_id = _lancar_financeiro(ch)
    elif novo != "compensado" and fin_id:
        # saiu de compensado (estorno): remove o lançamento gerado
        query("DELETE FROM financeiro WHERE id=?", (fin_id,), commit=True)
        fin_id = None

    query("UPDATE cheques SET status=?, financeiro_id=?, atualizado_em=? WHERE id=?",
          (novo, fin_id, now(), cid), commit=True)
    registrar_log(session["user_id"], "status_cheque", f"{cid} -> {novo}")
    return jsonify({"ok": True, "financeiro_id": fin_id})


@cheques_bp.route("/api/cheques/<int:cid>", methods=["DELETE"])
@login_obrigatorio
@perfil_permitido("administrador", "gerente", "financeiro")
def excluir(cid):
    ch = query("SELECT financeiro_id FROM cheques WHERE id=?", (cid,), fetchone=True)
    if ch and ch.get("financeiro_id"):
        query("DELETE FROM financeiro WHERE id=?", (ch["financeiro_id"],), commit=True)
    query("DELETE FROM cheques WHERE id=?", (cid,), commit=True)
    registrar_log(session["user_id"], "excluir_cheque", str(cid))
    return jsonify({"ok": True})


@cheques_bp.route("/api/cheques/resumo", methods=["GET"])
@login_obrigatorio
def resumo():
    """Totais por situação, para os cartões do topo da tela."""
    def soma(tipo, status):
        r = query("SELECT COALESCE(SUM(valor),0) AS v, COUNT(*) AS n FROM cheques "
                  "WHERE tipo=? AND status=?", (tipo, status), fetchone=True)
        return {"valor": r["v"] or 0, "qtd": r["n"] or 0}
    return jsonify({
        "receber_carteira": soma("recebido", "na_carteira"),
        "receber_depositado": soma("recebido", "depositado"),
        "recebido_devolvido": soma("recebido", "devolvido"),
        "emitido_aberto": soma("emitido", "emitido"),
    })
