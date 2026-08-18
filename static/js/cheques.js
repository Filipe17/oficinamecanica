/* =======================================================================
   cheques.js — Controle de cheques recebidos e emitidos.
   Ao compensar, lança automaticamente no financeiro.
   ======================================================================= */
(async () => {
  await Layout.iniciar("cheques", "Cheques");

  const soLeitura = (Layout.permissoes?.cheques || 0) < 2
    && Layout.usuario?.perfil !== "administrador";

  let clientes = [], fornecedores = [];
  try {
    const [rc, rf] = await Promise.all([
      API.get("/api/clientes?por_pagina=1000&ordem=nome"),
      API.get("/api/fornecedores").catch(() => ({ dados: [] })),
    ]);
    clientes = rc.dados || [];
    fornecedores = rf.dados || [];
  } catch (_) {}

  const STATUS = {
    na_carteira: { tom: "info", txt: "Na carteira" },
    depositado: { tom: "primary", txt: "Depositado" },
    compensado: { tom: "success", txt: "Compensado" },
    devolvido: { tom: "danger", txt: "Devolvido" },
    repassado: { tom: "warning", txt: "Repassado" },
    cancelado: { tom: "muted", txt: "Cancelado" },
    emitido: { tom: "info", txt: "Emitido" },
  };
  const STATUS_POR_TIPO = {
    recebido: ["na_carteira", "depositado", "compensado", "devolvido", "repassado", "cancelado"],
    emitido: ["emitido", "compensado", "cancelado"],
  };

  let tipo = "recebido";
  let cache = [];

  Layout.set(`
    <div class="page-head">
      <div><h1>Cheques</h1><p>Controle de cheques recebidos e emitidos</p></div>
      ${soLeitura ? "" : `<button class="btn btn--primary" id="ch-novo"><i class="fa-solid fa-plus"></i> Novo cheque</button>`}
    </div>
    <div id="ch-resumo" class="stat-grid" style="margin-bottom:14px"></div>
    <div class="tabs" id="ch-tabs">
      <button class="tab active" data-tipo="recebido"><i class="fa-solid fa-arrow-down"></i> Recebidos</button>
      <button class="tab" data-tipo="emitido"><i class="fa-solid fa-arrow-up"></i> Emitidos</button>
    </div>
    <div id="ch-conteudo"><div class="loading"><i class="fa-solid fa-spinner spin"></i></div></div>
  `);

  if (!soLeitura) document.getElementById("ch-novo").onclick = () => abrirForm();
  document.getElementById("ch-tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tab"); if (!b) return;
    document.querySelectorAll("#ch-tabs .tab").forEach((t) => t.classList.remove("active"));
    b.classList.add("active"); tipo = b.dataset.tipo; carregar();
  });

  async function resumo() {
    try {
      const r = await API.get("/api/cheques/resumo");
      const card = (lbl, o, tom) => `<div class="stat ${tom ? "stat--" + tom : ""}"><div class="stat__body">
        <div class="stat__value">${fmt.moeda(o.valor)}</div><div class="stat__label">${lbl} (${o.qtd})</div></div></div>`;
      document.getElementById("ch-resumo").innerHTML =
        card("Na carteira", r.receber_carteira) +
        card("Depositados", r.receber_depositado, "primary") +
        card("Devolvidos", r.recebido_devolvido, "danger") +
        card("Emitidos em aberto", r.emitido_aberto, "warning");
    } catch (_) {}
  }

  async function carregar() {
    const alvo = document.getElementById("ch-conteudo");
    alvo.innerHTML = `<div class="loading"><i class="fa-solid fa-spinner spin"></i></div>`;
    try {
      const r = await API.get(`/api/cheques?tipo=${tipo}`);
      cache = r.dados || [];
      resumo();
      if (!cache.length) {
        alvo.innerHTML = `<div class="card"><div class="card__body"><div class="empty"><i class="fa-solid fa-money-check"></i>Nenhum cheque ${tipo === "recebido" ? "recebido" : "emitido"}</div></div></div>`;
        return;
      }
      alvo.innerHTML = `<div class="card"><div class="card__body"><div class="table-wrap"><table class="data">
        <thead><tr><th>Nº</th><th>Banco</th><th>${tipo === "recebido" ? "Cliente/Titular" : "Fornecedor"}</th><th>Bom para</th><th>Valor</th><th>Status</th><th></th></tr></thead>
        <tbody>${cache.map((c) => `<tr>
          <td><b>${c.numero || "—"}</b></td>
          <td>${c.banco || "—"}</td>
          <td>${tipo === "recebido" ? (c.cliente_nome || c.titular || "—") : (c.fornecedor_nome || c.titular || "—")}</td>
          <td>${fmt.data(c.bom_para)}</td>
          <td>${fmt.moeda(c.valor)}</td>
          <td>${selStatus(c)}</td>
          <td class="text-right">${acoes(c)}</td>
        </tr>`).join("")}</tbody>
      </table></div></div></div>`;
    } catch (e) {
      alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
    }
  }

  function selStatus(c) {
    if (soLeitura) { const s = STATUS[c.status] || {}; return `<span class="badge badge--${s.tom}">${s.txt || c.status}</span>`; }
    const opcoes = STATUS_POR_TIPO[c.tipo] || [];
    return `<select class="badge-select" onchange="window.__ch.status(${c.id}, this.value)">
      ${opcoes.map((k) => `<option value="${k}" ${c.status === k ? "selected" : ""}>${STATUS[k].txt}</option>`).join("")}
    </select>`;
  }
  function acoes(c) {
    if (soLeitura) return "";
    return `
      ${c.financeiro_id ? `<span class="badge badge--success" title="Lançado no financeiro">$ ✓</span>` : ""}
      <button class="icon-btn btn--sm" title="Editar" onclick="window.__ch.editar(${c.id})"><i class="fa-solid fa-pen"></i></button>
      <button class="icon-btn btn--sm" title="Excluir" onclick="window.__ch.excluir(${c.id})"><i class="fa-solid fa-trash"></i></button>`;
  }

  function abrirForm(reg) {
    const ed = !!reg;
    const t = ed ? reg.tipo : tipo;
    const v = (k, d = "") => (ed && reg[k] != null ? reg[k] : d);
    const pessoaCampo = t === "recebido"
      ? `<div class="field col-2"><label>Cliente</label>
           <select name="cliente_id"><option value="">— avulso —</option>
             ${clientes.map((c) => `<option value="${c.id}" ${String(v("cliente_id")) === String(c.id) ? "selected" : ""}>${c.nome}</option>`).join("")}</select></div>`
      : `<div class="field col-2"><label>Fornecedor</label>
           <select name="fornecedor_id"><option value="">— avulso —</option>
             ${fornecedores.map((f) => `<option value="${f.id}" ${String(v("fornecedor_id")) === String(f.id) ? "selected" : ""}>${f.nome}</option>`).join("")}</select></div>`;
    Modal.abrir(`${ed ? "Editar" : "Novo"} cheque ${t === "recebido" ? "recebido" : "emitido"}`, `
      <div class="form-grid" id="ch-form">
        <div class="field"><label>Número</label><input name="numero" value="${v("numero")}"></div>
        <div class="field"><label>Valor</label><input name="valor" type="number" step="0.01" value="${v("valor", 0)}"></div>
        <div class="field"><label>Banco</label><input name="banco" value="${v("banco")}"></div>
        <div class="field"><label>Agência</label><input name="agencia" value="${v("agencia")}"></div>
        <div class="field"><label>Conta</label><input name="conta" value="${v("conta")}"></div>
        <div class="field"><label>Titular (quem assinou)</label><input name="titular" value="${v("titular")}"></div>
        ${pessoaCampo}
        <div class="field"><label>Emissão</label><input name="emissao" type="date" value="${v("emissao")}"></div>
        <div class="field"><label>Bom para (vencimento)</label><input name="bom_para" type="date" value="${v("bom_para")}"></div>
        <div class="field col-2"><label>Observação</label><input name="observacao" value="${v("observacao")}"></div>
      </div>`,
      `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
       <button class="btn btn--primary" id="ch-salvar"><i class="fa-solid fa-check"></i> Salvar</button>`);
    document.getElementById("ch-salvar").onclick = async () => {
      const f = document.getElementById("ch-form");
      const g = (n) => f.querySelector(`[name="${n}"]`);   // ch-form é uma div
      const val = (n) => { const el = g(n); return el ? el.value : ""; };
      const dados = {
        tipo: t,
        numero: val("numero").trim(),
        valor: parseFloat(val("valor")) || 0,
        banco: val("banco").trim(),
        agencia: val("agencia").trim(),
        conta: val("conta").trim(),
        titular: val("titular").trim(),
        cliente_id: val("cliente_id") || null,
        fornecedor_id: val("fornecedor_id") || null,
        emissao: val("emissao") || null,
        bom_para: val("bom_para") || null,
        observacao: val("observacao").trim(),
      };
      if (!dados.valor) { toast("Informe o valor do cheque", "warning"); return; }
      try {
        if (ed) await API.put(`/api/cheques/${reg.id}`, dados);
        else await API.post("/api/cheques", dados);
        toast("Cheque salvo"); Modal.fechar(); carregar();
      } catch (e) { toast(e.message, "error"); }
    };
  }

  window.__ch = {
    editar(id) { const c = cache.find((x) => x.id === id); if (c) abrirForm(c); },
    async status(id, novo) {
      const c = cache.find((x) => x.id === id);
      if (novo === "compensado" && !confirm("Compensar o cheque? Isso lança no financeiro.")) { carregar(); return; }
      try {
        const r = await API.post(`/api/cheques/${id}/status`, { status: novo });
        toast(novo === "compensado" && r.financeiro_id ? "Compensado e lançado no financeiro" : "Status atualizado");
        carregar();
      } catch (e) { toast(e.message, "error"); carregar(); }
    },
    async excluir(id) {
      if (!confirm("Excluir este cheque? Se estiver compensado, o lançamento no financeiro também será removido.")) return;
      try { await API.del(`/api/cheques/${id}`); toast("Excluído"); carregar(); }
      catch (e) { toast(e.message, "error"); }
    },
  };

  window.__recarregar = carregar;
  carregar();
})();
