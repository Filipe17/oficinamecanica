"""
veiculos.py — CRUD de veículos, vinculados a um cliente.
Mesma estrutura em camadas dos demais módulos.
"""

from flask import Blueprint, request, jsonify, session
from database.database import query, now, registrar_log
from api.usuarios import login_obrigatorio

veiculos_bp = Blueprint("veiculos", __name__)


@veiculos_bp.route("/api/veiculos", methods=["GET"])
@login_obrigatorio
def listar():
    q = request.args.get("q", "").strip()
    pagina = max(int(request.args.get("pagina", 1)), 1)
    por_pagina = min(int(request.args.get("por_pagina", 20)), 100)

    # JOIN para trazer o nome do cliente junto (evita chamadas extras no front)
    base = ("SELECT v.*, c.nome AS cliente_nome FROM veiculos v "
            "LEFT JOIN clientes c ON c.id = v.cliente_id")
    where, params = "", []
    if q:
        where = "WHERE v.placa LIKE ? OR v.modelo LIKE ? OR v.marca LIKE ? OR c.nome LIKE ?"
        termo = f"%{q}%"
        params = [termo, termo, termo, termo]

    total = query(f"SELECT COUNT(*) AS n FROM veiculos v "
                  f"LEFT JOIN clientes c ON c.id=v.cliente_id {where}",
                  params, fetchone=True)["n"]
    offset = (pagina - 1) * por_pagina
    lista = query(f"{base} {where} ORDER BY v.id DESC LIMIT ? OFFSET ?",
                  params + [por_pagina, offset])
    return jsonify({
        "dados": lista, "total": total, "pagina": pagina,
        "por_pagina": por_pagina,
        "paginas": (total + por_pagina - 1) // por_pagina,
    })


@veiculos_bp.route("/api/veiculos/<int:vid>", methods=["GET"])
@login_obrigatorio
def detalhe(vid):
    v = query("SELECT * FROM veiculos WHERE id=?", (vid,), fetchone=True)
    if not v:
        return jsonify({"erro": "Veículo não encontrado"}), 404
    v["manutencoes"] = query(
        "SELECT id, numero, data, status, total FROM ordens_servico "
        "WHERE veiculo_id=? ORDER BY id DESC", (vid,))
    return jsonify(v)


@veiculos_bp.route("/api/veiculos", methods=["POST"])
@login_obrigatorio
def criar():
    d = request.get_json(force=True)
    res = query(
        "INSERT INTO veiculos (cliente_id, marca, modelo, ano, motor, combustivel, "
        "placa, renavam, cor, quilometragem, chassi, criado_em) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (d.get("cliente_id"), d.get("marca"), d.get("modelo"), d.get("ano"),
         d.get("motor"), d.get("combustivel"), d.get("placa"), d.get("renavam"),
         d.get("cor"), d.get("quilometragem", 0), d.get("chassi"), now()),
        commit=True,
    )
    registrar_log(session["user_id"], "criar_veiculo", d.get("placa"))
    return jsonify({"ok": True, "id": res["_lastid"]}), 201


@veiculos_bp.route("/api/veiculos/<int:vid>", methods=["PUT"])
@login_obrigatorio
def editar(vid):
    d = request.get_json(force=True)
    query(
        "UPDATE veiculos SET cliente_id=?, marca=?, modelo=?, ano=?, motor=?, "
        "combustivel=?, placa=?, renavam=?, cor=?, quilometragem=?, chassi=? WHERE id=?",
        (d.get("cliente_id"), d.get("marca"), d.get("modelo"), d.get("ano"),
         d.get("motor"), d.get("combustivel"), d.get("placa"), d.get("renavam"),
         d.get("cor"), d.get("quilometragem", 0), d.get("chassi"), vid),
        commit=True,
    )
    registrar_log(session["user_id"], "editar_veiculo", str(vid))
    return jsonify({"ok": True})


@veiculos_bp.route("/api/veiculos/<int:vid>", methods=["DELETE"])
@login_obrigatorio
def excluir(vid):
    query("DELETE FROM veiculos WHERE id=?", (vid,), commit=True)
    registrar_log(session["user_id"], "excluir_veiculo", str(vid))
    return jsonify({"ok": True})
