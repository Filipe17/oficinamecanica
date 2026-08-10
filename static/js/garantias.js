/* =======================================================================
   garantias.js — Controle de Garantias de Serviços
   ======================================================================= */
(async () => {
  await Layout.iniciar("garantias", "Garantias");

  Layout.set(`
    <div class="page-head">
      <div><h1>Garantias</h1>
        <p>Controle de garantias de serviços realizados</p></div>
    </div>

    <div class="stat-grid" id="gar-resumo"></div>

    <div class="card"><div class="card__body">
      <div class="tabs" id="gar-tabs">
        <button class="tab active" data-status="vigente">Vigentes</button>
        <button class="tab" data-status="vencida">Vencidas</button>
        <button class="tab" data-status="acionada">Acionadas</button>
        <button class="tab" data-status="todos">Todas</button>
      </div>
    </div></div>

    <div class="card"><div class="card__body">
      <div id="gar-lista">
        <div class="loading"><i class="fa-solid fa-spinner spin"></i></div>
      </div>
    </div></div>
  `);

  let _status = "vigente";
  let _lista = [];

  function _corDias(dias) {
    if (dias === null || dias === undefined) return "#888";
    if (dias < 0) return "#ef4444";
    if (dias <= 15) return "#f59e0b";
    if (dias <= 30) return "#3b82f6";
    return "#22c55e";
  }

  function _labelDias(dias) {
    if (dias === null || dias === undefined) return "—";
    if (dias < 0) return `Venceu há ${Math.abs(dias)} dia(s)`;
    if (dias === 0) return "Vence hoje!";
    return `${dias} dia(s) restantes`;
  }

  async function carregar() {
    const alvo = document.getElementById("gar-lista");
    alvo.innerHTML = `<div class="loading"><i class="fa-solid fa-spinner spin"></i></div>`;
    try {
      const r = await API.get(`/api/garantias?status=${_status}`);
      _lista = r.dados || [];

      document.getElementById("gar-resumo").innerHTML = `
        <div class="stat stat--success">
          <div class="stat__icon"><i class="fa-solid fa-shield-halved"></i></div>
          <div class="stat__body">
            <div class="stat__value">${r.total_vigente}</div>
            <div class="stat__label">Vigentes</div>
          </div>
        </div>`;

      if (!_lista.length) {
        alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-shield-halved"></i>
          Nenhuma garantia ${_status === "todos" ? "" : _status}</div>`;
        return;
      }

      alvo.innerHTML = `<div class="table-wrap"><table class="data">
        <thead><tr>
          <th>OS</th><th>Cliente</th><th>Veículo</th><th>Garantia</th>
          <th>Início</th><th>Vencimento</th><th>Situação</th><th>Ações</th>
        </tr></thead>
        <tbody>${_lista.map((g) => {
          const cor = _corDias(g.dias_restantes);
          const labelDias = _labelDias(g.dias_restantes);
          const badgeCor = g.status === "vigente" ? "success" :
                           g.status === "vencida" ? "danger" : "warning";
          return `<tr>
            <td><strong>${g.os_numero || "—"}</strong></td>
            <td>${g.cliente_nome || "—"}</td>
            <td>${g.veiculo_modelo ? `${g.veiculo_marca} ${g.veiculo_modelo}` : "—"}
              ${g.veiculo_placa ? `<br><small style="color:var(--text-muted)">${g.veiculo_placa}</small>` : ""}</td>
            <td style="max-width:180px;font-size:.85rem">${g.descricao || "—"}</td>
            <td>${fmt.data(g.data_inicio)}</td>
            <td>${fmt.data(g.data_fim)}</td>
            <td>
              <span class="badge badge--${badgeCor}">${g.status}</span>
              ${g.status === "vigente" ? `<br><small style="color:${cor};font-weight:600">${labelDias}</small>` : ""}
            </td>
            <td style="white-space:nowrap">
              ${g.status === "vigente" ? `
                <button class="icon-btn btn--sm" title="Registrar acionamento"
                  onclick="window.__gar.acionar(${g.id})">
                  <i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b"></i>
                </button>` : ""}
              <button class="icon-btn btn--sm" title="Excluir"
                onclick="window.__gar.excluir(${g.id})">
                <i class="fa-solid fa-trash"></i>
              </button>
            </td>
          </tr>`;
        }).join("")}
        </tbody></table></div>`;

    } catch(e) {
      document.getElementById("gar-lista").innerHTML =
        `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
    }
  }

  document.getElementById("gar-tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tab"); if (!b) return;
    document.querySelectorAll("#gar-tabs .tab").forEach((t) => t.classList.remove("active"));
    b.classList.add("active");
    _status = b.dataset.status;
    carregar();
  });

  window.__gar = {
    acionar(id) {
      Modal.abrir(`<i class="fa-solid fa-triangle-exclamation"></i> Acionar Garantia`,
        `<p style="color:var(--text-muted);font-size:.85rem;margin-bottom:1rem">
          Registre o acionamento da garantia pelo cliente.
        </p>
        <div class="form-grid" id="gar-acion-form">
          <div class="field col-2"><label>Descrição do problema relatado *</label>
            <input id="gar-acion-obs" placeholder="Ex: Voltou o barulho na suspensão…">
          </div>
        </div>`,
        `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
         <button class="btn btn--warning" id="gar-acion-ok" style="background:#f59e0b;color:#fff;border:none">
           <i class="fa-solid fa-check"></i> Registrar acionamento
         </button>`);
      document.getElementById("gar-acion-ok").onclick = async () => {
        const obs = document.getElementById("gar-acion-obs")?.value.trim();
        if (!obs) { toast("Descreva o problema relatado", "warning"); return; }
        try {
          await API.post(`/api/garantias/${id}/acionar`, { obs });
          toast("Garantia acionada registrada");
          Modal.fechar();
          carregar();
        } catch(e) { toast(e.message, "error"); }
      };
    },

    async excluir(id) {
      if (!confirm("⚠️ Excluir garantia\n\nEsta ação não pode ser desfeita. Confirma?")) return;
      try {
        await API.delete(`/api/garantias/${id}`);
        toast("Garantia excluída");
        carregar();
      } catch(e) { toast(e.message, "error"); }
    },
  };

  carregar();
})();
