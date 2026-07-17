"""
produtos.py — CRUD de produtos, além de serviços e fornecedores
(agrupados aqui por serem cadastros de apoio com estrutura idêntica).

Calcula automaticamente a margem de lucro a partir dos preços de compra/venda.
"""

from flask import Blueprint, request, jsonify, session
from database.database import query, now, registrar_log
from api.usuarios import login_obrigatorio

produtos_bp = Blueprint("produtos", __name__)


def _margem(compra, venda):
    """Margem percentual sobre o preço de venda. Retorna 0 se dados insuficientes."""
    try:
        compra, venda = float(compra or 0), float(venda or 0)
        if venda > 0:
            return round((venda - compra) / venda * 100, 2)
    except (TypeError, ValueError):
        pass
    return 0


# =========================================================================
# PRODUTOS
# =========================================================================
@produtos_bp.route("/api/produtos", methods=["GET"])
@login_obrigatorio
def listar_produtos():
    q = request.args.get("q", "").strip()
    pagina = max(int(request.args.get("pagina", 1)), 1)
    por_pagina = min(int(request.args.get("por_pagina", 20)), 100)

    where, params = "", []
    if q:
        where = ("WHERE nome LIKE ? OR codigo LIKE ? OR codigo_barras LIKE ? "
                 "OR ean LIKE ? OR categoria LIKE ?")
        termo = f"%{q}%"
        params = [termo] * 5

    total = query(f"SELECT COUNT(*) AS n FROM produtos {where}",
                  params, fetchone=True)["n"]
    offset = (pagina - 1) * por_pagina
    lista = query(f"SELECT * FROM produtos {where} ORDER BY nome LIMIT ? OFFSET ?",
                  params + [por_pagina, offset])
    for p in lista:
        p["margem"] = _margem(p.get("preco_compra"), p.get("preco_venda"))
    return jsonify({
        "dados": lista, "total": total, "pagina": pagina,
        "por_pagina": por_pagina,
        "paginas": (total + por_pagina - 1) // por_pagina,
    })


@produtos_bp.route("/api/produtos/<int:pid>", methods=["GET"])
@login_obrigatorio
def detalhe_produto(pid):
    p = query("SELECT * FROM produtos WHERE id=?", (pid,), fetchone=True)
    if not p:
        return jsonify({"erro": "Produto não encontrado"}), 404
    p["margem"] = _margem(p.get("preco_compra"), p.get("preco_venda"))
    p["movimentacoes"] = query(
        "SELECT * FROM estoque_mov WHERE produto_id=? ORDER BY id DESC LIMIT 30", (pid,))
    return jsonify(p)


@produtos_bp.route("/api/produtos", methods=["POST"])
@login_obrigatorio
def criar_produto():
    d = request.get_json(force=True)
    if not d.get("nome"):
        return jsonify({"erro": "Nome é obrigatório"}), 400
    res = query(
        "INSERT INTO produtos (codigo, codigo_barras, nome, categoria, marca, "
        "fornecedor_id, localizacao, preco_compra, preco_venda, estoque_atual, "
        "estoque_minimo, estoque_maximo, ncm, cfop, cest, ean, criado_em) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (d.get("codigo"), d.get("codigo_barras"), d.get("nome"), d.get("categoria"),
         d.get("marca"), d.get("fornecedor_id"), d.get("localizacao"),
         d.get("preco_compra", 0), d.get("preco_venda", 0), d.get("estoque_atual", 0),
         d.get("estoque_minimo", 0), d.get("estoque_maximo", 0), d.get("ncm"),
         d.get("cfop"), d.get("cest"), d.get("ean"), now()),
        commit=True,
    )
    registrar_log(session["user_id"], "criar_produto", d.get("nome"))
    return jsonify({"ok": True, "id": res["_lastid"]}), 201


