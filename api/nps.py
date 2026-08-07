"""
nps.py — Módulo de NPS (Net Promoter Score) pós-serviço.

Fluxo:
1. Ao finalizar uma OS, o admin/gerente pode enviar pesquisa por email ou WhatsApp.
2. O cliente recebe um link único (/nps/<token>) — página pública sem login.
3. Ao responder (nota 0-10 + comentário opcional), a resposta é salva.
4. A tela de NPS exibe histórico, média, classificação e comentários.
"""
from flask import Blueprint, request, jsonify, session, render_template_string
from database.database import query, now
from api.auth import login_obrigatorio
from api.logs import registrar_log

nps_bp = Blueprint("nps", __name__)

# -------------------------------------------------------------------------
# Página pública de resposta (sem login)
# -------------------------------------------------------------------------

_PAGINA_NPS = """<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Como foi seu atendimento?</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;background:#f0fafa;min-height:100vh;
    display:flex;align-items:center;justify-content:center;padding:1rem}
  .card{background:#fff;border-radius:16px;padding:2rem;max-width:480px;width:100%;
    box-shadow:0 4px 24px rgba(0,0,0,.1);text-align:center}
  .logo{font-size:1.1rem;font-weight:700;color:#0d9488;margin-bottom:1.5rem}
  h1{font-size:1.3rem;color:#222;margin-bottom:.5rem}
  p{color:#666;font-size:.9rem;margin-bottom:1.5rem}
  .notas{display:flex;gap:.35rem;justify-content:center;flex-wrap:wrap;margin-bottom:1rem}
  .nota-btn{width:48px;height:48px;border-radius:10px;border:2px solid #e2e8f0;
    background:#fff;font-size:1.1rem;font-weight:700;cursor:pointer;
    transition:all .15s;color:#555}
  .nota-btn:hover,.nota-btn.sel{border-color:var(--c);background:var(--c);color:#fff;transform:scale(1.08)}
  .legenda{display:flex;justify-content:space-between;font-size:.75rem;color:#aaa;margin-bottom:1.25rem}
  textarea{width:100%;border:1.5px solid #e2e8f0;border-radius:10px;padding:.75rem;
    font-size:.9rem;resize:vertical;min-height:90px;margin-bottom:1.25rem;font-family:inherit}
  textarea:focus{outline:none;border-color:#0d9488}
  .btn{background:#0d9488;color:#fff;border:none;padding:.8rem 2rem;border-radius:10px;
    font-size:1rem;font-weight:700;cursor:pointer;width:100%;transition:background .15s}
  .btn:hover{background:#0a7d73}
  .btn:disabled{background:#aaa;cursor:not-allowed}
  .obrigado{display:none}
  .obrigado h2{font-size:1.4rem;color:#0d9488;margin-bottom:.5rem}
  .obrigado p{color:#555}
  .emoji{font-size:3rem;margin-bottom:1rem}
  .label-notas{display:flex;justify-content:space-between;font-size:.72rem;
    color:#888;margin-bottom:.35rem}
</style>
</head>
<body>
<div class="card" id="card-form">
  <div class="logo">{{ empresa }}</div>
  <div class="emoji">⭐</div>
  <h1>Como foi seu atendimento?</h1>
  <p>Sua opinião é muito importante para nós.<br>Dê uma nota de 0 a 10:</p>

  <div class="label-notas">
    <span>😞 Muito ruim</span><span>😊 Excelente</span>
  </div>
  <div class="notas" id="notas">
    {% for n in range(11) %}
    <button class="nota-btn" data-n="{{ n }}" style="--c:{{ cores[n] }}"
      onclick="sel({{ n }})">{{ n }}</button>
    {% endfor %}
  </div>
  <div class="legenda"><span>0</span><span>10</span></div>

  <textarea id="comentario" placeholder="Comentário opcional — O que podemos melhorar?"></textarea>

  <button class="btn" id="enviar" onclick="enviar()" disabled>Enviar avaliação</button>
</div>

<div class="card obrigado" id="card-ok">
  <div class="emoji" id="ok-emoji">🙏</div>
  <h2>Obrigado pelo seu feedback!</h2>
  <p>Sua avaliação foi registrada com sucesso.<br>
     Continuaremos trabalhando para melhorar cada vez mais!</p>
</div>

<script>
let notaSel = null;
const cores = {{ cores_js|safe }};
function sel(n) {
  notaSel = n;
  document.querySelectorAll(".nota-btn").forEach(b => b.classList.remove("sel"));
  document.querySelector(`.nota-btn[data-n="${n}"]`).classList.add("sel");
  document.getElementById("enviar").disabled = false;
}
async function enviar() {
  const btn = document.getElementById("enviar");
  btn.disabled = true; btn.textContent = "Enviando…";
  const r = await fetch(location.pathname, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({nota: notaSel, comentario: document.getElementById("comentario").value})
  });
  if (r.ok) {
    document.getElementById("card-form").style.display = "none";
    const ok = document.getElementById("card-ok");
    ok.style.display = "block";
    document.getElementById("ok-emoji").textContent = notaSel >= 9 ? "🎉" : notaSel >= 7 ? "😊" : "🙏";
  } else {
    btn.disabled = false; btn.textContent = "Enviar avaliação";
    alert("Erro ao enviar. Tente novamente.");
  }
}
</script>
</body>
</html>"""


