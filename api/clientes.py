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
    # Calcula saldo devedor (contas abertas+atrasadas) para cada cliente
    for c in lista:
        if float(c.get("limite_credito") or 0) > 0:
            r = query(
                "SELECT COALESCE(SUM(valor),0) AS saldo FROM financeiro "
                "WHERE cliente_id=? AND tipo='receber' AND status IN ('aberto','atrasado','parcial')",
                (c["id"],), fetchone=True)
            c["saldo_devedor"] = round(float(r["saldo"] or 0), 2)
        else:
            c["saldo_devedor"] = None
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
    # Saldo devedor atual
    r = query(
        "SELECT COALESCE(SUM(valor),0) AS saldo FROM financeiro "
        "WHERE cliente_id=? AND tipo='receber' AND status IN ('aberto','atrasado','parcial')",
        (cid,), fetchone=True)
    cliente["saldo_devedor"] = round(float(r["saldo"] or 0), 2)
    limite = float(cliente.get("limite_credito") or 0)
    cliente["credito_disponivel"] = round(max(limite - cliente["saldo_devedor"], 0), 2) if limite > 0 else None
    cliente["limite_atingido"] = limite > 0 and cliente["saldo_devedor"] >= limite
    return jsonify(cliente)


@clientes_bp.route("/api/clientes", methods=["POST"])
@login_obrigatorio
def criar():
    d = request.get_json(force=True)
    if not d.get("nome"):
        return jsonify({"erro": "Nome é obrigatório"}), 400
    res = query(
        "INSERT INTO clientes (tipo, cpf_cnpj, nome, telefone, whatsapp, email, "
        "cep, endereco, numero, bairro, cidade, estado, observacoes, limite_credito, data_nascimento, criado_em) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (d.get("tipo", "PF"), d.get("cpf_cnpj"), d.get("nome"), d.get("telefone"),
         d.get("whatsapp"), d.get("email"), d.get("cep"), d.get("endereco"),
         d.get("numero"), d.get("bairro"), d.get("cidade"), d.get("estado"),
         d.get("observacoes"), float(d.get("limite_credito") or 0), d.get("data_nascimento") or None, now()),
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
        "email=?, cep=?, endereco=?, numero=?, bairro=?, cidade=?, estado=?, "
        "observacoes=?, limite_credito=?, data_nascimento=? WHERE id=?",
        (d.get("tipo", "PF"), d.get("cpf_cnpj"), d.get("nome"), d.get("telefone"),
         d.get("whatsapp"), d.get("email"), d.get("cep"), d.get("endereco"),
         d.get("numero"), d.get("bairro"), d.get("cidade"), d.get("estado"),
         d.get("observacoes"), float(d.get("limite_credito") or 0), d.get("data_nascimento") or None, cid),
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


@clientes_bp.route("/api/clientes/<int:cid>/credito", methods=["GET"])
@login_obrigatorio
def situacao_credito(cid):
    """
    Retorna a situação de crédito do cliente:
    limite, saldo devedor, crédito disponível e se atingiu o limite.
    Usado pela OS e pelo financeiro antes de criar novas contas.
    """
    c = query("SELECT id, nome, limite_credito FROM clientes WHERE id=?",
              (cid,), fetchone=True)
    if not c:
        return jsonify({"erro": "Cliente não encontrado"}), 404
    limite = float(c.get("limite_credito") or 0)
    r = query(
        "SELECT COALESCE(SUM(valor),0) AS saldo FROM financeiro "
        "WHERE cliente_id=? AND tipo='receber' AND status IN ('aberto','atrasado','parcial')",
        (cid,), fetchone=True)
    saldo = round(float(r["saldo"] or 0), 2)
    disponivel = round(max(limite - saldo, 0), 2) if limite > 0 else None
    return jsonify({
        "cliente_id": cid,
        "nome": c["nome"],
        "limite_credito": limite,
        "saldo_devedor": saldo,
        "credito_disponivel": disponivel,
        "tem_limite": limite > 0,
        "limite_atingido": limite > 0 and saldo >= limite,
        "limite_proximo": limite > 0 and saldo >= (limite * 0.8),  # >= 80% usado
    })


