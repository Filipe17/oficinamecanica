/* =======================================================================
   mala_direta.js — Mala Direta (email em lote ou cartas para impressão)
   Fluxo: 1) Escolhe público → 2) Escolhe/edita template → 3) Preview → 4) Envia
   ======================================================================= */
(async () => {
  await Layout.iniciar("mala_direta", "Mala Direta");

  let _destinatarios = [];   // lista carregada conforme filtro
  let _templates = {};
  let _filtroAtual = "todos";

  try {
    const r = await API.get("/api/mala-direta/templates");
    _templates = r.templates || {};
  } catch(_) {}

  const cfg = Layout.config || {};
  const empresa = cfg.empresa_nome || "Oficina";
  const telEmpresa = cfg.empresa_telefone || "";

  // -----------------------------------------------------------------------
  // Render principal
  // -----------------------------------------------------------------------
  Layout.set(`
    <div class="page-head">
      <div><h1>Mala Direta</h1><p>Envie mensagens personalizadas para seus clientes em lote</p></div>
    </div>

    <!-- PASSO 1: Público-alvo -->
    <div class="card" style="margin-bottom:1rem">
      <div class="card__body">
        <h3 style="font-size:.95rem;font-weight:700;margin-bottom:1rem;color:var(--primary)">
          <span style="background:var(--primary);color:#fff;border-radius:50%;width:22px;height:22px;
            display:inline-flex;align-items:center;justify-content:center;font-size:.75rem;margin-right:6px">1</span>
          Público-alvo
        </h3>
        <div style="display:flex;gap:.75rem;flex-wrap:wrap;align-items:flex-end">
          <div class="field" style="margin:0">
            <label>Filtrar clientes</label>
            <select id="md-filtro" style="min-width:220px">
              <option value="todos">Todos os clientes (com email)</option>
              <option value="inadimplentes">Somente inadimplentes</option>
              <option value="ativos">Clientes ativos (últimos meses)</option>
            </select>
          </div>
          <div class="field" id="md-meses-wrap" style="margin:0;display:none">
            <label>Meses</label>
            <input type="number" id="md-meses" value="6" min="1" max="60" style="width:80px">
          </div>
          <button class="btn btn--outline" id="md-carregar">
            <i class="fa-solid fa-filter"></i> Carregar lista
          </button>
        </div>
        <div id="md-lista-dest" style="margin-top:1rem"></div>
      </div>
    </div>

    <!-- PASSO 2: Template / mensagem -->
    <div class="card" style="margin-bottom:1rem">
      <div class="card__body">
        <h3 style="font-size:.95rem;font-weight:700;margin-bottom:1rem;color:var(--primary)">
          <span style="background:var(--primary);color:#fff;border-radius:50%;width:22px;height:22px;
            display:inline-flex;align-items:center;justify-content:center;font-size:.75rem;margin-right:6px">2</span>
          Mensagem
        </h3>
        <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:.75rem">
          <div class="field col-2">
            <label>Template base</label>
            <select id="md-template">
              ${Object.entries(_templates).map(([k,v]) =>
                `<option value="${k}">${v.nome}</option>`).join("")}
            </select>
          </div>
          <div class="field col-2">
            <label>Assunto do email *</label>
            <input id="md-assunto" placeholder="Assunto do email">
          </div>
          <div class="field col-2">
            <label>Corpo da mensagem *</label>
            <textarea id="md-corpo" rows="8" style="width:100%;font-family:inherit;resize:vertical"
              placeholder="Digite a mensagem..."></textarea>
          </div>
          <div class="field col-2">
            <small style="color:var(--text-muted)">
              Variáveis disponíveis:
              <code>{nome}</code> <code>{empresa}</code> <code>{telefone_empresa}</code>
              <code>{valor}</code> <code>{vencimento}</code> <code>{dias_atraso}</code>
              <code>{data_hoje}</code>
            </small>
          </div>
        </div>
      </div>
    </div>

    <!-- PASSO 3: Preview + envio -->
    <div class="card">
      <div class="card__body">
        <h3 style="font-size:.95rem;font-weight:700;margin-bottom:1rem;color:var(--primary)">
          <span style="background:var(--primary);color:#fff;border-radius:50%;width:22px;height:22px;
            display:inline-flex;align-items:center;justify-content:center;font-size:.75rem;margin-right:6px">3</span>
          Preview e envio
        </h3>
        <div style="display:flex;gap:.75rem;flex-wrap:wrap;margin-bottom:1rem">
          <button class="btn btn--outline" id="md-preview">
            <i class="fa-solid fa-eye"></i> Preview
          </button>
          <button class="btn btn--outline" id="md-imprimir">
            <i class="fa-solid fa-print"></i> Gerar cartas (impressão)
          </button>
          <button class="btn btn--primary" id="md-enviar-email">
            <i class="fa-solid fa-paper-plane"></i> Enviar por email
          </button>
        </div>
        <div id="md-resultado"></div>
      </div>
    </div>
  `);

  // -----------------------------------------------------------------------
  // Alterna campo de meses
  // -----------------------------------------------------------------------
  document.getElementById("md-filtro").onchange = () => {
    const v = document.getElementById("md-filtro").value;
    document.getElementById("md-meses-wrap").style.display = v === "ativos" ? "" : "none";
  };

  // -----------------------------------------------------------------------
  // Carrega destinatários
  // -----------------------------------------------------------------------
  document.getElementById("md-carregar").onclick = async () => {
    const filtro = document.getElementById("md-filtro").value;
    const meses = document.getElementById("md-meses").value || 6;
    _filtroAtual = filtro;
    const alvo = document.getElementById("md-lista-dest");
    alvo.innerHTML = `<div class="loading"><i class="fa-solid fa-spinner spin"></i> Carregando…</div>`;
    try {
      const r = await API.get(`/api/mala-direta/destinatarios?filtro=${filtro}&meses=${meses}`);
      _destinatarios = r.dados || [];
      if (!_destinatarios.length) {
        alvo.innerHTML = `<div class="empty" style="padding:.75rem 0">
          <i class="fa-solid fa-inbox"></i> Nenhum cliente encontrado com email cadastrado para este filtro</div>`;
        return;
      }
      alvo.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem">
          <span style="color:var(--text-muted);font-size:.85rem">
            <strong style="color:var(--primary)">${_destinatarios.length}</strong>
            cliente(s) encontrado(s) com email cadastrado
          </span>
          <button class="btn btn--ghost btn--sm" onclick="window.__md.toggleLista()">
            <i class="fa-solid fa-list"></i> Ver lista
          </button>
        </div>
        <div id="md-lista-clientes" style="display:none;max-height:220px;overflow-y:auto;
          background:var(--bg-alt,#f8f9fa);border-radius:8px;padding:.5rem">
          ${_destinatarios.map((c) => `
            <div style="display:flex;justify-content:space-between;padding:4px 8px;
              border-bottom:1px solid var(--border,#eee);font-size:.85rem">
              <span>${c.nome}</span>
              <span style="color:var(--text-muted)">${c.email}</span>
            </div>`).join("")}
        </div>`;
    } catch(e) { alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`; }
  };

  // -----------------------------------------------------------------------
  // Preenche template ao trocar
  // -----------------------------------------------------------------------
  document.getElementById("md-template").onchange = () => {
    const k = document.getElementById("md-template").value;
    const t = _templates[k];
    if (!t) return;
    if (t.assunto) document.getElementById("md-assunto").value = t.assunto;
    if (t.corpo) document.getElementById("md-corpo").value = t.corpo;
  };
  // Preenche com o primeiro template ao carregar
  (() => {
    const k = document.getElementById("md-template").value;
    const t = _templates[k];
    if (t) {
      document.getElementById("md-assunto").value = t.assunto || "";
      document.getElementById("md-corpo").value = t.corpo || "";
    }
  })();

  function aplicarVars(texto, dest) {
    const hoje = new Date().toLocaleDateString("pt-BR");
    return texto
      .replace(/{nome}/g, dest?.nome || "Cliente")
      .replace(/{empresa}/g, empresa)
      .replace(/{telefone_empresa}/g, telEmpresa)
      .replace(/{valor}/g, dest?.valor_atraso ? `R$ ${Number(dest.valor_atraso).toFixed(2)}` : "—")
      .replace(/{vencimento}/g, dest?.vencimento_atraso ? new Date(dest.vencimento_atraso+"T00:00").toLocaleDateString("pt-BR") : "—")
      .replace(/{dias_atraso}/g, String(dest?.dias_atraso || 0))
      .replace(/{data_hoje}/g, hoje);
  }

  // -----------------------------------------------------------------------
  // Preview com o primeiro destinatário
  // -----------------------------------------------------------------------
  document.getElementById("md-preview").onclick = () => {
    const corpo = document.getElementById("md-corpo").value;
    const assunto = document.getElementById("md-assunto").value;
    const exemplo = _destinatarios[0] || { nome: "João da Silva" };
    const corpoFinal = aplicarVars(corpo, exemplo);
    const assuntoFinal = aplicarVars(assunto, exemplo);
    Modal.abrir(
      `<i class="fa-solid fa-eye"></i> Preview — ${exemplo.nome}`,
      `<div style="background:var(--bg-alt,#f8f9fa);border-radius:8px;padding:1rem;margin-bottom:.75rem">
        <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:.25rem">Assunto:</div>
        <strong>${assuntoFinal}</strong>
      </div>
      <div style="background:var(--bg-alt,#f8f9fa);border-radius:8px;padding:1rem;line-height:1.8;white-space:pre-wrap">
        ${corpoFinal.replace(/</g,"&lt;")}
      </div>
      <p style="color:var(--text-muted);font-size:.8rem;margin-top:.75rem">
        Preview usando o primeiro cliente da lista. Cada destinatário receberá a mensagem com seus dados.
      </p>`,
      `<button class="btn btn--ghost" onclick="Modal.fechar()">Fechar</button>`,
      true
    );
  };

  // -----------------------------------------------------------------------
  // Gerar cartas para impressão
  // -----------------------------------------------------------------------
  document.getElementById("md-imprimir").onclick = async () => {
    if (!_destinatarios.length) { toast("Carregue a lista de destinatários primeiro", "warning"); return; }
    const corpo = document.getElementById("md-corpo").value.trim();
    if (!corpo) { toast("Preencha o corpo da mensagem", "warning"); return; }
    const btn = document.getElementById("md-imprimir");
    btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner spin"></i> Gerando…`;
    try {
      const r = await API.post("/api/mala-direta/enviar", {
        destinatarios: _destinatarios,
        assunto: document.getElementById("md-assunto").value,
        corpo,
        tipo: "impressao",
      });
      const w = window.open("", "_blank");
      w.document.write(r.html);
      w.document.close();
      w.onload = () => w.print();
      toast(`${r.total} carta(s) gerada(s) para impressão`);
    } catch(e) { toast(e.message, "error"); }
    btn.disabled = false; btn.innerHTML = `<i class="fa-solid fa-print"></i> Gerar cartas (impressão)`;
  };

  // -----------------------------------------------------------------------
  // Enviar por email
  // -----------------------------------------------------------------------
  document.getElementById("md-enviar-email").onclick = async () => {
    if (!_destinatarios.length) { toast("Carregue a lista de destinatários primeiro", "warning"); return; }
    const assunto = document.getElementById("md-assunto").value.trim();
    const corpo = document.getElementById("md-corpo").value.trim();
    if (!assunto || !corpo) { toast("Preencha assunto e corpo da mensagem", "warning"); return; }

    // Confirma antes de enviar em lote
    if (!confirm(`Enviar email para ${_destinatarios.length} cliente(s)?\n\nAssunto: ${assunto}`)) return;

    const btn = document.getElementById("md-enviar-email");
    btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner spin"></i> Enviando…`;
    const alvo = document.getElementById("md-resultado");
    alvo.innerHTML = `<div class="loading"><i class="fa-solid fa-spinner spin"></i> Enviando emails, aguarde…</div>`;

    try {
      const r = await API.post("/api/mala-direta/enviar", {
        destinatarios: _destinatarios,
        assunto,
        corpo,
        tipo: "email",
      });
      alvo.innerHTML = `
        <div style="background:#d4edda;border:1px solid #c3e6cb;border-radius:8px;padding:1rem;margin-top:.5rem">
          <div style="font-weight:700;color:#155724;margin-bottom:.5rem">
            <i class="fa-solid fa-circle-check"></i> Envio concluído
          </div>
          <div>✅ <strong>${r.enviados}</strong> email(s) enviado(s) com sucesso</div>
          ${r.erros?.length ? `<div style="margin-top:.5rem;color:#856404">
            ⚠️ ${r.erros.length} falha(s):<br>
            <small>${r.erros.join("<br>")}</small>
          </div>` : ""}
        </div>`;
      toast(`${r.enviados} email(s) enviado(s)`);
    } catch(e) {
      alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
      toast(e.message, "error");
    }
    btn.disabled = false; btn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Enviar por email`;
  };

  window.__md = {
    toggleLista() {
      const el = document.getElementById("md-lista-clientes");
      if (el) el.style.display = el.style.display === "none" ? "" : "none";
    },
  };
})();
