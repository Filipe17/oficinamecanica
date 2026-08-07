"""
financeiro.py — Contas a receber/pagar, baixas, fluxo de caixa e cobranças.

Convenção:
    tipo = 'receber'  -> entrada de dinheiro
    tipo = 'pagar'    -> saída de dinheiro
    status = aberto | parcial | pago | atrasado

O fluxo de caixa é derivado dos lançamentos pagos + vendas do PDV.
"""

from datetime import date
from flask import Blueprint, request, jsonify, session
from database.database import query, now, registrar_log
from api.usuarios import login_obrigatorio, perfil_permitido

financeiro_bp = Blueprint("financeiro", __name__)


def _marcar_atrasados():
    """Atualiza para 'atrasado' os lançamentos abertos/parciais e vencidos."""
    hoje = date.today().isoformat()
    query("UPDATE financeiro SET status='atrasado' "
          "WHERE status IN ('aberto','parcial') AND vencimento < ?",
          (hoje,), commit=True)


def _total_devido(reg):
    """Valor cheio da conta = valor + juros + multa (encargos já gravados)."""
    return (reg["valor"] or 0) + (reg["juros"] or 0) + (reg["multa"] or 0)


@financeiro_bp.route("/api/financeiro", methods=["GET"])
@login_obrigatorio
def listar():
    _marcar_atrasados()
    tipo = request.args.get("tipo", "receber")     # receber | pagar
    status = request.args.get("status", "").strip()

    # Prefixo "f." é obrigatório: a tabela clientes também tem coluna "tipo",
    # e o JOIN abaixo tornaria a referência ambígua sem o alias.
    where = ["f.tipo = ?"]
    params = [tipo]
    if status:
        where.append("f.status = ?")
        params.append(status)

    lista = query(
        f"SELECT f.*, c.nome AS cliente_nome, fo.nome AS fornecedor_nome "
        f"FROM financeiro f "
        f"LEFT JOIN clientes c ON c.id=f.cliente_id "
        f"LEFT JOIN fornecedores fo ON fo.id=f.fornecedor_id "
        f"WHERE {' AND '.join(where)} ORDER BY f.vencimento", params)

    # "aberto" agrega o que ainda falta receber/pagar (aberto + parcial + atrasado),
    # descontando o que já foi pago parcialmente. "pago" soma o efetivamente baixado.
    def falta(x):
        return max(_total_devido(x) - (x["valor_pago"] or 0), 0)

    totais = {
        "aberto": sum(falta(x) for x in lista if x["status"] in ("aberto", "parcial")),
        "pago": sum(x["valor_pago"] or 0 for x in lista if x["status"] in ("pago", "parcial")),
        "atrasado": sum(falta(x) for x in lista if x["status"] == "atrasado"),
    }
    return jsonify({"dados": lista, "totais": totais})


@financeiro_bp.route("/api/financeiro", methods=["POST"])
@login_obrigatorio
@perfil_permitido("administrador", "gerente", "financeiro", "caixa")
def criar():
    d = request.get_json(force=True)

    # Verifica limite de crédito ao criar conta a RECEBER
    if d.get("tipo", "receber") == "receber" and d.get("cliente_id"):
        cid = d["cliente_id"]
        c = query("SELECT limite_credito FROM clientes WHERE id=?", (cid,), fetchone=True)
        limite = float((c or {}).get("limite_credito") or 0)
        if limite > 0:
            r = query(
                "SELECT COALESCE(SUM(valor),0) AS saldo FROM financeiro "
                "WHERE cliente_id=? AND tipo='receber' AND status IN ('aberto','atrasado','parcial')",
                (cid,), fetchone=True)
            saldo = float(r["saldo"] or 0)
            novo_valor = float(d.get("valor") or 0)
            if saldo + novo_valor > limite:
                disponivel = max(limite - saldo, 0)
                return jsonify({
                    "erro": f"Cliente atingiu o limite de crédito. "
                            f"Limite: R$ {limite:.2f} | Saldo devedor: R$ {saldo:.2f} | "
                            f"Disponível: R$ {disponivel:.2f}",
                    "limite_atingido": True,
                    "limite": limite,
                    "saldo_devedor": saldo,
                    "credito_disponivel": disponivel,
                }), 400

    res = query(
        "INSERT INTO financeiro (tipo, descricao, cliente_id, fornecedor_id, os_id, "
        "valor, vencimento, forma_pagamento, categoria, status, juros, multa, criado_em) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (d.get("tipo", "receber"), d.get("descricao"), d.get("cliente_id"),
         d.get("fornecedor_id"), d.get("os_id"), d.get("valor", 0),
         d.get("vencimento"), d.get("forma_pagamento"), d.get("categoria"), "aberto",
         d.get("juros", 0), d.get("multa", 0), now()),
        commit=True,
    )
    registrar_log(session["user_id"], "criar_lancamento", d.get("descricao"))
    return jsonify({"ok": True, "id": res["_lastid"]}), 201


