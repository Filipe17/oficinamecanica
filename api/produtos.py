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
    # Marca produtos pai que têm variações (para o front mostrar "—" no estoque)
    ids = [p["id"] for p in lista]
    variacoes_ids = set()
    if ids:
        rows = query(
            f"SELECT DISTINCT produto_pai_id FROM produtos WHERE produto_pai_id IN ({','.join('?' * len(ids))})",
            ids)
        variacoes_ids = {r["produto_pai_id"] for r in rows}
    for p in lista:
        p["margem"] = _margem(p.get("preco_compra"), p.get("preco_venda"))
        p["tem_variacoes"] = p["id"] in variacoes_ids
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
        "estoque_minimo, estoque_maximo, ncm, cfop, cest, ean, comissao_percentual, criado_em) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (d.get("codigo"), d.get("codigo_barras"), d.get("nome"), d.get("categoria"),
         d.get("marca"), d.get("fornecedor_id"), d.get("localizacao"),
         d.get("preco_compra", 0), d.get("preco_venda", 0), d.get("estoque_atual", 0),
         d.get("estoque_minimo", 0), d.get("estoque_maximo", 0), d.get("ncm"),
         d.get("cfop"), d.get("cest"), d.get("ean"), d.get("comissao_percentual", 0), now()),
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
        "estoque_minimo=?, estoque_maximo=?, ncm=?, cfop=?, cest=?, ean=?, "
        "comissao_percentual=? WHERE id=?",
        (d.get("codigo"), d.get("codigo_barras"), d.get("nome"), d.get("categoria"),
         d.get("marca"), d.get("fornecedor_id"), d.get("localizacao"),
         d.get("preco_compra", 0), d.get("preco_venda", 0),
         d.get("estoque_minimo", 0), d.get("estoque_maximo", 0), d.get("ncm"),
         d.get("cfop"), d.get("cest"), d.get("ean"), d.get("comissao_percentual", 0), pid),
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
        "INSERT INTO servicos (descricao, tempo_medio, valor, garantia, categoria, "
        "comissao_percentual, codigo_servico, iss_percentual, criado_em) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        (d.get("descricao"), d.get("tempo_medio"), d.get("valor", 0),
         d.get("garantia"), d.get("categoria"), d.get("comissao_percentual", 0),
         d.get("codigo_servico"), d.get("iss_percentual", 0), now()),
        commit=True,
    )
    return jsonify({"ok": True, "id": res["_lastid"]}), 201


@produtos_bp.route("/api/servicos/<int:sid>", methods=["PUT"])
@login_obrigatorio
def editar_servico(sid):
    d = request.get_json(force=True)
    query("UPDATE servicos SET descricao=?, tempo_medio=?, valor=?, garantia=?, categoria=?, "
          "comissao_percentual=?, codigo_servico=?, iss_percentual=? WHERE id=?",
          (d.get("descricao"), d.get("tempo_medio"), d.get("valor", 0),
           d.get("garantia"), d.get("categoria"), d.get("comissao_percentual", 0),
           d.get("codigo_servico"), d.get("iss_percentual", 0), sid), commit=True)
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
    q = request.args.get("q", "").strip()
    where, params = "", []
    if q:
        where = "WHERE nome LIKE ? OR nome_fantasia LIKE ? OR cnpj LIKE ? OR cidade LIKE ?"
        params = [f"%{q}%"] * 4
    lista = query(f"SELECT * FROM fornecedores {where} ORDER BY nome", params)
    # Conta produtos vinculados a cada fornecedor
    for f in lista:
        r = query("SELECT COUNT(*) AS n FROM produtos WHERE fornecedor_id=? AND (produto_pai_id IS NULL OR produto_pai_id=0)",
                  (f["id"],), fetchone=True)
        f["qtd_produtos"] = r["n"] if r else 0
    return jsonify({"dados": lista, "total": len(lista)})