@nps_bp.route("/nps/<token>", methods=["GET", "POST"])
def responder_nps(token):
    p = query("SELECT * FROM nps_pesquisas WHERE token=?", (token,), fetchone=True)
    if not p:
        return "Link inválido ou expirado.", 404

    cfg = query("SELECT valor FROM configuracoes WHERE chave='empresa_nome'", fetchone=True)
    empresa = (cfg or {}).get("valor") or "Oficina"

    if request.method == "POST":
        if p.get("respondido_em"):
            return jsonify({"erro": "Pesquisa já respondida"}), 400
        d = request.get_json(force=True)
        nota = d.get("nota")
        if nota is None or not (0 <= int(nota) <= 10):
            return jsonify({"erro": "Nota inválida"}), 400
        query("UPDATE nps_pesquisas SET nota=?, comentario=?, respondido_em=? WHERE token=?",
              (int(nota), d.get("comentario", ""), now(), token), commit=True)
        return jsonify({"ok": True})

    # Já respondeu
    if p.get("respondido_em"):
        return "<center style='font-family:Arial;padding:40px'><h2>Você já respondeu esta pesquisa. Obrigado! 🙏</h2></center>"

    CORES = {0:"#ef4444",1:"#ef4444",2:"#ef4444",3:"#ef4444",4:"#ef4444",
             5:"#ef4444",6:"#f59e0b",7:"#f59e0b",8:"#f59e0b",9:"#22c55e",10:"#22c55e"}
    import json
    return render_template_string(
        _PAGINA_NPS,
        empresa=empresa,
        cores={str(k):v for k,v in CORES.items()},
        cores_js=json.dumps({str(k):v for k,v in CORES.items()}),
    )


# -------------------------------------------------------------------------
# APIs protegidas (admin/gerente)
# -------------------------------------------------------------------------

@nps_bp.route("/api/nps", methods=["GET"])
@login_obrigatorio
def listar_nps():
    """Lista todas as pesquisas com filtros."""
    respondidas = request.args.get("respondidas", "")
    where, params = ["1=1"], []
    if respondidas == "1":
        where.append("n.respondido_em IS NOT NULL")
    elif respondidas == "0":
        where.append("n.respondido_em IS NULL")

    lista = query(
        f"SELECT n.*, c.nome AS cliente_nome, c.telefone, c.whatsapp, c.email, "
        f"o.numero AS os_numero "
        f"FROM nps_pesquisas n "
        f"LEFT JOIN clientes c ON c.id=n.cliente_id "
        f"LEFT JOIN ordens_servico o ON o.id=n.os_id "
        f"WHERE {' AND '.join(where)} ORDER BY n.id DESC", params)

    # Métricas NPS
    respondidas_list = [x for x in lista if x.get("nota") is not None]
    if respondidas_list:
        notas = [int(x["nota"]) for x in respondidas_list]
        promotores  = sum(1 for n in notas if n >= 9)
        detratores  = sum(1 for n in notas if n <= 6)
        total_r = len(notas)
        nps_score = round(((promotores - detratores) / total_r) * 100)
        media = round(sum(notas) / total_r, 1)
    else:
        nps_score = None
        media = None
        promotores = detratores = total_r = 0

    return jsonify({
        "dados": lista,
        "total": len(lista),
        "respondidas": len(respondidas_list),
        "nps_score": nps_score,
        "media": media,
        "promotores": promotores,
        "detratores": detratores,
        "neutros": total_r - promotores - detratores,
    })


