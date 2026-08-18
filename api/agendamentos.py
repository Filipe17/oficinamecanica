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
        f"SELECT a.*, c.nome AS cliente_nome, c.whatsapp, c.telefone, "
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


# =========================================================================
# LEMBRETES DE REVISÃO
# =========================================================================

@agendamentos_bp.route("/api/lembretes", methods=["GET"])
@login_obrigatorio
def listar_lembretes():
    status = request.args.get("status", "pendente").strip()
    intervalo = int(request.args.get("intervalo", 180))
    _gerar_lembretes_automaticos(intervalo)
    where, params = ["1=1"], []
    if status != "todos":
        where.append("l.status = ?")
        params.append(status)
    lista = query(
        f"SELECT l.*, c.nome AS cliente_nome, c.telefone, c.whatsapp, c.email, "
        f"v.placa AS veiculo_placa, v.modelo AS veiculo_modelo, v.marca AS veiculo_marca "
        f"FROM lembretes_revisao l "
        f"LEFT JOIN clientes c ON c.id=l.cliente_id "
        f"LEFT JOIN veiculos v ON v.id=l.veiculo_id "
        f"WHERE {' AND '.join(where)} ORDER BY l.data_prevista", params)
    from datetime import date
    hoje = date.today().isoformat()
    for l in lista:
        l["atrasado"] = (l.get("data_prevista") or "") < hoje and l["status"] == "pendente"
    total_pendente = query("SELECT COUNT(*) AS n FROM lembretes_revisao WHERE status='pendente'", fetchone=True)["n"]
    total_atrasado = query("SELECT COUNT(*) AS n FROM lembretes_revisao WHERE status='pendente' AND data_prevista < ?", (hoje,), fetchone=True)["n"]
    return jsonify({"dados": lista, "total": len(lista), "total_pendente": total_pendente, "total_atrasado": total_atrasado})


def _gerar_lembretes_automaticos(intervalo_dias=180):
    from datetime import date, timedelta
    sem_lembrete = query(
        "SELECT o.id, o.cliente_id, o.veiculo_id, o.data FROM ordens_servico o "
        "WHERE o.status='finalizada' AND o.eh_orcamento=0 AND o.cliente_id IS NOT NULL "
        "AND NOT EXISTS (SELECT 1 FROM lembretes_revisao l WHERE l.os_id=o.id)")
    for os in sem_lembrete:
        data_os = (os.get("data") or "")[:10]
        if not data_os: continue
        try:
            dt = date.fromisoformat(data_os)
            data_prevista = (dt + timedelta(days=intervalo_dias)).isoformat()
        except Exception: continue
        query(
            "INSERT INTO lembretes_revisao (cliente_id, veiculo_id, os_id, "
            "data_ultima_os, data_prevista, intervalo_dias, status, criado_em) VALUES (?,?,?,?,?,?,?,?)",
            (os["cliente_id"], os.get("veiculo_id"), os["id"],
             data_os, data_prevista, intervalo_dias, "pendente", now()), commit=True)


@agendamentos_bp.route("/api/lembretes/<int:lid>/registrar", methods=["POST"])
@login_obrigatorio
def registrar_lembrete(lid):
    d = request.get_json(force=True)
    query("UPDATE lembretes_revisao SET status=?, canal_envio=?, enviado_em=?, obs=? WHERE id=?",
          (d.get("acao", "enviado"), d.get("canal", "manual"), now(), d.get("obs"), lid), commit=True)
    registrar_log(session["user_id"], f"lembrete_{d.get('acao','enviado')}", str(lid))
    return jsonify({"ok": True})


@agendamentos_bp.route("/api/lembretes/<int:lid>/reagendar", methods=["POST"])
@login_obrigatorio
def reagendar_lembrete(lid):
    d = request.get_json(force=True)
    nova_data = d.get("data_prevista")
    if not nova_data: return jsonify({"erro": "data_prevista obrigatória"}), 400
    query("UPDATE lembretes_revisao SET data_prevista=?, status='pendente', obs=? WHERE id=?",
          (nova_data, d.get("obs"), lid), commit=True)
    return jsonify({"ok": True})