@produtos_bp.route("/api/fornecedores/<int:fid>", methods=["GET"])
@login_obrigatorio
def detalhe_fornecedor(fid):
    f = query("SELECT * FROM fornecedores WHERE id=?", (fid,), fetchone=True)
    if not f:
        return jsonify({"erro": "Fornecedor não encontrado"}), 404
    f["produtos"] = query(
        "SELECT id, nome, codigo, estoque_atual, preco_compra FROM produtos "
        "WHERE fornecedor_id=? AND (produto_pai_id IS NULL OR produto_pai_id=0) ORDER BY nome",
        (fid,))
    return jsonify(f)


@produtos_bp.route("/api/fornecedores", methods=["POST"])
@login_obrigatorio
def criar_fornecedor():
    d = request.get_json(force=True)
    if not d.get("nome"):
        return jsonify({"erro": "Nome é obrigatório"}), 400
    res = query(
        "INSERT INTO fornecedores (nome, nome_fantasia, cnpj, ie, telefone, telefone2, "
        "email, contato, site, endereco, numero, bairro, cidade, estado, cep, "
        "prazo_pagamento, observacoes, criado_em) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (d.get("nome"), d.get("nome_fantasia"), d.get("cnpj"), d.get("ie"),
         d.get("telefone"), d.get("telefone2"), d.get("email"), d.get("contato"),
         d.get("site"), d.get("endereco"), d.get("numero"), d.get("bairro"),
         d.get("cidade"), d.get("estado"), d.get("cep"),
         d.get("prazo_pagamento"), d.get("observacoes"), now()),
        commit=True)
    registrar_log(session["user_id"], "criar_fornecedor", d.get("nome"))
    return jsonify({"ok": True, "id": res["_lastid"]}), 201


@produtos_bp.route("/api/fornecedores/<int:fid>", methods=["PUT"])
@login_obrigatorio
def editar_fornecedor(fid):
    d = request.get_json(force=True)
    query(
        "UPDATE fornecedores SET nome=?, nome_fantasia=?, cnpj=?, ie=?, telefone=?, "
        "telefone2=?, email=?, contato=?, site=?, endereco=?, numero=?, bairro=?, "
        "cidade=?, estado=?, cep=?, prazo_pagamento=?, observacoes=? WHERE id=?",
        (d.get("nome"), d.get("nome_fantasia"), d.get("cnpj"), d.get("ie"),
         d.get("telefone"), d.get("telefone2"), d.get("email"), d.get("contato"),
         d.get("site"), d.get("endereco"), d.get("numero"), d.get("bairro"),
         d.get("cidade"), d.get("estado"), d.get("cep"),
         d.get("prazo_pagamento"), d.get("observacoes"), fid),
        commit=True)
    registrar_log(session["user_id"], "editar_fornecedor", str(fid))
    return jsonify({"ok": True})


@produtos_bp.route("/api/fornecedores/<int:fid>", methods=["DELETE"])
@login_obrigatorio
def excluir_fornecedor(fid):
    # Verifica se tem produtos vinculados
    n = query("SELECT COUNT(*) AS n FROM produtos WHERE fornecedor_id=?",
              (fid,), fetchone=True)["n"]
    if n > 0:
        return jsonify({"erro": f"Fornecedor possui {n} produto(s) vinculado(s). Desvincule antes de excluir."}), 400
    query("DELETE FROM fornecedores WHERE id=?", (fid,), commit=True)
    registrar_log(session["user_id"], "excluir_fornecedor", str(fid))
    return jsonify({"ok": True})


# =========================================================================
# GRADE DE PRODUTOS (variações)
# =========================================================================

@produtos_bp.route("/api/produtos/<int:pid>/variacoes", methods=["GET"])
@login_obrigatorio
def listar_variacoes(pid):
    """Lista as variações de um produto pai."""
    pai = query("SELECT id, nome FROM produtos WHERE id=? AND (produto_pai_id IS NULL OR produto_pai_id=0)",
                (pid,), fetchone=True)
    if not pai:
        return jsonify({"erro": "Produto pai não encontrado"}), 404
    variacoes = query(
        "SELECT * FROM produtos WHERE produto_pai_id=? ORDER BY variacao_atributo", (pid,))
    for v in variacoes:
        v["_margem"] = _margem(v.get("preco_compra"), v.get("preco_venda"))
    return jsonify({"pai": pai, "variacoes": variacoes})