# =========================================================================
# ANIVERSARIANTES
# =========================================================================

@clientes_bp.route("/api/clientes/aniversariantes", methods=["GET"])
@login_obrigatorio
def aniversariantes():
    """
    Retorna clientes que fazem aniversário hoje ou nos próximos N dias.
    Requer campo data_nascimento preenchido.
    """
    dias = int(request.args.get("dias", 0))  # 0 = só hoje, 7 = próximos 7 dias
    from datetime import date, timedelta

    hoje = date.today()
    lista = query(
        "SELECT id, nome, telefone, whatsapp, email, data_nascimento "
        "FROM clientes WHERE data_nascimento IS NOT NULL AND data_nascimento != '' "
        "ORDER BY nome")

    aniversariantes = []
    for c in lista:
        try:
            dn = c["data_nascimento"][:10]  # YYYY-MM-DD
            mes_dia = dn[5:]  # MM-DD
            # Compara só mês e dia
            for delta in range(dias + 1):
                alvo = hoje + timedelta(days=delta)
                alvo_str = alvo.strftime("%m-%d")
                if mes_dia == alvo_str:
                    ano_nasc = int(dn[:4])
                    idade = alvo.year - ano_nasc
                    c["idade"] = idade
                    c["dias_para_aniversario"] = delta
                    c["data_aniversario"] = alvo.isoformat()
                    aniversariantes.append(c)
                    break
        except Exception:
            continue

    aniversariantes.sort(key=lambda x: x["dias_para_aniversario"])
    return jsonify({"dados": aniversariantes, "total": len(aniversariantes)})


@clientes_bp.route("/api/clientes/<int:cid>/parabens", methods=["POST"])
@login_obrigatorio
def enviar_parabens(cid):
    """Envia email de parabéns via SMTP para o cliente."""
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    from api.configuracoes import obter_config
    from datetime import date

    c = query("SELECT * FROM clientes WHERE id=?", (cid,), fetchone=True)
    if not c:
        return jsonify({"erro": "Cliente não encontrado"}), 404

    email_dest = (request.get_json(force=True).get("email") or c.get("email") or "").strip()
    if not email_dest:
        return jsonify({"erro": "Cliente sem email cadastrado"}), 400

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

    nome = c.get("nome","").split()[0]  # primeiro nome
    hoje = date.today().strftime("%d/%m/%Y")

    html = f"""<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
      <div style="background:linear-gradient(135deg,#0d9488,#0f766e);padding:30px 24px;
        border-radius:12px 12px 0 0;text-align:center">
        <div style="font-size:3rem;margin-bottom:8px">🎂</div>
        <h2 style="color:#fff;margin:0;font-size:1.4rem">Feliz Aniversário, {nome}!</h2>
        <p style="color:#ccfbf1;margin:6px 0 0">De toda a equipe da {empresa}</p>
      </div>
      <div style="background:#fff;padding:28px 24px;border:1px solid #e0e0e0;
        border-top:none;border-radius:0 0 12px 12px;text-align:center">
        <p style="font-size:1.05rem;color:#333;line-height:1.7">
          Neste dia especial, gostaríamos de desejar muito saúde, alegria e prosperidade!<br>
          Obrigado por confiar em nossos serviços. É sempre um prazer atendê-lo(a)! 🚗✨
        </p>
        {f'<p style="margin-top:16px;color:#555">Qualquer necessidade, estamos à disposição:<br><strong>{tel}</strong></p>' if tel else ""}
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
        <p style="font-size:11px;color:#aaa">{empresa} — {hoje}</p>
      </div>
    </div>"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"🎂 Feliz Aniversário, {nome}! — {empresa}"
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

    registrar_log(session["user_id"], "parabens_email", f"cliente={cid}")
    return jsonify({"ok": True, "enviado_para": email_dest})