@agendamentos_bp.route("/api/lembretes/email", methods=["POST"])
@login_obrigatorio
def enviar_lembrete_email():
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    from api.configuracoes import obter_config
    from datetime import date
    d = request.get_json(force=True)
    lid = d.get("lembrete_id")
    l = query(
        "SELECT lr.*, c.nome AS cliente_nome, c.email AS cliente_email, v.placa, v.modelo, v.marca "
        "FROM lembretes_revisao lr LEFT JOIN clientes c ON c.id=lr.cliente_id "
        "LEFT JOIN veiculos v ON v.id=lr.veiculo_id WHERE lr.id=?", (lid,), fetchone=True)
    if not l: return jsonify({"erro": "Lembrete não encontrado"}), 404
    email_dest = (d.get("email") or l.get("cliente_email") or "").strip()
    if not email_dest: return jsonify({"erro": "Cliente sem email cadastrado"}), 400
    cfg = obter_config()
    smtp_host = cfg.get("smtp_host","").strip()
    smtp_porta = int(cfg.get("smtp_porta") or 587)
    smtp_user  = cfg.get("smtp_usuario","").strip()
    smtp_pass  = cfg.get("smtp_senha","").strip()
    smtp_ssl   = str(cfg.get("smtp_ssl","")).lower() in ("1","true","sim")
    email_rem  = cfg.get("smtp_email_remetente") or smtp_user
    nome_rem   = cfg.get("smtp_nome_remetente") or cfg.get("empresa_nome") or "Oficina"
    empresa    = cfg.get("empresa_nome") or "Oficina"
    tel        = cfg.get("empresa_telefone") or ""
    if not smtp_host or not smtp_user or not smtp_pass:
        return jsonify({"erro": "Configure o SMTP em Configurações"}), 400
    veiculo = f"{l.get('veiculo_marca','')} {l.get('veiculo_modelo','')} — {l.get('placa','')}".strip(" —")
    data_fmt = (l.get("data_prevista") or "")[:10]
    try:
        from datetime import datetime
        data_fmt = datetime.strptime(data_fmt, "%Y-%m-%d").strftime("%d/%m/%Y")
    except Exception: pass
    corpo_extra = f"<p>{d.get('mensagem')}</p>" if d.get("mensagem") else ""
    hoje = date.today().strftime("%d/%m/%Y")
    html = f"""<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto">
      <div style="background:#0d9488;padding:20px 24px;border-radius:8px 8px 0 0">
        <h2 style="color:#fff;margin:0">Lembrete de Revisão</h2>
        <p style="color:#ccfbf1;margin:4px 0 0">{empresa}</p>
      </div>
      <div style="background:#fff;padding:24px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px">
        <p>Olá <strong>{l.get('cliente_nome','')}</strong>,</p>
        <p>Já está na hora de trazer seu veículo para uma revisão! 🔧</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f9fafb;border-radius:6px">
          <tr><td style="padding:10px 14px;border-bottom:1px solid #eee"><strong>Veículo</strong></td>
              <td style="padding:10px 14px;border-bottom:1px solid #eee">{veiculo or "—"}</td></tr>
          <tr><td style="padding:10px 14px;border-bottom:1px solid #eee"><strong>Última revisão</strong></td>
              <td style="padding:10px 14px;border-bottom:1px solid #eee">{l.get('data_ultima_os','—')}</td></tr>
          <tr style="background:#fef3c7"><td style="padding:10px 14px"><strong>Revisão prevista</strong></td>
              <td style="padding:10px 14px"><strong style="color:#0d9488">{data_fmt}</strong></td></tr>
        </table>
        {corpo_extra}
        <p>Entre em contato para agendar: <strong>{tel}</strong></p>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
        <p style="font-size:11px;color:#aaa">{empresa} — {hoje}</p>
      </div>
    </div>"""
    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"Lembrete de Revisão — {empresa}"
    msg["From"] = f"{nome_rem} <{email_rem}>"
    msg["To"] = email_dest
    msg.attach(MIMEText(html, "html", "utf-8"))
    try:
        srv = smtplib.SMTP_SSL(smtp_host, smtp_porta, timeout=15) if smtp_ssl \
              else smtplib.SMTP(smtp_host, smtp_porta, timeout=15)
        if not smtp_ssl: srv.starttls()
        srv.login(smtp_user, smtp_pass)
        srv.sendmail(email_rem, [email_dest], msg.as_string())
        srv.quit()
    except Exception as e:
        return jsonify({"erro": f"Falha ao enviar email: {e}"}), 500
    query("UPDATE lembretes_revisao SET status='enviado', canal_envio='email', enviado_em=? WHERE id=?",
          (now(), lid), commit=True)
    registrar_log(session["user_id"], "lembrete_email", f"lid={lid} para={email_dest}")
    return jsonify({"ok": True, "enviado_para": email_dest})
