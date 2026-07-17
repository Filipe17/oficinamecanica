"""
estoque.py — Controle de estoque.

Regra central: TODA alteração de saldo passa por movimentar_estoque(), que
grava um registro em estoque_mov (histórico) e atualiza produtos.estoque_atual.
Isso garante rastreabilidade total (entrada, saída, ajuste, transferência).
"""

from flask import Blueprint, request, jsonify, session
from database.database import query, now, registrar_log
from api.usuarios import login_obrigatorio

estoque_bp = Blueprint("estoque", __name__)


def movimentar_estoque(produto_id, tipo, quantidade, origem="manual",
                       documento=None, usuario_id=None):
    """
    Aplica uma movimentação e retorna o novo saldo.

    tipo: 'entrada' soma; 'saida' subtrai; 'ajuste' define o valor absoluto;
          'transferencia' subtrai (transferência de saída).
    Usada também pelo PDV, OS e importação de XML.
    """
    prod = query("SELECT estoque_atual FROM produtos WHERE id=?",
                 (produto_id,), fetchone=True)
    if not prod:
        raise ValueError("Produto inexistente")

    atual = float(prod["estoque_atual"] or 0)
    qtd = float(quantidade)

    if tipo == "entrada":
        novo = atual + qtd
    elif tipo in ("saida", "transferencia"):
        novo = atual - qtd
    elif tipo == "ajuste":
        novo = qtd
    else:
        raise ValueError("Tipo de movimentação inválido")

    query("UPDATE produtos SET estoque_atual=? WHERE id=?", (novo, produto_id),
          commit=True)
    query(
        "INSERT INTO estoque_mov (produto_id, tipo, quantidade, saldo_apos, "
        "origem, documento, usuario_id, criado_em) VALUES (?,?,?,?,?,?,?,?)",
        (produto_id, tipo, qtd, novo, origem, documento,
         usuario_id or session.get("user_id"), now()),
        commit=True,
    )
    return novo


@estoque_bp.route("/api/estoque/movimentar", methods=["POST"])
@login_obrigatorio
def api_movimentar():
    d = request.get_json(force=True)
    try:
        novo = movimentar_estoque(
            d["produto_id"], d["tipo"], d["quantidade"],
            origem=d.get("origem", "manual"), documento=d.get("documento"))
    except (KeyError, ValueError) as e:
        return jsonify({"erro": str(e)}), 400
    registrar_log(session["user_id"], "movimentar_estoque",
                  f"produto {d.get('produto_id')} {d.get('tipo')} {d.get('quantidade')}")
    return jsonify({"ok": True, "saldo": novo})


@estoque_bp.route("/api/estoque/movimentacoes", methods=["GET"])
@login_obrigatorio
def movimentacoes():
    """Histórico geral de movimentações, com nome do produto."""
    lista = query(
        "SELECT m.*, p.nome AS produto_nome FROM estoque_mov m "
        "LEFT JOIN produtos p ON p.id = m.produto_id "
        "ORDER BY m.id DESC LIMIT 200")
    return jsonify({"dados": lista})


@estoque_bp.route("/api/estoque/alertas", methods=["GET"])
@login_obrigatorio
def alertas():
    """Produtos zerados e produtos abaixo do estoque mínimo (críticos)."""
    sem_estoque = query("SELECT * FROM produtos WHERE estoque_atual <= 0 ORDER BY nome")
    criticos = query(
        "SELECT * FROM produtos WHERE estoque_atual > 0 "
        "AND estoque_minimo > 0 AND estoque_atual <= estoque_minimo ORDER BY nome")
    return jsonify({"sem_estoque": sem_estoque, "criticos": criticos})


@estoque_bp.route("/api/estoque/curva-abc", methods=["GET"])
@login_obrigatorio
def curva_abc():
    """
    Curva ABC simplificada por valor imobilizado (estoque_atual * preco_venda).
    A = top 20% do valor, B = próximos 30%, C = restante.
    """
    produtos = query(
        "SELECT id, nome, estoque_atual, preco_venda, "
        "(estoque_atual * preco_venda) AS valor FROM produtos "
        "ORDER BY valor DESC")
    total = sum(p["valor"] or 0 for p in produtos) or 1
    acumulado = 0
    for p in produtos:
        acumulado += (p["valor"] or 0)
        perc = acumulado / total
        p["classe"] = "A" if perc <= 0.8 else ("B" if perc <= 0.95 else "C")
    return jsonify({"dados": produtos})
