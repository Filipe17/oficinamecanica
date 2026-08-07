/* =======================================================================
   cobrancas.js — Gestão de cobranças (inadimplentes)
   Lista contas a receber atrasadas, dias em atraso, histórico de tentativas,
   envio de cobrança por WhatsApp (link) e email (SMTP).
   ======================================================================= */
(async () => {
  await Layout.iniciar("cobrancas", "Cobranças");

  Layout.set(`
    <div class="page-head">
      <div><h1>Cobranças</h1><p>Clientes inadimplentes e histórico de contato</p></div>
    </div>
    <div class="stat-grid" id="cob-resumo"></div>
    <div class="card"><div class="card__body">
      <div class="toolbar" style="margin-bottom:1rem">
        <div class="toolbar__search">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input id="cob-busca" placeholder="Filtrar por cliente…" autocomplete="off">
        </div>
      </div>
      <div id="cob-tabela"><div class="loading"><i class="fa-solid fa-spinner spin"></i></div></div>
    </div></div>
  `);

  let _lista = [];

  function diasAtraso(venc) {
    if (!venc) return 0;
    try {
      const d = new Date(venc.replace(" ", "T"));
      const hoje = new Date(); hoje.setHours(0,0,0,0);
      return Math.max(Math.floor((hoje - d) / 86400000), 0);
    } catch(_) { return 0; }
  }

  function msgCobranca(nome, valor, venc) {
    return encodeURIComponent(
      `Olá ${nome || ""}, identificamos um débito em aberto de ${fmt.moeda(valor)} ` +
      `com vencimento em ${fmt.data(venc)}. Podemos combinar o pagamento? Obrigado! — Oficina`);
  }

  function renderTabela(lista) {
    const alvo = document.getElementById("cob-tabela");
    if (!lista.length) {
      alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-champagne-glasses"></i>Nenhuma cobrança em atraso 🎉</div>`;
      return;
    }
    // Ordena por mais dias em atraso
    lista = [...lista].sort((a,b) => diasAtraso(b.vencimento) - diasAtraso(a.vencimento));
    alvo.innerHTML = `<div class="table-wrap"><table class="data">
      <thead><tr>
        <th>Cliente</th><th>Descrição</th><th>Vencimento</th>
        <th>Atraso</th><th>Valor</th><th>Ações</th>
      </tr></thead>
      <tbody>${lista.map((f) => {
        const dias = diasAtraso(f.vencimento);
        const zap = f.whatsapp || f.telefone;
        return `<tr>
          <td><strong>${f.cliente_nome || "—"}</strong></td>
          <td>${f.descricao || "—"}</td>
          <td>${fmt.data(f.vencimento)}</td>
          <td><span class="badge badge--danger">${dias} dia${dias !== 1 ? "s" : ""}</span></td>
          <td><strong>${fmt.moeda(f.valor)}</strong></td>
          <td style="white-space:nowrap">
            ${zap ? `<a class="icon-btn btn--sm" title="WhatsApp"
              href="https://wa.me/55${String(zap).replace(/\D/g,"")}?text=${msgCobranca(f.cliente_nome,f.valor,f.vencimento)}"
              target="_blank" onclick="window.__cob.registrarWpp(${f.id})">
              <i class="fa-brands fa-whatsapp" style="color:#25d366"></i></a>` : ""}
            ${f.email ? `<button class="icon-btn btn--sm" title="Enviar email de cobrança"
              onclick="window.__cob.abrirEmail(${f.id})">
              <i class="fa-solid fa-envelope"></i></button>` : ""}
            <button class="icon-btn btn--sm" title="Histórico de contatos"
              onclick="window.__cob.verHistorico(${f.id}, '${(f.cliente_nome||'').replace(/'/g,"\\'")}')">
              <i class="fa-solid fa-clock-rotate-left"></i></button>
            <button class="icon-btn btn--sm" title="Registrar contato manual"
              onclick="window.__cob.registrarManual(${f.id})">
              <i class="fa-solid fa-phone"></i></button>
          </td>
        </tr>`;
      }).join("")}
      </tbody></table></div>`;
  }

  async function carregar() {
    try {
      const r = await API.get("/api/cobrancas");
      _lista = r.dados || [];
      const totalDias = _lista.reduce((s,f) => s + diasAtraso(f.vencimento), 0);
      const mediaDias = _lista.length ? Math.round(totalDias / _lista.length) : 0;
      document.getElementById("cob-resumo").innerHTML = `
        <div class="stat stat--danger"><div class="stat__icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
          <div class="stat__body"><div class="stat__value">${fmt.moeda(r.total)}</div><div class="stat__label">Total em atraso</div></div></div>
        <div class="stat stat--warning"><div class="stat__icon"><i class="fa-solid fa-users"></i></div>
          <div class="stat__body"><div class="stat__value">${_lista.length}</div><div class="stat__label">Clientes inadimplentes</div></div></div>
        <div class="stat stat--info"><div class="stat__icon"><i class="fa-solid fa-calendar-xmark"></i></div>
          <div class="stat__body"><div class="stat__value">${mediaDias} dias</div><div class="stat__label">Atraso médio</div></div></div>`;
      renderTabela(_lista);
    } catch(e) {
      document.getElementById("cob-tabela").innerHTML =
        `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
    }
  }

  // Filtro por cliente
  document.getElementById("cob-busca").oninput = debounce((e) => {
    const q = e.target.value.trim().toLowerCase();
    renderTabela(q ? _lista.filter((f) => (f.cliente_nome||"").toLowerCase().includes(q)) : _lista);
  });

  window.__cob = {
    // Registra silenciosamente que clicou no WhatsApp
    async registrarWpp(fid) {
      try {
        await API.post("/api/cobrancas/registrar", {
          financeiro_id: fid, canal: "whatsapp",
          mensagem: "Link do WhatsApp aberto",
        });
      } catch(_) {}
    },

    // Modal para registrar contato manual (ligação, visita etc)
    registrarManual(fid) {
      Modal.abrir("Registrar Contato", `
        <div class="form-grid" id="manual-form">
          <div class="field col-2"><label>Canal</label>
            <select name="canal">
              <option value="ligacao">Ligação telefônica</option>
              <option value="whatsapp">WhatsApp (manual)</option>
              <option value="visita">Visita presencial</option>
              <option value="manual">Outro</option>
            </select>
          </div>
          <div class="field col-2"><label>Observação</label>
            <input name="mensagem" placeholder="Ex: cliente prometeu pagar na sexta…">
          </div>
        </div>`,
        `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
         <button class="btn btn--primary" id="manual-ok">
           <i class="fa-solid fa-check"></i> Registrar
         </button>`);
      document.getElementById("manual-ok").onclick = async () => {
        const f = document.getElementById("manual-form");
        const canal = f.querySelector('[name="canal"]').value;
        const msg = f.querySelector('[name="mensagem"]').value.trim();
        try {
          await API.post("/api/cobrancas/registrar", {
            financeiro_id: fid, canal, mensagem: msg || null,
          });
          toast("Contato registrado");
          Modal.fechar();
        } catch(e) { toast(e.message, "error"); }
      };
    },

    // Modal de envio de email de cobrança
    abrirEmail(fid) {
      const f = _lista.find((x) => x.id === fid);
      if (!f) return;
      Modal.abrir(`<i class="fa-solid fa-envelope"></i> Cobrança por Email`, `
        <p style="color:var(--text-muted);font-size:.85rem;margin-bottom:1rem">
          Um email profissional de cobrança será enviado via SMTP configurado em Configurações.
        </p>
        <div class="form-grid" id="email-cob-form">
          <div class="field col-2"><label>Email do cliente *</label>
            <input id="ecob-email" type="email" value="${f.email || ""}"
              placeholder="email@cliente.com.br">
          </div>
          <div class="field col-2"><label>Mensagem adicional (opcional)</label>
            <input id="ecob-msg" placeholder="Ex: Entre em contato até sexta para negociar…">
          </div>
        </div>`,
        `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
         <button class="btn btn--primary" id="ecob-enviar">
           <i class="fa-solid fa-paper-plane"></i> Enviar cobrança
         </button>`);
      document.getElementById("ecob-enviar").onclick = async () => {
        const email = document.getElementById("ecob-email")?.value.trim();
        if (!email) { toast("Informe o email do cliente", "warning"); return; }
        const btn = document.getElementById("ecob-enviar");
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner spin"></i> Enviando…`;
        try {
          await API.post("/api/cobrancas/email", {
            financeiro_id: fid,
            email,
            mensagem: document.getElementById("ecob-msg")?.value.trim() || null,
          });
          toast(`Cobrança enviada para ${email}`);
          Modal.fechar();
        } catch(e) {
          toast(e.message, "error");
          btn.disabled = false;
          btn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Enviar cobrança`;
        }
      };
    },

    // Modal de histórico de contatos
    async verHistorico(fid, clienteNome) {
      Modal.abrir(`<i class="fa-solid fa-clock-rotate-left"></i> Histórico — ${clienteNome}`,
        `<div id="hist-cob-body"><div class="loading"><i class="fa-solid fa-spinner spin"></i></div></div>`,
        `<button class="btn btn--ghost" onclick="Modal.fechar()">Fechar</button>`);
      try {
        const r = await API.get(`/api/cobrancas/historico/${fid}`);
        const lista = r.dados || [];
        const icones = { whatsapp: "fa-brands fa-whatsapp", email: "fa-solid fa-envelope",
          ligacao: "fa-solid fa-phone", visita: "fa-solid fa-person-walking", manual: "fa-solid fa-note-sticky" };
        const cores = { whatsapp: "#25d366", email: "var(--primary)", ligacao: "#3498db",
          visita: "#9b59b6", manual: "#95a5a6" };
        document.getElementById("hist-cob-body").innerHTML = lista.length
          ? `<div style="display:flex;flex-direction:column;gap:.75rem">
              ${lista.map((h) => `
                <div style="display:flex;gap:.75rem;align-items:flex-start;padding:.75rem;background:var(--bg-alt,#f8f9fa);border-radius:8px">
                  <i class="${icones[h.canal]||'fa-solid fa-circle'}"
                    style="color:${cores[h.canal]||'#888'};margin-top:2px;font-size:1.1rem"></i>
                  <div style="flex:1">
                    <div style="font-weight:600;text-transform:capitalize">${h.canal}</div>
                    ${h.mensagem ? `<div style="color:var(--text-muted);font-size:.85rem">${h.mensagem}</div>` : ""}
                    <div style="font-size:.8rem;color:var(--text-muted);margin-top:2px">
                      ${fmt.dataHora(h.criado_em)} — ${h.usuario_nome || "sistema"}
                    </div>
                  </div>
                </div>`).join("")}
            </div>`
          : `<div class="empty"><i class="fa-solid fa-inbox"></i>Nenhum contato registrado</div>`;
      } catch(e) {
        document.getElementById("hist-cob-body").innerHTML =
          `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
      }
    },
  };

  carregar();
})();
