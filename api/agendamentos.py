"""
agendamentos.py — Agenda de horários dos veículos que vão entrar na oficina.

Um agendamento (cliente + veículo + data/hora + serviço + mecânico) organiza
a entrada dos carros. Fluxo de status:
    agendado -> confirmado -> compareceu | faltou | cancelado

Do agendamento é possível GERAR UMA OS (cria a ordem de serviço já com
cliente/veículo/mecânico/problema e marca o agendamento como 'compareceu').
"""

from flask import Blueprint, request, jsonify, session
from database.database import query, now, registrar_log
from api.usuarios import login_obrigatorio, perfil_permitido

agendamentos_bp = Blueprint("agendamentos", __name__)

STATUS_VALIDOS = {"agendado", "confirmado", "compareceu", "faltou", "cancelado"}


def _proximo_numero_os():
    r = query("SELECT COUNT(*) AS n FROM ordens_servico", fetchone=True)
    return f"OS-{(r['n'] + 1):06d}"


@agendamentos_bp.route("/api/agendamentos", methods=["GET"])
@login_obrigatorio
def listar():
    """Lista agendamentos, com filtro opcional por período (?inicio=&fim=) e status."""
    inicio = request.args.get("inicio", "").strip()
    fim = request.args.get("fim", "").strip()
    status = request.args.get("status", "").strip()

    where, params = ["1=1"], []
    if inicio:
        where.append("a.data >= ?"); params.append(inicio)
    if fim:
        where.append("a.data <= ?"); params.append(fim)
    if status:
        where.append("a.status = ?"); params.append(status)

    lista = query(
        f"SELECT a.*, c.nome AS cliente_nome, "
        f"v.placa AS veiculo_placa, v.modelo AS veiculo_modelo, "
        f"u.nome AS mecanico_nome, s.descricao AS servico_nome "
        f"FROM agendamentos a "
        f"LEFT JOIN clientes c ON c.id=a.cliente_id "
        f"LEFT JOIN veiculos v ON v.id=a.veiculo_id "
        f"LEFT JOIN usuarios u ON u.id=a.mecanico_id "
        f"LEFT JOIN servicos s ON s.id=a.servico_id "
        f"WHERE {' AND '.join(where)} ORDER BY a.data, a.hora", params)
    return jsonify({"dados": lista})


@agendamentos_bp.route("/api/agendamentos", methods=["POST"])
@login_obrigatorio
@perfil_permitido("administrador", "gerente", "atendente")
def criar():
    d = request.get_json(force=True)
    if not d.get("cliente_id") or not d.get("data"):
        return jsonify({"erro": "Cliente e data são obrigatórios"}), 400
    res = query(
        "INSERT INTO agendamentos (cliente_id, veiculo_id, mecanico_id, servico_id, "
        "data, hora, descricao, status, criado_em) VALUES (?,?,?,?,?,?,?,?,?)",
        (d.get("cliente_id"), d.get("veiculo_id"), d.get("mecanico_id"),
         d.get("servico_id"), d.get("data"), d.get("hora"), d.get("descricao"),
         d.get("status", "agendado"), now()),
        commit=True)
    registrar_log(session["user_id"], "criar_agendamento", str(res["_lastid"]))
    return jsonify({"ok": True, "id": res["_lastid"]}), 201


@agendamentos_bp.route("/api/agendamentos/<int:aid>", methods=["PUT"])
@login_obrigatorio
@perfil_permitido("administrador", "gerente", "atendente")
def editar(aid):
    d = request.get_json(force=True)
    if d.get("status") and d["status"] not in STATUS_VALIDOS:
        return jsonify({"erro": "Status inválido"}), 400
    reg = query("SELECT id FROM agendamentos WHERE id=?", (aid,), fetchone=True)
    if not reg:
        return jsonify({"erro": "Agendamento não encontrado"}), 404
    query(
        "UPDATE agendamentos SET cliente_id=?, veiculo_id=?, mecanico_id=?, "
        "servico_id=?, data=?, hora=?, descricao=?, status=? WHERE id=?",
        (d.get("cliente_id"), d.get("veiculo_id"), d.get("mecanico_id"),
         d.get("servico_id"), d.get("data"), d.get("hora"), d.get("descricao"),
         d.get("status", "agendado"), aid),
        commit=True)
    registrar_log(session["user_id"], "editar_agendamento", str(aid))
    return jsonify({"ok": True})


@agendamentos_bp.route("/api/agendamentos/<int:aid>/status", methods=["POST"])
@login_obrigatorio
@perfil_permitido("administrador", "gerente", "atendente", "mecanico")
def mudar_status(aid):
    """Atalho para mudar só o status (usado pelos botões do calendário/lista)."""
    d = request.get_json(force=True)
    novo = (d.get("status") or "").strip()
    if novo not in STATUS_VALIDOS:
        return jsonify({"erro": "Status inválido"}), 400
    query("UPDATE agendamentos SET status=? WHERE id=?", (novo, aid), commit=True)
    registrar_log(session["user_id"], "status_agendamento", f"{aid} -> {novo}")
    return jsonify({"ok": True})