@produtos_bp.route("/api/produtos/<int:pid>", methods=["PUT"])
@login_obrigatorio
def editar_produto(pid):
    d = request.get_json(force=True)
    query(
        "UPDATE produtos SET codigo=?, codigo_barras=?, nome=?, categoria=?, marca=?, "
        "fornecedor_id=?, localizacao=?, preco_compra=?, preco_venda=?, "
        "estoque_minimo=?, estoque_maximo=?, ncm=?, cfop=?, cest=?, ean=? WHERE id=?",
        (d.get("codigo"), d.get("codigo_barras"), d.get("nome"), d.get("categoria"),
         d.get("marca"), d.get("fornecedor_id"), d.get("localizacao"),
         d.get("preco_compra", 0), d.get("preco_venda", 0),
         d.get("estoque_minimo", 0), d.get("estoque_maximo", 0), d.get("ncm"),
         d.get("cfop"), d.get("cest"), d.get("ean"), pid),
        commit=True,
    )
    registrar_log(session["user_id"], "editar_produto", str(pid))
    return jsonify({"ok": True})


@produtos_bp.route("/api/produtos/<int:pid>", methods=["DELETE"])
@login_obrigatorio
def excluir_produto(pid):
    query("DELETE FROM produtos WHERE id=?", (pid,), commit=True)
    registrar_log(session["user_id"], "excluir_produto", str(pid))
    return jsonify({"ok": True})


# =========================================================================
# SERVIÇOS
# =========================================================================
@produtos_bp.route("/api/servicos", methods=["GET"])
@login_obrigatorio
def listar_servicos():
    q = request.args.get("q", "").strip()
    where, params = "", []
    if q:
        where = "WHERE descricao LIKE ? OR categoria LIKE ?"
        params = [f"%{q}%", f"%{q}%"]
    lista = query(f"SELECT * FROM servicos {where} ORDER BY descricao", params)
    return jsonify({"dados": lista, "total": len(lista)})


@produtos_bp.route("/api/servicos", methods=["POST"])
@login_obrigatorio
def criar_servico():
    d = request.get_json(force=True)
    res = query(
        "INSERT INTO servicos (descricao, tempo_medio, valor, garantia, categoria, criado_em) "
        "VALUES (?,?,?,?,?,?)",
        (d.get("descricao"), d.get("tempo_medio"), d.get("valor", 0),
         d.get("garantia"), d.get("categoria"), now()),
        commit=True,
    )
    return jsonify({"ok": True, "id": res["_lastid"]}), 201


@produtos_bp.route("/api/servicos/<int:sid>", methods=["PUT"])
@login_obrigatorio
def editar_servico(sid):
    d = request.get_json(force=True)
    query("UPDATE servicos SET descricao=?, tempo_medio=?, valor=?, garantia=?, categoria=? WHERE id=?",
          (d.get("descricao"), d.get("tempo_medio"), d.get("valor", 0),
           d.get("garantia"), d.get("categoria"), sid), commit=True)
    return jsonify({"ok": True})


@produtos_bp.route("/api/servicos/<int:sid>", methods=["DELETE"])
@login_obrigatorio
def excluir_servico(sid):
    query("DELETE FROM servicos WHERE id=?", (sid,), commit=True)
    return jsonify({"ok": True})


# =========================================================================
# FORNECEDORES
# =========================================================================
@produtos_bp.route("/api/fornecedores", methods=["GET"])
@login_obrigatorio
def listar_fornecedores():
    lista = query("SELECT * FROM fornecedores ORDER BY nome")
    return jsonify({"dados": lista, "total": len(lista)})


@produtos_bp.route("/api/fornecedores", methods=["POST"])
@login_obrigatorio
def criar_fornecedor():
    d = request.get_json(force=True)
    res = query("INSERT INTO fornecedores (nome, cnpj, telefone, email, criado_em) VALUES (?,?,?,?,?)",
                (d.get("nome"), d.get("cnpj"), d.get("telefone"), d.get("email"), now()),
                commit=True)
    return jsonify({"ok": True, "id": res["_lastid"]}), 201