@financeiro_bp.route("/api/financeiro/<int:fid>", methods=["PUT"])
@login_obrigatorio
@perfil_permitido("administrador", "gerente", "financeiro")
def editar(fid):
    """Edita um lançamento ainda não quitado (não mexe em valores já baixados)."""
    reg = query("SELECT * FROM financeiro WHERE id=?", (fid,), fetchone=True)
    if not reg:
        return jsonify({"erro": "Lançamento não encontrado"}), 404
    if reg["status"] == "pago":
        return jsonify({"erro": "Lançamento já quitado não pode ser editado"}), 400
    d = request.get_json(force=True)
    query(
        "UPDATE financeiro SET descricao=?, cliente_id=?, fornecedor_id=?, "
        "valor=?, vencimento=?, forma_pagamento=?, categoria=?, juros=?, multa=? WHERE id=?",
        (d.get("descricao", reg["descricao"]),
         d.get("cliente_id", reg["cliente_id"]),
         d.get("fornecedor_id", reg["fornecedor_id"]),
         d.get("valor", reg["valor"]),
         d.get("vencimento", reg["vencimento"]),
         d.get("forma_pagamento", reg["forma_pagamento"]),
         d.get("categoria", reg["categoria"]),
         d.get("juros", reg["juros"]),
         d.get("multa", reg["multa"]),
         fid),
        commit=True,
    )
    registrar_log(session["user_id"], "editar_lancamento", str(fid))
    return jsonify({"ok": True})


@financeiro_bp.route("/api/financeiro/<int:fid>/baixar", methods=["POST"])
@login_obrigatorio
@perfil_permitido("administrador", "gerente", "financeiro", "caixa")
def baixar(fid):
    """
    Registra recebimento/pagamento (baixa), com suporte a:
      - juros/multa: o total devido = valor + juros + multa.
      - baixa parcial: se o acumulado pago < total devido, status='parcial'
        e o restante continua cobrável; quando alcança o total, status='pago'.
    """
    d = request.get_json(force=True)
    reg = query("SELECT * FROM financeiro WHERE id=?", (fid,), fetchone=True)
    if not reg:
        return jsonify({"erro": "Lançamento não encontrado"}), 404
    if reg["status"] == "pago":
        return jsonify({"erro": "Lançamento já quitado"}), 400

    total_devido = _total_devido(reg)
    ja_pago = reg["valor_pago"] or 0

    # Valor desta baixa (default: quitar o restante).
    restante = max(total_devido - ja_pago, 0)
    try:
        valor_baixa = float(d.get("valor_pago", restante))
    except (TypeError, ValueError):
        return jsonify({"erro": "Valor inválido"}), 400
    if valor_baixa <= 0:
        return jsonify({"erro": "Valor da baixa deve ser maior que zero"}), 400

    acumulado = ja_pago + valor_baixa
    # Tolerância de 1 centavo para evitar sobra por arredondamento.
    quitado = acumulado >= (total_devido - 0.01)
    novo_status = "pago" if quitado else "parcial"

    query(
        "UPDATE financeiro SET status=?, valor_pago=?, pago_em=?, "
        "forma_pagamento=? WHERE id=?",
        (novo_status, round(acumulado, 2), now(),
         d.get("forma_pagamento", reg["forma_pagamento"]), fid),
        commit=True,
    )
    registrar_log(session["user_id"],
                  "baixar_lancamento" + ("" if quitado else "_parcial"), str(fid))
    return jsonify({
        "ok": True,
        "status": novo_status,
        "total_devido": round(total_devido, 2),
        "pago_acumulado": round(acumulado, 2),
        "restante": round(max(total_devido - acumulado, 0), 2),
    })


