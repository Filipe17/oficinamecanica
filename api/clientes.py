"""
clientes.py — CRUD de clientes com busca, ordenação e paginação.

Padrão seguido por vários módulos:
    GET    /api/clientes            -> lista (aceita ?q=, ?pagina=, ?por_pagina=, ?ordem=)
    GET    /api/clientes/<id>       -> detalhe (+ veículos + histórico de OS)
    POST   /api/clientes            -> cria
    PUT    /api/clientes/<id>       -> atualiza
    DELETE /api/clientes/<id>       -> remove
"""

from flask import Blueprint, request, jsonify, session
from database.database import query, now, registrar_log
from api.usuarios import login_obrigatorio

clientes_bp = Blueprint("clientes", __name__)

# Colunas que podem ser usadas na ordenação (evita SQL injection no ORDER BY)
ORDENAVEIS = {"nome", "cidade", "criado_em", "id"}


@clientes_bp.route("/api/clientes", methods=["GET"])
@login_obrigatorio
def listar():
    q = request.args.get("q", "").strip()
    pagina = max(int(request.args.get("pagina", 1)), 1)
    por_pagina = min(int(request.args.get("por_pagina", 20)), 100)
    ordem = request.args.get("ordem", "nome")
    ordem = ordem if ordem in ORDENAVEIS else "nome"

    where, params = "", []
    if q:
        where = "WHERE nome LIKE ? OR cpf_cnpj LIKE ? OR telefone LIKE ? OR cidade LIKE ?"
        termo = f"%{q}%"
        params = [termo, termo, termo, termo]

    total = query(f"SELECT COUNT(*) AS n FROM clientes {where}",
                  params, fetchone=True)["n"]

    offset = (pagina - 1) * por_pagina
    lista = query(
        f"SELECT * FROM clientes {where} ORDER BY {ordem} LIMIT ? OFFSET ?",
        params + [por_pagina, offset],
    )
    return jsonify({
        "dados": lista,
        "total": total,
        "pagina": pagina,
        "por_pagina": por_pagina,
        "paginas": (total + por_pagina - 1) // por_pagina,
    })


@clientes_bp.route("/api/clientes/<int:cid>", methods=["GET"])
@login_obrigatorio
def detalhe(cid):
    cliente = query("SELECT * FROM clientes WHERE id=?", (cid,), fetchone=True)
    if not cliente:
        return jsonify({"erro": "Cliente não encontrado"}), 404
    cliente["veiculos"] = query("SELECT * FROM veiculos WHERE cliente_id=?", (cid,))
    cliente["historico"] = query(
        "SELECT id, numero, data, status, total FROM ordens_servico "
        "WHERE cliente_id=? ORDER BY id DESC LIMIT 20", (cid,))
    return jsonify(cliente)


@clientes_bp.route("/api/clientes", methods=["POST"])
@login_obrigatorio
def criar():
    d = request.get_json(force=True)
    if not d.get("nome"):
        return jsonify({"erro": "Nome é obrigatório"}), 400
    res = query(
        "INSERT INTO clientes (tipo, cpf_cnpj, nome, telefone, whatsapp, email, "
        "cep, endereco, cidade, estado, observacoes, criado_em) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (d.get("tipo", "PF"), d.get("cpf_cnpj"), d.get("nome"), d.get("telefone"),
         d.get("whatsapp"), d.get("email"), d.get("cep"), d.get("endereco"),
         d.get("cidade"), d.get("estado"), d.get("observacoes"), now()),
        commit=True,
    )
    registrar_log(session["user_id"], "criar_cliente", d.get("nome"))
    return jsonify({"ok": True, "id": res["_lastid"]}), 201


@clientes_bp.route("/api/clientes/<int:cid>", methods=["PUT"])
@login_obrigatorio
def editar(cid):
    d = request.get_json(force=True)
    query(
        "UPDATE clientes SET tipo=?, cpf_cnpj=?, nome=?, telefone=?, whatsapp=?, "
        "email=?, cep=?, endereco=?, cidade=?, estado=?, observacoes=? WHERE id=?",
        (d.get("tipo", "PF"), d.get("cpf_cnpj"), d.get("nome"), d.get("telefone"),
         d.get("whatsapp"), d.get("email"), d.get("cep"), d.get("endereco"),
         d.get("cidade"), d.get("estado"), d.get("observacoes"), cid),
        commit=True,
    )
    registrar_log(session["user_id"], "editar_cliente", str(cid))
    return jsonify({"ok": True})


@clientes_bp.route("/api/clientes/<int:cid>", methods=["DELETE"])
@login_obrigatorio
def excluir(cid):
    query("DELETE FROM clientes WHERE id=?", (cid,), commit=True)
    registrar_log(session["user_id"], "excluir_cliente", str(cid))
    return jsonify({"ok": True})