@agendamentos_bp.route("/api/agendamentos/<int:aid>", methods=["DELETE"])
@login_obrigatorio
@perfil_permitido("administrador", "gerente", "atendente")
def excluir(aid):
    query("DELETE FROM agendamentos WHERE id=?", (aid,), commit=True)
    registrar_log(session["user_id"], "excluir_agendamento", str(aid))
    return jsonify({"ok": True})


@agendamentos_bp.route("/api/agendamentos/<int:aid>/gerar-os", methods=["POST"])
@login_obrigatorio
@perfil_permitido("administrador", "gerente", "atendente")
def gerar_os(aid):
    """Cria uma OS a partir do agendamento e marca o agendamento como 'compareceu'."""
    a = query("SELECT * FROM agendamentos WHERE id=?", (aid,), fetchone=True)
    if not a:
        return jsonify({"erro": "Agendamento não encontrado"}), 404
    if a.get("os_id"):
        return jsonify({"erro": "Este agendamento já gerou uma OS", "os_id": a["os_id"]}), 400

    servico_txt = ""
    if a.get("servico_id"):
        s = query("SELECT descricao FROM servicos WHERE id=?", (a["servico_id"],), fetchone=True)
        servico_txt = s["descricao"] if s else ""
    problema = a.get("descricao") or servico_txt or "Agendamento"

    res = query(
        "INSERT INTO ordens_servico (numero, cliente_id, veiculo_id, mecanico_id, "
        "data, status, problema, eh_orcamento, desconto, total, criado_em) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (_proximo_numero_os(), a.get("cliente_id"), a.get("veiculo_id"),
         a.get("mecanico_id"), now(), "aberta", problema, 0, 0, 0, now()),
        commit=True)
    oid = res["_lastid"]
    query("UPDATE agendamentos SET os_id=?, status='compareceu' WHERE id=?",
          (oid, aid), commit=True)
    registrar_log(session["user_id"], "agendamento_gerou_os", f"{aid} -> OS {oid}")
    return jsonify({"ok": True, "os_id": oid})


# =========================================================================
# GARANTIAS
# =========================================================================

@agendamentos_bp.route("/api/garantias", methods=["GET"])
@login_obrigatorio
def listar_garantias():
    """Lista garantias com filtro por status. Atualiza automaticamente as vencidas."""
    from datetime import date
    hoje = date.today().isoformat()

    # Atualiza status das garantias vencidas
    query("UPDATE garantias SET status='vencida' WHERE data_fim < ? AND status='vigente'",
          (hoje,), commit=True)

    status = request.args.get("status", "vigente")
    where = "WHERE 1=1"
    params = []
    if status != "todos":
        where += " AND g.status = ?"
        params.append(status)

    lista = query(
        f"SELECT g.*, c.nome AS cliente_nome, c.telefone, c.whatsapp, "
        f"v.placa AS veiculo_placa, v.modelo AS veiculo_modelo, v.marca AS veiculo_marca, "
        f"o.numero AS os_numero "
        f"FROM garantias g "
        f"LEFT JOIN clientes c ON c.id=g.cliente_id "
        f"LEFT JOIN veiculos v ON v.id=g.veiculo_id "
        f"LEFT JOIN ordens_servico o ON o.id=g.os_id "
        f"{where} ORDER BY g.data_fim", params)

    from datetime import datetime
    for g in lista:
        try:
            fim = datetime.strptime(g["data_fim"], "%Y-%m-%d").date()
            g["dias_restantes"] = (fim - date.today()).days
        except Exception:
            g["dias_restantes"] = None

    total_vigente = query("SELECT COUNT(*) AS n FROM garantias WHERE status='vigente'",
                          fetchone=True)["n"]
    vencendo = query(
        "SELECT COUNT(*) AS n FROM garantias WHERE status='vigente' AND data_fim <= ?",
        (date.today().replace(day=date.today().day).isoformat(),), fetchone=True)["n"]

    return jsonify({
        "dados": lista,
        "total": len(lista),
        "total_vigente": total_vigente,
    })


@agendamentos_bp.route("/api/garantias/<int:gid>/acionar", methods=["POST"])
@login_obrigatorio
def acionar_garantia(gid):
    """Marca garantia como acionada pelo cliente."""
    d = request.get_json(force=True)
    query("UPDATE garantias SET status='acionada', obs=? WHERE id=?",
          (d.get("obs"), gid), commit=True)
    registrar_log(session["user_id"], "acionar_garantia", str(gid))
    return jsonify({"ok": True})


@agendamentos_bp.route("/api/garantias/<int:gid>", methods=["DELETE"])
@login_obrigatorio
def excluir_garantia(gid):
    query("DELETE FROM garantias WHERE id=?", (gid,), commit=True)
    return jsonify({"ok": True})
