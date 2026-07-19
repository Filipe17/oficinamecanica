"""
caixa.py — Módulo de Caixa (operado com login próprio pelo perfil "caixa").

É um sistema à parte na experiência (tela dedicada), mas conectado ao mesmo
banco: as cobranças geradas por orçamentos/OS finalizados aparecem aqui para
receber, e os recebimentos/baixas alimentam o financeiro e o dashboard.

Fluxo: abrir caixa -> receber cobranças / sangria / suprimento -> fechar com
relatório do dia (comparando o valor conferido com o saldo esperado).
"""

from flask import Blueprint, request, jsonify, session
from database.database import query, now, registrar_log
from api.usuarios import login_obrigatorio

caixa_bp = Blueprint("caixa", __name__)


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


@caixa_bp.route("/api/caixa/status", methods=["GET"])
@login_obrigatorio
def status():
    caixa = _aberto(session["user_id"])
    return jsonify({
        "aberto": bool(caixa),
        "caixa": caixa,
        "totais": _totais(caixa) if caixa else None,
        "operador": session.get("nome"),
    })


@caixa_bp.route("/api/caixa/abrir", methods=["POST"])
@login_obrigatorio
def abrir():
    if _aberto(session["user_id"]):
        return jsonify({"erro": "Você já tem um caixa aberto"}), 400
    d = request.get_json(force=True)
    res = query("INSERT INTO caixa (usuario_id, valor_abertura, aberto_em, status) "
                "VALUES (?,?,?, 'aberto')",
                (session["user_id"], float(d.get("valor_abertura", 0) or 0), now()),
                commit=True)
    registrar_log(session["user_id"], "abrir_caixa", str(res["_lastid"]))
    return jsonify({"ok": True, "id": res["_lastid"]})


@caixa_bp.route("/api/caixa/movimento", methods=["POST"])
@login_obrigatorio
def movimento():
    """Sangria (retirada) ou suprimento (reforço)."""
    caixa = _aberto(session["user_id"])
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
    registrar_log(session["user_id"], f"caixa_{d['tipo']}", str(valor))
    return jsonify({"ok": True, "totais": _totais(caixa)})


@caixa_bp.route("/api/caixa/receber", methods=["GET"])
@login_obrigatorio
def cobrancas_abertas():
    """Contas a receber em aberto (cobranças de orçamentos/OS + lançamentos manuais)."""
    lista = query(
        "SELECT f.id, f.descricao, f.valor, f.vencimento, f.status, f.os_id, "
        "c.nome AS cliente_nome FROM financeiro f "
        "LEFT JOIN clientes c ON c.id=f.cliente_id "
        "WHERE f.tipo='receber' AND f.status IN ('aberto','atrasado') "
        "ORDER BY f.id DESC")
    return jsonify({"dados": lista})


@caixa_bp.route("/api/caixa/receber/<int:fid>", methods=["POST"])
@login_obrigatorio
def receber(fid):
    """Recebe (dá baixa) numa cobrança e lança o valor no caixa aberto."""
    caixa = _aberto(session["user_id"])
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

    # Baixa no financeiro
    query("UPDATE financeiro SET status='pago', valor_pago=?, pago_em=?, forma_pagamento=? WHERE id=?",
          (valor_pago, now(), forma, fid), commit=True)
    # Entra no caixa como recebimento (para o saldo e o fechamento do dia)
    motivo = f"{reg['descricao'] or 'Recebimento'} ({forma})"
    query("INSERT INTO caixa_mov (caixa_id, tipo, valor, motivo, criado_em) VALUES (?,?,?,?,?)",
          (caixa["id"], "recebimento", valor_pago, motivo, now()), commit=True)
    registrar_log(session["user_id"], "caixa_receber", f"fin {fid} {forma} {valor_pago}")
    return jsonify({"ok": True, "totais": _totais(caixa)})


@caixa_bp.route("/api/caixa/fechar", methods=["POST"])
@login_obrigatorio
def fechar():
    caixa = _aberto(session["user_id"])
    if not caixa:
        return jsonify({"erro": "Nenhum caixa aberto"}), 400
    d = request.get_json(force=True)
    t = _totais(caixa)
    informado = float(d.get("valor_informado", t["saldo"]) or 0)
    diferenca = round(informado - t["saldo"], 2)

    query("UPDATE caixa SET status='fechado', fechado_em=?, valor_fechamento=? WHERE id=?",
          (now(), informado, caixa["id"]), commit=True)
    registrar_log(session["user_id"], "fechar_caixa", str(caixa["id"]))

    qtd_receb = query("SELECT COUNT(*) AS n FROM caixa_mov WHERE caixa_id=? AND tipo='recebimento'",
                      (caixa["id"],), fetchone=True)["n"]
    relatorio = dict(t)
    relatorio.update({
        "esperado": t["saldo"], "informado": informado, "diferenca": diferenca,
        "qtd_recebimentos": qtd_receb, "aberto_em": caixa["aberto_em"], "fechado_em": now(),
    })
    return jsonify({"ok": True, "relatorio": relatorio})