@produtos_bp.route("/api/produtos/<int:pid>/variacoes", methods=["POST"])
@login_obrigatorio
def criar_variacao(pid):
    """Cria uma nova variação de um produto pai."""
    pai = query("SELECT * FROM produtos WHERE id=?", (pid,), fetchone=True)
    if not pai:
        return jsonify({"erro": "Produto pai não encontrado"}), 404
    d = request.get_json(force=True)
    if not d.get("variacao_atributo"):
        return jsonify({"erro": "Atributo da variação é obrigatório (ex: 1L, 175/65R14)"}), 400
    # Herda campos do pai quando não informados
    res = query(
        "INSERT INTO produtos (produto_pai_id, variacao_atributo, codigo, codigo_barras, "
        "nome, categoria, marca, fornecedor_id, localizacao, preco_compra, preco_venda, "
        "estoque_atual, estoque_minimo, estoque_maximo, ncm, cfop, cest, ean, "
        "comissao_percentual, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (pid, d.get("variacao_atributo"),
         d.get("codigo"), d.get("codigo_barras"),
         f"{pai['nome']} — {d['variacao_atributo']}",   # nome automático
         pai.get("categoria"), pai.get("marca"), pai.get("fornecedor_id"),
         pai.get("localizacao"),
         d.get("preco_compra", pai.get("preco_compra", 0)),
         d.get("preco_venda", pai.get("preco_venda", 0)),
         d.get("estoque_atual", 0),
         d.get("estoque_minimo", pai.get("estoque_minimo", 0)),
         d.get("estoque_maximo", pai.get("estoque_maximo", 0)),
         pai.get("ncm"), pai.get("cfop"), pai.get("cest"), d.get("ean"),
         d.get("comissao_percentual", pai.get("comissao_percentual", 0)), now()),
        commit=True,
    )
    registrar_log(session["user_id"], "criar_variacao",
                  f"pai={pid} atributo={d['variacao_atributo']}")
    return jsonify({"ok": True, "id": res["_lastid"]}), 201


@produtos_bp.route("/api/produtos/variacoes/<int:vid>", methods=["PUT"])
@login_obrigatorio
def editar_variacao(vid):
    """Edita uma variação (atributo, código, preços, estoque)."""
    d = request.get_json(force=True)
    query(
        "UPDATE produtos SET variacao_atributo=?, codigo=?, codigo_barras=?, "
        "preco_compra=?, preco_venda=?, estoque_minimo=?, estoque_maximo=?, "
        "comissao_percentual=?, ean=? WHERE id=? AND produto_pai_id IS NOT NULL",
        (d.get("variacao_atributo"), d.get("codigo"), d.get("codigo_barras"),
         d.get("preco_compra", 0), d.get("preco_venda", 0),
         d.get("estoque_minimo", 0), d.get("estoque_maximo", 0),
         d.get("comissao_percentual", 0), d.get("ean"), vid),
        commit=True,
    )
    registrar_log(session["user_id"], "editar_variacao", str(vid))
    return jsonify({"ok": True})


@produtos_bp.route("/api/produtos/variacoes/<int:vid>", methods=["DELETE"])
@login_obrigatorio
def excluir_variacao(vid):
    """Remove uma variação. Não permite excluir produto pai diretamente."""
    v = query("SELECT produto_pai_id FROM produtos WHERE id=?", (vid,), fetchone=True)
    if not v or not v.get("produto_pai_id"):
        return jsonify({"erro": "Use a exclusão de produto para produtos sem variação"}), 400
    query("DELETE FROM produtos WHERE id=?", (vid,), commit=True)
    registrar_log(session["user_id"], "excluir_variacao", str(vid))
    return jsonify({"ok": True})
