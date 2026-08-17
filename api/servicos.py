"""
servicos.py — CRUD do catálogo de serviços (mão de obra) da oficina.

Tabela: servicos
Campos: id, descricao, valor, garantia, codigo_servico, iss_percentual, criado_em
"""

from flask import Blueprint, request, jsonify, session
from database.database import query, now, registrar_log
from api.usuarios import login_obrigatorio

servicos_bp = Blueprint("servicos", __name__)


def _garantir_tabela():
    """Garante que a tabela e colunas extras existem (migração não-destrutiva)."""
    query("""
        CREATE TABLE IF NOT EXISTS servicos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            descricao TEXT NOT NULL,
            valor REAL,
            garantia TEXT,
            codigo_servico TEXT,
            iss_percentual REAL,
            criado_em TEXT
        )
    """, commit=True)
    # Colunas adicionadas posteriormente (seguro rodar sempre)
    for col, tipo in [
        ("codigo_servico", "TEXT"),
        ("iss_percentual", "REAL"),
    ]:
        try:
            query(f"ALTER TABLE servicos ADD COLUMN {col} {tipo}", commit=True)
        except Exception:
            pass  # coluna já existe


_garantir_tabela()


@servicos_bp.route("/api/servicos", methods=["GET"])
@login_obrigatorio
def listar():
    q = request.args.get("q", "").strip().upper()
    if q:
        dados = query(
            "SELECT * FROM servicos WHERE UPPER(descricao) LIKE ? ORDER BY descricao",
            (f"%{q}%",))
    else:
        dados = query("SELECT * FROM servicos ORDER BY descricao")
    return jsonify({"dados": dados})


@servicos_bp.route("/api/servicos", methods=["POST"])
@login_obrigatorio
def criar():
    d = request.get_json(force=True)
    if not (d.get("descricao") or "").strip():
        return jsonify({"erro": "Descrição é obrigatória"}), 400
    res = query(
        "INSERT INTO servicos (descricao, valor, garantia, codigo_servico, iss_percentual, criado_em) "
        "VALUES (?,?,?,?,?,?)",
        (d["descricao"].strip(), d.get("valor") or None,
         d.get("garantia") or None, d.get("codigo_servico") or None,
         d.get("iss_percentual") or None, now()),
        commit=True,
    )
    registrar_log(session["user_id"], "criar_servico", d["descricao"])
    return jsonify({"ok": True, "id": res["_lastid"]}), 201


@servicos_bp.route("/api/servicos/<int:sid>", methods=["PUT"])
@login_obrigatorio
def editar(sid):
    d = request.get_json(force=True)
    if not (d.get("descricao") or "").strip():
        return jsonify({"erro": "Descrição é obrigatória"}), 400
    query(
        "UPDATE servicos SET descricao=?, valor=?, garantia=?, "
        "codigo_servico=?, iss_percentual=? WHERE id=?",
        (d["descricao"].strip(), d.get("valor") or None,
         d.get("garantia") or None, d.get("codigo_servico") or None,
         d.get("iss_percentual") or None, sid),
        commit=True,
    )
    registrar_log(session["user_id"], "editar_servico", str(sid))
    return jsonify({"ok": True})


@servicos_bp.route("/api/servicos/<int:sid>", methods=["DELETE"])
@login_obrigatorio
def excluir(sid):
    query("DELETE FROM servicos WHERE id=?", (sid,), commit=True)
    registrar_log(session["user_id"], "excluir_servico", str(sid))
    return jsonify({"ok": True})