@nps_bp.route("/api/nps/enviar", methods=["POST"])
@login_obrigatorio
def enviar_nps():
    """Cria pesquisa e envia por email ou gera link para WhatsApp."""
    import secrets, smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    from api.configuracoes import obter_config

    d = request.get_json(force=True)
    os_id = d.get("os_id")
    cliente_id = d.get("cliente_id")
    canal = d.get("canal", "email")  # email | whatsapp | link

    if not os_id or not cliente_id:
        return jsonify({"erro": "os_id e cliente_id são obrigatórios"}), 400

    # Evita pesquisa duplicada para a mesma OS
    existe = query("SELECT id, token FROM nps_pesquisas WHERE os_id=?", (os_id,), fetchone=True)
    if existe:
        cfg = obter_config()
        base_url = cfg.get("empresa_url", request.host_url.rstrip("/"))
        return jsonify({"ok": True, "token": existe["token"], "ja_existia": True,
                        "link": f"{base_url}/nps/{existe['token']}"})

    token = secrets.token_urlsafe(24)
    query(
        "INSERT INTO nps_pesquisas (os_id, cliente_id, token, canal, enviado_em, criado_em) "
        "VALUES (?,?,?,?,?,?)",
        (os_id, cliente_id, token, canal, now(), now()), commit=True)

    cfg = obter_config()
    empresa = cfg.get("empresa_nome") or "Oficina"
    base_url = cfg.get("empresa_url", request.host_url.rstrip("/"))
    link = f"{base_url}/nps/{token}"

    c = query("SELECT nome, email, whatsapp, telefone FROM clientes WHERE id=?",
              (cliente_id,), fetchone=True) or {}
    os_ = query("SELECT numero FROM ordens_servico WHERE id=?", (os_id,), fetchone=True) or {}

    if canal == "email":
        email_dest = (d.get("email") or c.get("email") or "").strip()
        if not email_dest:
            return jsonify({"erro": "Cliente sem email cadastrado", "link": link}), 400

        smtp_host  = cfg.get("smtp_host","").strip()
        smtp_porta = int(cfg.get("smtp_porta") or 587)
        smtp_user  = cfg.get("smtp_usuario","").strip()
        smtp_pass  = cfg.get("smtp_senha","").strip()
        smtp_ssl   = str(cfg.get("smtp_ssl","")).lower() in ("1","true","sim")
        email_rem  = cfg.get("smtp_email_remetente") or smtp_user
        nome_rem   = cfg.get("smtp_nome_remetente") or empresa

        if not smtp_host or not smtp_user or not smtp_pass:
            return jsonify({"erro": "Configure o SMTP em Configurações", "link": link}), 400

        html = f"""<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto">
          <div style="background:#0d9488;padding:20px 24px;border-radius:8px 8px 0 0;text-align:center">
            <h2 style="color:#fff;margin:0">Como foi seu atendimento?</h2>
            <p style="color:#ccfbf1;margin:4px 0 0">{empresa}</p>
          </div>
          <div style="background:#fff;padding:24px;border:1px solid #e0e0e0;
            border-top:none;border-radius:0 0 8px 8px;text-align:center">
            <p style="font-size:2rem;margin:0 0 12px">⭐</p>
            <p>Olá <strong>{c.get('nome','')}</strong>!</p>
            <p>Acabamos de concluir o serviço da sua OS <strong>{os_.get('numero','')}</strong>.<br>
               Leva só 30 segundos — sua opinião nos ajuda a melhorar!</p>
            <a href="{link}" style="display:inline-block;margin:20px auto;background:#0d9488;
              color:#fff;padding:14px 32px;border-radius:10px;font-size:1.1rem;
              font-weight:700;text-decoration:none">Avaliar atendimento →</a>
            <p style="font-size:11px;color:#aaa;margin-top:16px">
              Ou copie o link: {link}</p>
          </div>
        </div>"""

        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"Como foi seu atendimento? — {empresa}"
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
            return jsonify({"erro": f"Falha ao enviar email: {e}", "link": link}), 500

    registrar_log(session["user_id"], "nps_enviar", f"os={os_id} canal={canal}")
    zap = (c.get("whatsapp") or c.get("telefone") or "").replace(r"\D","")
    msg_wpp = f"Olá {c.get('nome','')}! Como foi seu atendimento na {empresa}? Leva 30 segundos: {link}"
    return jsonify({
        "ok": True, "token": token, "link": link,
        "whatsapp_link": f"https://wa.me/55{zap}?text={msg_wpp}" if zap else None,
    })