@financeiro_bp.route("/api/financeiro/<int:fid>", methods=["DELETE"])
@login_obrigatorio
@perfil_permitido("administrador", "gerente", "financeiro")
def excluir(fid):
    query("DELETE FROM financeiro WHERE id=?", (fid,), commit=True)
    registrar_log(session["user_id"], "excluir_lancamento", str(fid))
    return jsonify({"ok": True})


@financeiro_bp.route("/api/financeiro/fluxo", methods=["GET"])
@login_obrigatorio
def fluxo_caixa():
    """
    Fluxo de caixa consolidado por dia (últimos registros pagos + vendas PDV).
    Retorna série pronta para o gráfico do dashboard.
    """
    entradas = query(
        "SELECT substr(pago_em,1,10) AS dia, SUM(valor_pago) AS total "
        "FROM financeiro WHERE tipo='receber' AND status IN ('pago','parcial') "
        "GROUP BY dia ORDER BY dia")
    saidas = query(
        "SELECT substr(pago_em,1,10) AS dia, SUM(valor_pago) AS total "
        "FROM financeiro WHERE tipo='pagar' AND status IN ('pago','parcial') "
        "GROUP BY dia ORDER BY dia")
    vendas = query(
        "SELECT substr(criado_em,1,10) AS dia, SUM(total) AS total "
        "FROM vendas GROUP BY dia ORDER BY dia")
    return jsonify({"entradas": entradas, "saidas": saidas, "vendas": vendas})


@financeiro_bp.route("/api/cobrancas", methods=["GET"])
@login_obrigatorio
def cobrancas():
    """Lista de inadimplentes (contas a receber atrasadas) para gestão de cobrança."""
    _marcar_atrasados()
    lista = query(
        "SELECT f.*, c.nome AS cliente_nome, c.whatsapp, c.telefone, c.email "
        "FROM financeiro f LEFT JOIN clientes c ON c.id=f.cliente_id "
        "WHERE f.tipo='receber' AND f.status='atrasado' ORDER BY f.vencimento")
    return jsonify({"dados": lista, "total": sum(x["valor"] for x in lista)})


# =========================================================================
# COBRANÇAS — histórico de tentativas e envio por email
# =========================================================================

@financeiro_bp.route("/api/cobrancas/historico/<int:fid>", methods=["GET"])
@login_obrigatorio
def historico_cobranca(fid):
    """Retorna o histórico de tentativas de cobrança de uma conta."""
    hist = query(
        "SELECT h.*, u.nome AS usuario_nome FROM cobrancas_historico h "
        "LEFT JOIN usuarios u ON u.id=h.usuario_id "
        "WHERE h.financeiro_id=? ORDER BY h.id DESC", (fid,))
    return jsonify({"dados": hist})


@financeiro_bp.route("/api/cobrancas/registrar", methods=["POST"])
@login_obrigatorio
def registrar_cobranca():
    """Registra uma tentativa de cobrança (WhatsApp, ligação, manual)."""
    d = request.get_json(force=True)
    fid = d.get("financeiro_id")
    canal = d.get("canal", "manual")
    if not fid:
        return jsonify({"erro": "financeiro_id obrigatório"}), 400
    query(
        "INSERT INTO cobrancas_historico (financeiro_id, canal, mensagem, usuario_id, criado_em) "
        "VALUES (?,?,?,?,?)",
        (fid, canal, d.get("mensagem"), session["user_id"], now()), commit=True)
    return jsonify({"ok": True})


