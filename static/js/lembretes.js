/* =======================================================================
   lembretes.js — Lembretes de Revisão
   Lista clientes com revisão vencida ou próxima. Permite enviar lembrete
   por WhatsApp, email ou registrar contato manual.
   ======================================================================= */
(async () => {
  await Layout.iniciar("lembretes", "Lembretes de Revisão");

  const cfg = Layout.config || {};
  const empresa = cfg.empresa_nome || "Oficina";
  const tel = cfg.empresa_telefone || "";

  Layout.set(`
    <div class="page-head">
      <div><h1>Lembretes de Revisão</h1>
        <p>Clientes que precisam trazer o veículo para revisão</p></div>
      <div style="display:flex;gap:.5rem;align-items:center">
        <div class="field" style="margin:0">
          <label style="font-size:.8rem">Intervalo padrão (dias)</label>
          <input type="number" id="lmb-intervalo" value="180" min="30" max="730"
            style="width:90px" title="Intervalo entre revisões">
        </div>
        <button class="btn btn--primary" id="lmb-atualizar">
          <i class="fa-solid fa-rotate"></i> Atualizar
        </button>
      </div>
    </div>

    <div class="stat-grid" id="lmb-resumo"></div>

    <div class="card"><div class="card__body">
      <div class="tabs" id="lmb-tabs" style="margin-bottom:1rem">
        <button class="tab active" data-status="pendente">Pendentes</button>
        <button class="tab" data-status="enviado">Enviados</button>
        <button class="tab" data-status="agendado">Agendados</button>
        <button class="tab" data-status="dispensado">Dispensados</button>
        <button class="tab" data-status="todos">Todos</button>
      </div>
      <div id="lmb-tabela">
        <div class="loading"><i class="fa-solid fa-spinner spin"></i></div>
      </div>
    </div></div>
  `);

  let _statusAtual = "pendente";
  let _lista = [];

  async function carregar() {
    const intervalo = document.getElementById("lmb-intervalo").value || 180;
    const alvo = document.getElementById("lmb-tabela");
    alvo.innerHTML = `<div class="loading"><i class="fa-solid fa-spinner spin"></i></div>`;
    try {
      const r = await API.get(`/api/lembretes?status=${_statusAtual}&intervalo=${intervalo}`);
      _lista = r.dados || [];

      // Cards de resumo
      document.getElementById("lmb-resumo").innerHTML = `
        <div class="stat stat--warning">
          <div class="stat__icon"><i class="fa-solid fa-bell"></i></div>
          <div class="stat__body">
            <div class="stat__value">${r.total_pendente}</div>
            <div class="stat__label">Pendentes</div>
          </div>
        </div>
        <div class="stat stat--danger">
          <div class="stat__icon"><i class="fa-solid fa-calendar-xmark"></i></div>
          <div class="stat__body">
            <div class="stat__value">${r.total_atrasado}</div>
            <div class="stat__label">Atrasados</div>
          </div>
        </div>`;

      if (!_lista.length) {
        alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-check"></i>
          Nenhum lembrete ${_statusAtual === "todos" ? "" : _statusAtual}</div>`;
        return;
      }

      alvo.innerHTML = `<div class="table-wrap"><table class="data">
        <thead><tr>
          <th>Cliente</th><th>Veículo</th><th>Última OS</th>
          <th>Revisão prevista</th><th>Status</th><th>Ações</th>
        </tr></thead>
        <tbody>${_lista.map((l) => {
          const atrasado = l.atrasado;
          const corData = atrasado ? "color:#e74c3c;font-weight:700" : "";
          const zap = l.whatsapp || l.telefone;
          const msgZap = encodeURIComponent(
            `Olá ${l.cliente_nome || ""}! 👋\n\n` +
            `Seu ${l.veiculo_modelo || "veículo"}${l.veiculo_placa ? ` (${l.veiculo_placa})` : ""} ` +
            `está precisando de revisão.\n\n` +
            `Sua última visita foi em ${fmt.data(l.data_ultima_os)}. ` +
            `Entre em contato para agendar! 🔧\n\n${empresa}${tel ? "\n" + tel : ""}`
          );
          return `<tr style="${atrasado ? "background:#fff5f5" : ""}">
            <td>
              <strong>${l.cliente_nome || "—"}</strong>
              ${atrasado ? `<span class="badge badge--danger" style="margin-left:4px;font-size:.7rem">Atrasado</span>` : ""}
            </td>
            <td>
              ${l.veiculo_modelo ? `<div>${l.veiculo_marca || ""} ${l.veiculo_modelo}</div>` : "—"}
              ${l.veiculo_placa ? `<small style="color:var(--text-muted)">${l.veiculo_placa}</small>` : ""}
            </td>
            <td>${fmt.data(l.data_ultima_os)}</td>
            <td style="${corData}">${fmt.data(l.data_prevista)}</td>
            <td>
              <span class="badge badge--${
                l.status==="pendente"?"warning":
                l.status==="enviado"?"success":
                l.status==="agendado"?"info":""}">
                ${l.status}
              </span>
              ${l.enviado_em ? `<br><small style="color:var(--text-muted)">${fmt.data(l.enviado_em)}</small>` : ""}
            </td>
            <td style="white-space:nowrap">
              ${zap ? `<a class="icon-btn btn--sm" title="WhatsApp"
                href="https://wa.me/55${String(zap).replace(/\D/g,"")}?text=${msgZap}"
                target="_blank" onclick="window.__lmb.regWpp(${l.id})">
                <i class="fa-brands fa-whatsapp" style="color:#25d366"></i></a>` : ""}
              ${l.email ? `<button class="icon-btn btn--sm" title="Enviar email"
                onclick="window.__lmb.abrirEmail(${l.id})">
                <i class="fa-solid fa-envelope"></i></button>` : ""}
              <button class="icon-btn btn--sm" title="Reagendar"
                onclick="window.__lmb.reagendar(${l.id})">
                <i class="fa-solid fa-calendar-plus"></i></button>
              <button class="icon-btn btn--sm" title="Dispensar"
                onclick="window.__lmb.dispensar(${l.id})">
                <i class="fa-solid fa-xmark"></i></button>
            </td>
          </tr>`;
        }).join("")}
        </tbody></table></div>`;
    } catch(e) {
      alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
    }
  }

  // Tabs
  document.getElementById("lmb-tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tab"); if (!b) return;
    document.querySelectorAll("#lmb-tabs .tab").forEach((t) => t.classList.remove("active"));
    b.classList.add("active");
    _statusAtual = b.dataset.status;
    carregar();
  });

  document.getElementById("lmb-atualizar").onclick = carregar;

  window.__lmb = {
    async regWpp(id) {
      try {
        await API.post(`/api/lembretes/${id}/registrar`, { acao: "enviado", canal: "whatsapp" });
        setTimeout(carregar, 500);
      } catch(_) {}
    },

    abrirEmail(id) {
      const l = _lista.find((x) => x.id === id);
      if (!l) return;
      Modal.abrir(`<i class="fa-solid fa-envelope"></i> Lembrete por Email`,
        `<p style="color:var(--text-muted);font-size:.85rem;margin-bottom:1rem">
          Será enviado um email de lembrete de revisão para o cliente.
        </p>
        <div class="form-grid" id="lmb-email-form">
          <div class="field col-2"><label>Email do cliente *</label>
            <input id="lmb-email-dest" type="email" value="${l.email || ""}"
              placeholder="email@cliente.com.br">
          </div>
          <div class="field col-2"><label>Mensagem adicional (opcional)</label>
            <input id="lmb-email-msg" placeholder="Ex: Promoção de troca de óleo esta semana!">
          </div>
        </div>`,
        `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
         <button class="btn btn--primary" id="lmb-email-enviar">
           <i class="fa-solid fa-paper-plane"></i> Enviar
         </button>`);
      document.getElementById("lmb-email-enviar").onclick = async () => {
        const email = document.getElementById("lmb-email-dest")?.value.trim();
        if (!email) { toast("Informe o email", "warning"); return; }
        const btn = document.getElementById("lmb-email-enviar");
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner spin"></i> Enviando…`;
        try {
          await API.post("/api/lembretes/email", {
            lembrete_id: id,
            email,
            mensagem: document.getElementById("lmb-email-msg")?.value.trim() || null,
          });
          toast(`Lembrete enviado para ${email}`);
          Modal.fechar();
          carregar();
        } catch(e) {
          toast(e.message, "error");
          btn.disabled = false;
          btn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Enviar`;
        }
      };
    },

    reagendar(id) {
      const l = _lista.find((x) => x.id === id);
      if (!l) return;
      Modal.abrir(`<i class="fa-solid fa-calendar-plus"></i> Reagendar Revisão`,
        `<div class="form-grid" id="lmb-reag-form">
          <div class="field col-2"><label>Nova data prevista *</label>
            <input type="date" id="lmb-reag-data" value="${l.data_prevista||""}">
          </div>
          <div class="field col-2"><label>Observação</label>
            <input id="lmb-reag-obs" placeholder="Motivo do reagendamento…">
          </div>
        </div>`,
        `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
         <button class="btn btn--primary" id="lmb-reag-ok">
           <i class="fa-solid fa-check"></i> Reagendar
         </button>`);
      document.getElementById("lmb-reag-ok").onclick = async () => {
        const data = document.getElementById("lmb-reag-data")?.value;
        if (!data) { toast("Informe a nova data", "warning"); return; }
        try {
          await API.post(`/api/lembretes/${id}/reagendar`, {
            data_prevista: data,
            obs: document.getElementById("lmb-reag-obs")?.value.trim() || null,
          });
          toast("Reagendado");
          Modal.fechar();
          carregar();
        } catch(e) { toast(e.message, "error"); }
      };
    },

    async dispensar(id) {
      if (!confirm("Dispensar este lembrete? O cliente não receberá mais avisos para esta revisão.")) return;
      try {
        await API.post(`/api/lembretes/${id}/registrar`, {
          acao: "dispensado", canal: "manual",
          obs: "Dispensado manualmente",
        });
        toast("Lembrete dispensado");
        carregar();
      } catch(e) { toast(e.message, "error"); }
    },
  };

  window.__recarregar = carregar;
  carregar();
})();
