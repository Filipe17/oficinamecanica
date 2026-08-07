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


@estoque_bp.route("/api/estoque/sugestao-compras", methods=["GET"])
@login_obrigatorio
def sugestao_compras():
    """
    Lista produtos abaixo do estoque mínimo, agrupados por fornecedor.
    Quantidade sugerida = estoque_maximo - estoque_atual (ou estoque_minimo*2
    quando estoque_maximo não está definido).
    Inclui variações (produto_pai_id não nulo) com seus próprios estoques.
    """
    criticos = query("""
        SELECT p.id, p.nome, p.codigo, p.categoria, p.marca,
               p.estoque_atual, p.estoque_minimo, p.estoque_maximo,
               p.preco_compra, p.produto_pai_id,
               f.nome AS fornecedor, f.id AS fornecedor_id,
               f.telefone AS fornecedor_tel, f.email AS fornecedor_email
        FROM produtos p
        LEFT JOIN fornecedores f ON f.id = p.fornecedor_id
        WHERE p.estoque_minimo > 0
          AND p.estoque_atual <= p.estoque_minimo
          AND (
            -- inclui variações (tem pai)
            p.produto_pai_id IS NOT NULL
            OR
            -- inclui produtos simples (sem pai E sem filhos)
            NOT EXISTS (
              SELECT 1 FROM produtos v WHERE v.produto_pai_id = p.id
            )
          )
        ORDER BY f.nome NULLS LAST, p.nome
    """)

    # Calcula quantidade sugerida e valor estimado
    for p in criticos:
        atual = float(p["estoque_atual"] or 0)
        minimo = float(p["estoque_minimo"] or 0)
        maximo = float(p["estoque_maximo"] or 0)
        sugerido = (maximo - atual) if maximo > atual else (minimo * 2 - atual)
        sugerido = max(round(sugerido, 2), 1)
        p["sugerido"] = sugerido
        p["valor_estimado"] = round(sugerido * float(p["preco_compra"] or 0), 2)

    # Agrupa por fornecedor
    grupos = {}
    sem_fornecedor = []
    for p in criticos:
        forn = p.get("fornecedor") or ""
        if not forn:
            sem_fornecedor.append(p)
            continue
        if forn not in grupos:
            grupos[forn] = {
                "fornecedor": forn,
                "fornecedor_id": p.get("fornecedor_id"),
                "telefone": p.get("fornecedor_tel"),
                "email": p.get("fornecedor_email"),
                "itens": [],
                "total_estimado": 0,
            }
        grupos[forn]["itens"].append(p)
        grupos[forn]["total_estimado"] = round(
            grupos[forn]["total_estimado"] + p["valor_estimado"], 2)

    if sem_fornecedor:
        grupos["— Sem fornecedor —"] = {
            "fornecedor": "— Sem fornecedor —",
            "fornecedor_id": None,
            "telefone": None,
            "email": None,
            "itens": sem_fornecedor,
            "total_estimado": round(sum(p["valor_estimado"] for p in sem_fornecedor), 2),
        }

    total_geral = round(sum(g["total_estimado"] for g in grupos.values()), 2)
    return jsonify({
        "grupos": list(grupos.values()),
        "total_itens": len(criticos),
        "total_geral": total_geral,
    })
