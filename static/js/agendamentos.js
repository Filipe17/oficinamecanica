/* =======================================================================
   agendamentos.js — Agenda de horários (lista + calendário).
   Cliente + veículo + data/hora + serviço + mecânico. Gera OS.
   ======================================================================= */
(async () => {
  await Layout.iniciar("agendamentos", "Agendamentos");

  const soLeitura = (Layout.permissoes?.agendamentos || 0) < 2
    && Layout.usuario?.perfil !== "administrador";

  let clientes = [], veiculos = [], servicos = [], mecanicos = [];
  try {
    const [rc, rv, rs, rm] = await Promise.all([
      API.get("/api/clientes?por_pagina=1000&ordem=nome"),
      API.get("/api/veiculos?por_pagina=1000"),
      API.get("/api/servicos"),
      API.get("/api/os/mecanicos"),
    ]);
    clientes = rc.dados || [];
    veiculos = rv.dados || [];
    servicos = rs.dados || [];
    mecanicos = rm.dados || [];
  } catch (_) {}

  const STATUS = {
    agendado: { tom: "info", txt: "Agendado" },
    confirmado: { tom: "primary", txt: "Confirmado" },
    compareceu: { tom: "success", txt: "Compareceu" },
    faltou: { tom: "danger", txt: "Faltou" },
    cancelado: { tom: "muted", txt: "Cancelado" },
  };

  let tipo = "recebido";  // (não usado aqui, placeholder seguro)
  const LIMITE_DIA = 3;   // deve bater com LIMITE_POR_DIA no backend (agendamentos.py)
  let modo = "calendario";        // fixo: só calendário
  let mesRef = new Date();         // mês exibido no calendário
  let cache = [];                  // agendamentos carregados

  const iso = (d) => d.toISOString().slice(0, 10);
  const primeiroDiaMes = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
  const ultimoDiaMes = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

  Layout.set(`
    <div class="page-head">
      <div><h1>Agendamentos</h1><p>Agenda de entrada dos veículos</p></div>
    </div>
    <div id="ag-conteudo"><div class="loading"><i class="fa-solid fa-spinner spin"></i></div></div>
  `);

  // Sem botão/abas: a agenda é só o calendário. Criar = clicar num dia.

  async function carregar() {
    // Carrega um range amplo (mês anterior ao próximo) para cobrir lista e calendário.
    const ini = iso(new Date(mesRef.getFullYear(), mesRef.getMonth() - 1, 1));
    const fim = iso(new Date(mesRef.getFullYear(), mesRef.getMonth() + 2, 0));
    const r = await API.get(`/api/agendamentos?inicio=${ini}&fim=${fim}`);
    cache = r.dados || [];
  }

  async function render() {
    const alvo = document.getElementById("ag-conteudo");
    alvo.innerHTML = `<div class="loading"><i class="fa-solid fa-spinner spin"></i></div>`;
    try {
      await carregar();
      alvo.innerHTML = modo === "lista" ? renderLista() : renderCalendario();
      if (modo === "calendario") ligarCalendario();
    } catch (e) {
      alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
    }
  }

  function linhaAcoes(a) {
    if (soLeitura) return "";
    const podeOS = !a.os_id && a.status !== "cancelado";
    return `
      ${podeOS ? `<button class="icon-btn btn--sm" title="Gerar OS" onclick="window.__ag.gerarOS(${a.id})"><i class="fa-solid fa-screwdriver-wrench"></i></button>` : ""}
      ${a.os_id ? `<span class="badge badge--success" title="OS gerada">OS ✓</span>` : ""}
      <button class="icon-btn btn--sm" title="Editar" onclick="window.__ag.editar(${a.id})"><i class="fa-solid fa-pen"></i></button>
      <button class="icon-btn btn--sm" title="Excluir" onclick="window.__ag.excluir(${a.id})"><i class="fa-solid fa-trash"></i></button>`;
  }

  function selStatus(a) {
    if (soLeitura) { const s = STATUS[a.status] || {}; return `<span class="badge badge--${s.tom}">${s.txt || a.status}</span>`; }
    return `<select class="badge-select" onchange="window.__ag.status(${a.id}, this.value)">
      ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${a.status === k ? "selected" : ""}>${v.txt}</option>`).join("")}
    </select>`;
  }

  function renderLista() {
    if (!cache.length) return `<div class="card"><div class="card__body"><div class="empty"><i class="fa-solid fa-calendar-xmark"></i>Nenhum agendamento</div></div></div>`;
    // Agrupa por data
    const grupos = {};
    cache.slice().sort((a, b) => (a.data + (a.hora || "")).localeCompare(b.data + (b.hora || "")))
      .forEach((a) => { (grupos[a.data] = grupos[a.data] || []).push(a); });
    return `<div class="card"><div class="card__body">
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Data</th><th>Hora</th><th>Cliente</th><th>Veículo</th><th>Serviço</th><th>Mecânico</th><th>Status</th><th></th></tr></thead>
        <tbody>${Object.keys(grupos).sort().map((data) => grupos[data].map((a, i) => `<tr>
          <td>${i === 0 ? fmt.data(data) : ""}</td>
          <td>${a.hora || "—"}</td>
          <td>${a.cliente_nome || "—"}</td>
          <td>${a.veiculo_placa ? `${a.veiculo_modelo || ""} ${a.veiculo_placa}` : "—"}</td>
          <td>${a.servico_nome || a.descricao || "—"}</td>
          <td>${a.mecanico_nome || "—"}</td>
          <td>${selStatus(a)}</td>
          <td class="text-right">${linhaAcoes(a)}</td>
        </tr>`).join("")).join("")}</tbody>
      </table></div>
    </div></div>`;
  }

  function renderCalendario() {
    const ini = primeiroDiaMes(mesRef), fimM = ultimoDiaMes(mesRef);
    const nomeMes = mesRef.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const primeiroDiaSemana = ini.getDay();  // 0=domingo
    const diasNoMes = fimM.getDate();
    const porDia = {};
    cache.forEach((a) => { (porDia[a.data] = porDia[a.data] || []).push(a); });

    const semanas = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    let celulas = "";
    for (let i = 0; i < primeiroDiaSemana; i++) celulas += `<div class="cal-cel cal-cel--vazia"></div>`;
    for (let dia = 1; dia <= diasNoMes; dia++) {
      const dataIso = iso(new Date(mesRef.getFullYear(), mesRef.getMonth(), dia));
      const doDia = (porDia[dataIso] || []).sort((a, b) => (a.hora || "").localeCompare(b.hora || ""));
      const hoje = dataIso === iso(new Date());
      const ativos = doDia.filter((a) => a.status !== "cancelado").length;
      const lotado = ativos >= LIMITE_DIA;
      const contador = ativos > 0
        ? `<span class="cal-cont ${lotado ? "cal-cont--cheio" : ""}">${lotado ? "Lotado " : ""}${ativos}/${LIMITE_DIA}</span>`
        : "";
      celulas += `<div class="cal-cel ${hoje ? "cal-cel--hoje" : ""} ${lotado ? "cal-cel--lotado" : ""}" ${soLeitura || lotado ? "" : `data-nova="${dataIso}"`}>
        <div class="cal-dia">${dia} ${contador}</div>
        ${doDia.map((a) => {
          const s = STATUS[a.status] || {};
          return `<div class="cal-item cal-item--${s.tom}" title="${a.cliente_nome || ""} ${a.veiculo_placa || ""}" onclick="event.stopPropagation();window.__ag.editar(${a.id})">
            ${a.hora ? `<b>${a.hora}</b> ` : ""}${a.cliente_nome || "—"}</div>`;
        }).join("")}
      </div>`;
    }
    return `<div class="card"><div class="card__body">
      <div class="cal-head">
        <button class="btn btn--ghost btn--sm" id="cal-prev"><i class="fa-solid fa-chevron-left"></i></button>
        <h3 style="text-transform:capitalize;margin:0">${nomeMes}</h3>
        <button class="btn btn--ghost btn--sm" id="cal-next"><i class="fa-solid fa-chevron-right"></i></button>
      </div>
      <div class="cal-grid cal-grid--semana">${semanas.map((s) => `<div class="cal-semana">${s}</div>`).join("")}</div>
      <div class="cal-grid">${celulas}</div>
    </div></div>`;
  }

  function ligarCalendario() {
    document.getElementById("cal-prev").onclick = () => { mesRef = new Date(mesRef.getFullYear(), mesRef.getMonth() - 1, 1); render(); };
    document.getElementById("cal-next").onclick = () => { mesRef = new Date(mesRef.getFullYear(), mesRef.getMonth() + 1, 1); render(); };
    if (!soLeitura) document.querySelectorAll("[data-nova]").forEach((cel) => {
      cel.addEventListener("click", () => abrirForm(null, cel.dataset.nova));
    });
  }

  function opcoesVeiculo(clienteId, selecionado) {
    const doCliente = veiculos.filter((v) => Number(v.cliente_id) === Number(clienteId));
    return `<option value="">— selecione —</option>` + doCliente.map((v) =>
      `<option value="${v.id}" ${Number(selecionado) === Number(v.id) ? "selected" : ""}>${[v.marca, v.modelo, v.placa].filter(Boolean).join(" ")}</option>`).join("");
  }

  function abrirForm(reg, dataPre) {
    const ed = !!reg;
    const v = (k, d = "") => (ed && reg[k] != null ? reg[k] : d);
    Modal.abrir(`${ed ? "Editar" : "Novo"} agendamento`, `
      <div class="form-grid" id="ag-form">
        <div class="field col-2"><label>Cliente *</label>
          <select name="cliente_id" id="ag-cliente"><option value="">— selecione —</option>
            ${clientes.map((c) => `<option value="${c.id}" ${String(v("cliente_id")) === String(c.id) ? "selected" : ""}>${c.nome}</option>`).join("")}</select></div>
        <div class="field col-2"><label>Veículo</label>
          <select name="veiculo_id" id="ag-veiculo">${opcoesVeiculo(v("cliente_id"), v("veiculo_id"))}</select></div>
        <div class="field"><label>Data *</label><input type="date" name="data" value="${v("data", dataPre || "")}"></div>
        <div class="field"><label>Hora</label><input type="time" name="hora" value="${v("hora")}"></div>
        <div class="field"><label>Serviço previsto</label>
          <select name="servico_id"><option value="">— nenhum —</option>
            ${servicos.map((s) => `<option value="${s.id}" ${String(v("servico_id")) === String(s.id) ? "selected" : ""}>${s.descricao}</option>`).join("")}</select></div>
        <div class="field"><label>Mecânico</label>
          <select name="mecanico_id"><option value="">— selecione —</option>
            ${mecanicos.map((m) => `<option value="${m.id}" ${String(v("mecanico_id")) === String(m.id) ? "selected" : ""}>${m.nome}</option>`).join("")}</select></div>
        <div class="field col-2"><label>Observação</label><input name="descricao" value="${v("descricao")}" placeholder="Ex: barulho na suspensão"></div>
        ${ed ? `<div class="field col-2"><label>Status</label>
          <select name="status">${Object.entries(STATUS).map(([k, s]) => `<option value="${k}" ${v("status") === k ? "selected" : ""}>${s.txt}</option>`).join("")}</select></div>` : ""}
      </div>`,
      `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
       ${ed && !reg.os_id && reg.status === "compareceu" ? `<button class="btn btn--success" id="ag-gerar-os"><i class="fa-solid fa-screwdriver-wrench"></i> Gerar OS</button>` : ""}
       ${ed && reg.os_id ? `<span class="badge badge--success" style="align-self:center">OS já gerada</span>` : ""}
       <button class="btn btn--primary" id="ag-salvar"><i class="fa-solid fa-check"></i> Salvar</button>`);

    if (ed && !reg.os_id && reg.status === "compareceu") {
      const btnOS = document.getElementById("ag-gerar-os");
      if (btnOS) btnOS.onclick = () => window.__ag.gerarOS(reg.id);
    }

    // Ao trocar o cliente, recarrega os veículos dele
    document.getElementById("ag-cliente").addEventListener("change", (e) => {
      document.getElementById("ag-veiculo").innerHTML = opcoesVeiculo(e.target.value, null);
    });

    document.getElementById("ag-salvar").onclick = async () => {
      const f = document.getElementById("ag-form");
      const g = (n) => f.querySelector(`[name="${n}"]`);          // ag-form é uma div, não um <form>
      const val = (n) => { const el = g(n); return el ? el.value : ""; };
      const dados = {
        cliente_id: val("cliente_id") || null,
        veiculo_id: val("veiculo_id") || null,
        servico_id: val("servico_id") || null,
        mecanico_id: val("mecanico_id") || null,
        data: val("data") || null,
        hora: val("hora") || null,
        descricao: (val("descricao") || "").trim(),
        status: val("status") || "agendado",
      };
      if (!dados.cliente_id || !dados.data) { toast("Informe cliente e data", "warning"); return; }
      try {
        if (ed) {
          await API.put(`/api/agendamentos/${reg.id}`, dados);
          toast("Agendamento atualizado");
          Modal.fechar();
          await render();
          if (dados.status === "confirmado") {
            const ag = cache.find((x) => x.id === reg.id) || { ...reg, ...dados };
            enviarWhatsConfirmacao(ag);
          }
          return;
        } else {
          const res = await API.post("/api/agendamentos", dados);
          toast("Agendamento criado");
          Modal.fechar();
          await render();
          if (dados.status === "confirmado" && res?.id) {
            const ag = cache.find((x) => x.id === res.id);
            if (ag) enviarWhatsConfirmacao(ag);
          }
          return;
        }
        Modal.fechar(); render();
      } catch (e) { toast(e.message, "error"); }
    };
  }


  /* Dispara WhatsApp de confirmação quando status vira "confirmado" */
  function dispararWhatsConfirmacao(agendamento) {
    const fone = (agendamento.whatsapp || agendamento.telefone || "").replace(/\D/g, "");
    if (!fone) { toast("Cliente sem telefone/WhatsApp — mensagem não enviada", "warning"); return; }
    const data = agendamento.data
      ? new Date(agendamento.data + "T12:00:00").toLocaleDateString("pt-BR")
      : "data agendada";
    const hora = agendamento.hora ? ` às ${agendamento.hora}` : "";
    const msg = `Olá ${agendamento.cliente_nome || ""}! Por favor retornar se vai deixar o carro na data agendada (${data}${hora})?`;
    window.open(`https://wa.me/55${fone}?text=${encodeURIComponent(msg)}`, "_blank");
  }

  /* Enriquece com telefone do cliente (já carregado) e dispara */
  function enviarWhatsConfirmacao(ag) {
    // tenta pegar telefone do objeto do cache (já tem c.whatsapp via backend)
    // se não tiver, pega da lista de clientes
    if (!ag.whatsapp && !ag.telefone) {
      const cli = clientes.find((c) => Number(c.id) === Number(ag.cliente_id));
      if (cli) { ag.whatsapp = cli.whatsapp; ag.telefone = cli.telefone; }
    }
    dispararWhatsConfirmacao(ag);
  }

  window.__ag = {
    editar(id) { const a = cache.find((x) => x.id === id); if (a) abrirForm(a); },
    async status(id, novo) {
      try {
        await API.post(`/api/agendamentos/${id}/status`, { status: novo });
        toast("Status atualizado");
        await render();
        if (novo === "confirmado") {
          const ag = cache.find((x) => x.id === id);
          if (ag) enviarWhatsConfirmacao(ag);
        }
      } catch (e) { toast(e.message, "error"); }
    },
    async excluir(id) {
      if (!confirm("Excluir este agendamento?")) return;
      try { await API.del(`/api/agendamentos/${id}`); toast("Excluído"); render(); }
      catch (e) { toast(e.message, "error"); }
    },
    async gerarOS(id) {
      if (!confirm("Gerar uma OS a partir deste agendamento?")) return;
      try {
        const r = await API.post(`/api/agendamentos/${id}/gerar-os`, {});
        toast("OS gerada com sucesso");
        if (typeof Modal !== "undefined" && Modal.fechar) Modal.fechar();
        render();
      } catch (e) { toast(e.message, "error"); }
    },
  };

  window.__recarregar = render;
  render();
})();
