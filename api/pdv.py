"""
pdv.py — Ponto de Venda (caixa e vendas rápidas).

Fluxo:
    1) Abertura de caixa (registra valor inicial).
    2) Vendas: cada venda baixa o estoque dos produtos e soma ao caixa.
    3) Sangria/Suprimento: retiradas e reforços de dinheiro.
    4) Fechamento: consolida o total e fecha o caixa.
"""

from flask import Blueprint, request, jsonify, session
from database.database import query, now, registrar_log
from api.usuarios import login_obrigatorio
from api.estoque import movimentar_estoque

pdv_bp = Blueprint("pdv", __name__)


def _caixa_aberto(usuario_id):
    """Retorna o caixa aberto do usuário, se houver."""
    return query("SELECT * FROM caixa WHERE usuario_id=? AND status='aberto' "
                 "ORDER BY id DESC LIMIT 1", (usuario_id,), fetchone=True)


@pdv_bp.route("/api/pdv/caixa", methods=["GET"])
@login_obrigatorio
def status_caixa():
    caixa = _caixa_aberto(session["user_id"])
    return jsonify({"caixa": caixa})


@pdv_bp.route("/api/pdv/caixa/abrir", methods=["POST"])
@login_obrigatorio
def abrir_caixa():
    if _caixa_aberto(session["user_id"]):
        return jsonify({"erro": "Já existe um caixa aberto"}), 400
    d = request.get_json(force=True)
    res = query(
        "INSERT INTO caixa (usuario_id, valor_abertura, aberto_em, status) "
        "VALUES (?,?,?, 'aberto')",
        (session["user_id"], d.get("valor_abertura", 0), now()), commit=True)
    registrar_log(session["user_id"], "abrir_caixa", str(res["_lastid"]))
    return jsonify({"ok": True, "id": res["_lastid"]})


@pdv_bp.route("/api/pdv/caixa/fechar", methods=["POST"])
@login_obrigatorio
def fechar_caixa():
    caixa = _caixa_aberto(session["user_id"])
    if not caixa:
        return jsonify({"erro": "Nenhum caixa aberto"}), 400

    # Consolida: abertura + vendas + suprimentos - sangrias
    vendas = query("SELECT COALESCE(SUM(total),0) AS t FROM vendas WHERE caixa_id=?",
                   (caixa["id"],), fetchone=True)["t"]
    supr = query("SELECT COALESCE(SUM(valor),0) AS t FROM caixa_mov "
                 "WHERE caixa_id=? AND tipo='suprimento'", (caixa["id"],), fetchone=True)["t"]
    sang = query("SELECT COALESCE(SUM(valor),0) AS t FROM caixa_mov "
                 "WHERE caixa_id=? AND tipo='sangria'", (caixa["id"],), fetchone=True)["t"]
    total = (caixa["valor_abertura"] or 0) + vendas + supr - sang

    query("UPDATE caixa SET status='fechado', fechado_em=?, valor_fechamento=? WHERE id=?",
          (now(), total, caixa["id"]), commit=True)
    registrar_log(session["user_id"], "fechar_caixa", str(caixa["id"]))
    return jsonify({"ok": True, "resumo": {
        "abertura": caixa["valor_abertura"], "vendas": vendas,
        "suprimentos": supr, "sangrias": sang, "total": total}})


@pdv_bp.route("/api/pdv/caixa/movimento", methods=["POST"])
@login_obrigatorio
def movimento_caixa():
    """Sangria (retirada) ou suprimento (reforço)."""
    caixa = _caixa_aberto(session["user_id"])
    if not caixa:
        return jsonify({"erro": "Nenhum caixa aberto"}), 400
    d = request.get_json(force=True)
    if d.get("tipo") not in ("sangria", "suprimento"):
        return jsonify({"erro": "Tipo inválido"}), 400
    query("INSERT INTO caixa_mov (caixa_id, tipo, valor, motivo, criado_em) VALUES (?,?,?,?,?)",
          (caixa["id"], d["tipo"], d.get("valor", 0), d.get("motivo"), now()), commit=True)
    registrar_log(session["user_id"], f"caixa_{d['tipo']}", str(d.get("valor")))
    return jsonify({"ok": True})


@pdv_bp.route("/api/pdv/venda", methods=["POST"])
@login_obrigatorio
def registrar_venda():
    """Registra uma venda, baixa o estoque e vincula ao caixa aberto."""
    caixa = _caixa_aberto(session["user_id"])
    if not caixa:
        return jsonify({"erro": "Abra o caixa antes de vender"}), 400

    d = request.get_json(force=True)
    itens = d.get("itens", [])
    if not itens:
        return jsonify({"erro": "Venda sem itens"}), 400

    total = sum(float(i.get("quantidade", 1)) * float(i.get("valor_unitario", 0))
                for i in itens)
    desconto = float(d.get("desconto", 0))
    total = max(total - desconto, 0)

    res = query(
        "INSERT INTO vendas (caixa_id, cliente_id, usuario_id, total, desconto, "
        "forma_pagamento, criado_em) VALUES (?,?,?,?,?,?,?)",
        (caixa["id"], d.get("cliente_id"), session["user_id"], total, desconto,
         d.get("forma_pagamento", "dinheiro"), now()), commit=True)
    venda_id = res["_lastid"]

    for it in itens:
        qtd = float(it.get("quantidade", 1))
        vu = float(it.get("valor_unitario", 0))
        query(
            "INSERT INTO venda_itens (venda_id, produto_id, descricao, quantidade, "
            "valor_unitario, subtotal) VALUES (?,?,?,?,?,?)",
            (venda_id, it.get("produto_id"), it.get("descricao"), qtd, vu, qtd * vu),
            commit=True)
        # Baixa estoque apenas se for produto cadastrado
        if it.get("produto_id"):
            try:
                movimentar_estoque(it["produto_id"], "saida", qtd,
                                   origem="pdv", documento=f"VENDA-{venda_id}")
            except ValueError:
                pass

    registrar_log(session["user_id"], "venda_pdv", f"venda {venda_id} total {total}")
    return jsonify({"ok": True, "id": venda_id, "total": total})


@pdv_bp.route("/api/pdv/vendas", methods=["GET"])
@login_obrigatorio
def historico_vendas():
    lista = query(
        "SELECT v.*, c.nome AS cliente_nome FROM vendas v "
        "LEFT JOIN clientes c ON c.id=v.cliente_id "
        "ORDER BY v.id DESC LIMIT 100")
    return jsonify({"dados": lista})