@financeiro_bp.route("/api/cobrancas/email", methods=["POST"])
@login_obrigatorio
def enviar_cobranca_email():
    """Envia cobrança por email via SMTP configurado e registra no histórico."""
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    from api.configuracoes import obter_config
    from datetime import date

    d = request.get_json(force=True)
    fid = d.get("financeiro_id")
    if not fid:
        return jsonify({"erro": "financeiro_id obrigatório"}), 400

    # Carrega a conta + dados do cliente
    f = query(
        "SELECT fi.*, c.nome AS cliente_nome, c.email AS cliente_email, "
        "c.cpf_cnpj, c.telefone, c.whatsapp "
        "FROM financeiro fi LEFT JOIN clientes c ON c.id=fi.cliente_id "
        "WHERE fi.id=?", (fid,), fetchone=True)
    if not f:
        return jsonify({"erro": "Lançamento não encontrado"}), 404

    email_destino = (d.get("email") or f.get("cliente_email") or "").strip()
    if not email_destino:
        return jsonify({"erro": "Cliente sem email cadastrado"}), 400

    cfg = obter_config()
    smtp_host = cfg.get("smtp_host", "").strip()
    smtp_porta = int(cfg.get("smtp_porta") or 587)
    smtp_usuario = cfg.get("smtp_usuario", "").strip()
    smtp_senha = cfg.get("smtp_senha", "").strip()
    smtp_ssl = str(cfg.get("smtp_ssl", "")).lower() in ("1", "true", "sim", "yes")
    email_rem = cfg.get("smtp_email_remetente") or smtp_usuario
    nome_rem = cfg.get("smtp_nome_remetente") or cfg.get("empresa_nome") or "Oficina"
    empresa = cfg.get("empresa_nome") or "Oficina"

    if not smtp_host or not smtp_usuario or not smtp_senha:
        return jsonify({"erro": "Configure o servidor SMTP em Configurações antes de enviar emails"}), 400

    valor = float(f.get("valor") or 0)
    juros = float(f.get("juros") or 0)
    multa = float(f.get("multa") or 0)
    total = valor + juros + multa
    ja_pago = float(f.get("valor_pago") or 0)
    restante = max(total - ja_pago, 0)
    venc = (f.get("vencimento") or "")[:10]
    hoje = date.today()
    try:
        from datetime import datetime
        dias_atraso = (hoje - datetime.strptime(venc, "%Y-%m-%d").date()).days if venc else 0
    except Exception:
        dias_atraso = 0

    mensagem_custom = d.get("mensagem", "").strip()
    obs_html = f"<p style='color:#555'>{mensagem_custom}</p>" if mensagem_custom else ""

    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;color:#222">
      <div style="background:#c0392b;padding:20px 24px;border-radius:8px 8px 0 0">
        <h2 style="color:#fff;margin:0">Aviso de Cobrança</h2>
        <p style="color:#f5b7b1;margin:4px 0 0">{empresa}</p>
      </div>
      <div style="background:#fff;padding:24px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px">
        <p>Prezado(a) <strong>{f.get('cliente_nome', '')}</strong>,</p>
        <p>Identificamos um débito em aberto em seu cadastro:</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#fafafa;border-radius:6px">
          <tr><td style="padding:10px 14px;border-bottom:1px solid #eee"><strong>Descrição</strong></td>
              <td style="padding:10px 14px;border-bottom:1px solid #eee">{f.get('descricao','—')}</td></tr>
          <tr><td style="padding:10px 14px;border-bottom:1px solid #eee"><strong>Valor original</strong></td>
              <td style="padding:10px 14px;border-bottom:1px solid #eee">R$ {valor:.2f}</td></tr>
          {"<tr><td style='padding:10px 14px;border-bottom:1px solid #eee'><strong>Juros/Multa</strong></td><td style='padding:10px 14px;border-bottom:1px solid #eee'>R$ " + f"{juros+multa:.2f}" + "</td></tr>" if juros+multa > 0 else ""}
          <tr style="background:#fff3cd"><td style="padding:10px 14px;border-bottom:1px solid #eee"><strong>Total a pagar</strong></td>
              <td style="padding:10px 14px;border-bottom:1px solid #eee"><strong>R$ {restante:.2f}</strong></td></tr>
          <tr><td style="padding:10px 14px;border-bottom:1px solid #eee"><strong>Vencimento</strong></td>
              <td style="padding:10px 14px;border-bottom:1px solid #eee">{venc}</td></tr>
          {"<tr style='background:#fde8e8'><td style='padding:10px 14px'><strong>Dias em atraso</strong></td><td style='padding:10px 14px;color:#c0392b'><strong>" + str(dias_atraso) + " dias</strong></td></tr>" if dias_atraso > 0 else ""}
        </table>
        {obs_html}
        <p>Entre em contato conosco para regularizar sua situação:</p>
        <p><strong>{cfg.get('empresa_telefone','')}</strong> &nbsp;|&nbsp; {email_rem}</p>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
        <p style="font-size:12px;color:#888">{empresa} — Este é um email automático, não responda diretamente.</p>
      </div>
    </div>"""

    assunto = f"Aviso de Cobrança — {empresa} — Venc. {venc}"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = assunto
    msg["From"] = f"{nome_rem} <{email_rem}>"
    msg["To"] = email_destino
    msg.attach(MIMEText(html, "html", "utf-8"))

    try:
        if smtp_ssl:
            srv = smtplib.SMTP_SSL(smtp_host, smtp_porta, timeout=15)
        else:
            srv = smtplib.SMTP(smtp_host, smtp_porta, timeout=15)
            srv.starttls()
        srv.login(smtp_usuario, smtp_senha)
        srv.sendmail(email_rem, [email_destino], msg.as_string())
        srv.quit()
    except Exception as e:
        return jsonify({"erro": f"Falha ao enviar email: {e}"}), 500

    # Registra no histórico
    query(
        "INSERT INTO cobrancas_historico (financeiro_id, canal, mensagem, usuario_id, criado_em) "
        "VALUES (?,?,?,?,?)",
        (fid, "email", f"Email enviado para {email_destino}", session["user_id"], now()),
        commit=True)

    registrar_log(session["user_id"], "cobranca_email", f"fin={fid} para={email_destino}")
    return jsonify({"ok": True, "enviado_para": email_destino})


# =========================================================================
# MALA DIRETA — envio em lote por email ou geração de cartas para impressão
# =========================================================================

TEMPLATES_MALA_DIRETA = {
    "cobranca": {
        "nome": "Cobrança de débito",
        "assunto": "Aviso de Cobrança — {empresa}",
        "corpo": "Prezado(a) {nome},\n\nIdentificamos um débito em aberto de {valor} com vencimento em {vencimento} ({dias_atraso} dias em atraso).\n\nPor favor, entre em contato para regularizar sua situação.\n\nAtenciosamente,\n{empresa}\n{telefone_empresa}",
    },
    "promocao": {
        "nome": "Promoção / Oferta especial",
        "assunto": "Oferta especial para você — {empresa}",
        "corpo": "Olá {nome},\n\nTemos uma oferta especial para você! Entre em contato e saiba mais.\n\nAtenciosamente,\n{empresa}\n{telefone_empresa}",
    },
    "revisao": {
        "nome": "Aviso de revisão programada",
        "assunto": "Lembrete de revisão — {empresa}",
        "corpo": "Olá {nome},\n\nPassou da hora de revisar seu veículo! Agende agora e garanta a segurança na estrada.\n\nAtenciosamente,\n{empresa}\n{telefone_empresa}",
    },
    "agradecimento": {
        "nome": "Agradecimento / Pós-venda",
        "assunto": "Obrigado pela preferência — {empresa}",
        "corpo": "Olá {nome},\n\nAgradecemos sua visita e confiança em nossos serviços. Estamos sempre à disposição!\n\nAtenciosamente,\n{empresa}\n{telefone_empresa}",
    },
    "personalizado": {
        "nome": "Mensagem personalizada",
        "assunto": "",
        "corpo": "",
    },
}


@financeiro_bp.route("/api/mala-direta/templates", methods=["GET"])
@login_obrigatorio
def mala_templates():
    return jsonify({"templates": TEMPLATES_MALA_DIRETA})


@financeiro_bp.route("/api/mala-direta/destinatarios", methods=["GET"])
@login_obrigatorio
def mala_destinatarios():
    """
    Retorna lista de clientes conforme o filtro:
    - todos: todos os clientes
    - inadimplentes: com contas a receber atrasadas
    - ativos: com OS finalizada nos últimos N meses (padrão 6)
    - ids: lista de IDs específicos (query param ids=1,2,3)
    """
    filtro = request.args.get("filtro", "todos")
    meses = int(request.args.get("meses", 6))

    if filtro == "inadimplentes":
        lista = query(
            "SELECT DISTINCT c.id, c.nome, c.email, c.telefone, c.whatsapp "
            "FROM clientes c JOIN financeiro f ON f.cliente_id=c.id "
            "WHERE f.tipo='receber' AND f.status='atrasado' AND c.email IS NOT NULL "
            "AND c.email != '' ORDER BY c.nome")
    elif filtro == "ativos":
        lista = query(
            "SELECT DISTINCT c.id, c.nome, c.email, c.telefone, c.whatsapp "
            "FROM clientes c JOIN ordens_servico o ON o.cliente_id=c.id "
            "WHERE o.status='finalizada' AND o.eh_orcamento=0 "
            "AND o.data >= date('now', ? || ' months') "
            "AND c.email IS NOT NULL AND c.email != '' ORDER BY c.nome",
            (f"-{meses}",))
    elif filtro == "ids":
        ids_raw = request.args.get("ids", "")
        try:
            ids = [int(x) for x in ids_raw.split(",") if x.strip().isdigit()]
        except Exception:
            ids = []
        if not ids:
            return jsonify({"dados": [], "total": 0})
        placeholders = ",".join("?" * len(ids))
        lista = query(
            f"SELECT id, nome, email, telefone, whatsapp FROM clientes "
            f"WHERE id IN ({placeholders}) AND email IS NOT NULL AND email != '' "
            f"ORDER BY nome", ids)
    else:  # todos
        lista = query(
            "SELECT id, nome, email, telefone, whatsapp FROM clientes "
            "WHERE email IS NOT NULL AND email != '' ORDER BY nome")

    # Para inadimplentes, busca dados financeiros para as variáveis
    if filtro == "inadimplentes":
        for c in lista:
            f = query(
                "SELECT valor, vencimento, "
                "(julianday('now') - julianday(vencimento)) AS dias "
                "FROM financeiro WHERE cliente_id=? AND tipo='receber' "
                "AND status='atrasado' ORDER BY vencimento LIMIT 1",
                (c["id"],), fetchone=True)
            c["valor_atraso"] = f["valor"] if f else None
            c["vencimento_atraso"] = f["vencimento"] if f else None
            c["dias_atraso"] = int(f["dias"] or 0) if f else 0

    return jsonify({"dados": lista, "total": len(lista)})


@financeiro_bp.route("/api/mala-direta/enviar", methods=["POST"])
@login_obrigatorio
def mala_enviar():
    """
    Envia emails em lote. Body:
    { destinatarios: [{id, nome, email, valor_atraso?, vencimento_atraso?, dias_atraso?}],
      assunto, corpo, tipo: 'email'|'impressao' }
    Para impressão, retorna o HTML das cartas; para email, envia via SMTP.
    """
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    from api.configuracoes import obter_config

    d = request.get_json(force=True)
    destinatarios = d.get("destinatarios", [])
    assunto_tpl = d.get("assunto", "").strip()
    corpo_tpl = d.get("corpo", "").strip()
    tipo = d.get("tipo", "email")

    if not destinatarios:
        return jsonify({"erro": "Nenhum destinatário selecionado"}), 400
    if not corpo_tpl:
        return jsonify({"erro": "O corpo da mensagem não pode estar vazio"}), 400

    cfg = obter_config()
    empresa = cfg.get("empresa_nome") or "Oficina"
    tel_empresa = cfg.get("empresa_telefone") or ""

    def aplicar_variaveis(texto, dest):
        from datetime import date
        hoje = date.today()
        return (texto
            .replace("{nome}", dest.get("nome") or "Cliente")
            .replace("{empresa}", empresa)
            .replace("{telefone_empresa}", tel_empresa)
            .replace("{valor}", f"R$ {float(dest.get('valor_atraso') or 0):.2f}")
            .replace("{vencimento}", str(dest.get("vencimento_atraso") or "—")[:10])
            .replace("{dias_atraso}", str(dest.get("dias_atraso") or 0))
            .replace("{data_hoje}", hoje.strftime("%d/%m/%Y"))
        )

    # Modo impressão — retorna HTML das cartas
    if tipo == "impressao":
        from datetime import date
        hoje = date.today().strftime("%d/%m/%Y")
        cartas = []
        for dest in destinatarios:
            corpo_final = aplicar_variaveis(corpo_tpl, dest)
            corpo_html = corpo_final.replace("\n", "<br>")
            cartas.append(f"""
            <div style="page-break-after:always;font-family:Arial,sans-serif;
                        max-width:680px;margin:0 auto;padding:40px">
              <div style="text-align:right;font-size:12px;color:#888;margin-bottom:32px">
                {empresa} — {hoje}
              </div>
              <div style="margin-bottom:24px">
                <strong>{dest.get('nome','')}</strong>
              </div>
              <div style="line-height:1.8;font-size:14px">{corpo_html}</div>
              <hr style="margin:40px 0;border:none;border-top:1px solid #ddd">
            </div>""")
        html_cartas = f"""<!DOCTYPE html><html><head><meta charset="UTF-8">
          <title>Mala Direta — {empresa}</title>
          <style>@media print{{body{{margin:0}}}} body{{font-family:Arial,sans-serif}}</style>
          </head><body>{"".join(cartas)}</body></html>"""
        registrar_log(session["user_id"], "mala_direta_impressao",
                      f"{len(destinatarios)} cartas geradas")
        return jsonify({"ok": True, "tipo": "impressao", "html": html_cartas,
                        "total": len(destinatarios)})

    # Modo email — envia via SMTP
    smtp_host = cfg.get("smtp_host", "").strip()
    smtp_porta = int(cfg.get("smtp_porta") or 587)
    smtp_usuario = cfg.get("smtp_usuario", "").strip()
    smtp_senha = cfg.get("smtp_senha", "").strip()
    smtp_ssl = str(cfg.get("smtp_ssl", "")).lower() in ("1", "true", "sim", "yes")
    email_rem = cfg.get("smtp_email_remetente") or smtp_usuario
    nome_rem = cfg.get("smtp_nome_remetente") or empresa

    if not smtp_host or not smtp_usuario or not smtp_senha:
        return jsonify({"erro": "Configure o servidor SMTP em Configurações antes de enviar emails"}), 400

    enviados, erros = 0, []
    try:
        if smtp_ssl:
            srv = smtplib.SMTP_SSL(smtp_host, smtp_porta, timeout=15)
        else:
            srv = smtplib.SMTP(smtp_host, smtp_porta, timeout=15)
            srv.starttls()
        srv.login(smtp_usuario, smtp_senha)

        for dest in destinatarios:
            if not dest.get("email"):
                erros.append(f"{dest.get('nome','?')} — sem email")
                continue
            try:
                assunto_final = aplicar_variaveis(assunto_tpl, dest)
                corpo_final = aplicar_variaveis(corpo_tpl, dest)
                corpo_html = f"""<div style="font-family:Arial,sans-serif;max-width:620px;
                    margin:0 auto;padding:24px;color:#222;line-height:1.7">
                    {corpo_final.replace(chr(10),'<br>')}
                </div>"""
                msg = MIMEMultipart("alternative")
                msg["Subject"] = assunto_final
                msg["From"] = f"{nome_rem} <{email_rem}>"
                msg["To"] = dest["email"]
                msg.attach(MIMEText(corpo_html, "html", "utf-8"))
                srv.sendmail(email_rem, [dest["email"]], msg.as_string())
                enviados += 1
            except Exception as e:
                erros.append(f"{dest.get('nome','?')} — {e}")
        srv.quit()
    except Exception as e:
        return jsonify({"erro": f"Falha ao conectar no SMTP: {e}"}), 500

    registrar_log(session["user_id"], "mala_direta_email",
                  f"enviados={enviados} erros={len(erros)}")
    return jsonify({"ok": True, "tipo": "email",
                    "enviados": enviados, "erros": erros, "total": len(destinatarios)})
