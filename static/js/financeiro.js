/* =======================================================================
   financeiro.js — Contas a receber / a pagar + fluxo de caixa
   ======================================================================= */
(async () => {
  await Layout.iniciar("financeiro", "Financeiro");

  const FORMAS = ["pix", "cartao", "dinheiro", "boleto", "cheque", "carne"];
  let tipo = "receber";
  let clientes = [], fornecedores = [];
  try {
    const [rc, rf] = await Promise.all([
      API.get("/api/clientes?por_pagina=1000&ordem=nome"),
      API.get("/api/fornecedores"),
    ]);
    clientes = rc.dados || [];
    fornecedores = rf.dados || rf || [];
  } catch (_) {}

  Layout.set(`
    <div class="page-head">
      <div><h1>Financeiro</h1><p>Contas a receber, a pagar e fluxo de caixa</p></div>
      <button class="btn btn--primary" id="fin-novo"><i class="fa-solid fa-plus"></i> Novo lançamento</button>
    </div>
    <div class="tabs" id="fin-tabs">
      <button class="tab active" data-tipo="receber">Contas a receber</button>
      <button class="tab" data-tipo="pagar">Contas a pagar</button>
    </div>
    <div class="fin-totais stat-grid" id="fin-totais"></div>
    <div class="card"><div class="card__body" id="fin-tabela">
      <div class="loading"><i class="fa-solid fa-spinner spin"></i></div>
    </div></div>
  `);

  document.getElementById("fin-novo").onclick = () => abrirForm();
  document.getElementById("fin-tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tab"); if (!b) return;
    document.querySelectorAll("#fin-tabs .tab").forEach((t) => t.classList.remove("active"));
    b.classList.add("active"); tipo = b.dataset.tipo; carregar();
  });

  async function carregar() {
    const alvo = document.getElementById("fin-tabela");
    alvo.innerHTML = `<div class="loading"><i class="fa-solid fa-spinner spin"></i></div>`;
    try {
      const r = await API.get(`/api/financeiro?tipo=${tipo}`);
      const lista = r.dados || [], t = r.totais || {};
      document.getElementById("fin-totais").innerHTML = `
        <div class="stat stat--info"><div class="stat__icon"><i class="fa-solid fa-clock"></i></div>
          <div class="stat__body"><div class="stat__value">${fmt.moeda(t.aberto)}</div><div class="stat__label">Em aberto</div></div></div>
        <div class="stat stat--success"><div class="stat__icon"><i class="fa-solid fa-circle-check"></i></div>
          <div class="stat__body"><div class="stat__value">${fmt.moeda(t.pago)}</div><div class="stat__label">Baixado</div></div></div>
        <div class="stat stat--danger"><div class="stat__icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
          <div class="stat__body"><div class="stat__value">${fmt.moeda(t.atrasado)}</div><div class="stat__label">Atrasado</div></div></div>`;

      if (!lista.length) { alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-inbox"></i>Nenhum lançamento</div>`; return; }
      const tom = { aberto: "info", pago: "success", atrasado: "danger" };
      alvo.innerHTML = `<div class="table-wrap"><table class="data">
        <thead><tr><th>Descrição</th><th>${tipo === "receber" ? "Cliente" : "Fornecedor"}</th>
          <th>Vencimento</th><th>Valor</th><th>Status</th><th></th></tr></thead>
        <tbody>${lista.map((f) => `<tr>
          <td>${f.descricao || "-"}</td>
          <td>${(tipo === "receber" ? f.cliente_nome : f.fornecedor_nome) || "-"}</td>
          <td>${fmt.data(f.vencimento)}</td>
          <td>${fmt.moeda(f.valor)}</td>
          <td><span class="badge badge--${tom[f.status] || ""}">${f.status}</span></td>
          <td class="text-right">
            ${f.status !== "pago" ? `<button class="icon-btn btn--sm" title="Baixar" onclick="window.__fin.baixar(${f.id}, ${f.valor})"><i class="fa-solid fa-check-double"></i></button>` : ""}
            <button class="icon-btn btn--sm" title="Excluir" onclick="window.__fin.excluir(${f.id})"><i class="fa-solid fa-trash"></i></button>
          </td></tr>`).join("")}
        </tbody></table></div>`;
    } catch (e) {
      alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
    }
  }

  function abrirForm() {
    const parceiro = tipo === "receber"
      ? `<div class="field col-2"><label>Cliente</label><select name="cliente_id"><option value="">— nenhum —</option>
          ${clientes.map((c) => `<option value="${c.id}">${c.nome}</option>`).join("")}</select></div>`
      : `<div class="field col-2"><label>Fornecedor</label><select name="fornecedor_id"><option value="">— nenhum —</option>
          ${fornecedores.map((f) => `<option value="${f.id}">${f.nome}</option>`).join("")}</select></div>`;
    Modal.abrir(`Novo lançamento — ${tipo === "receber" ? "a receber" : "a pagar"}`, `
      <div class="form-grid" id="fin-form">
        <div class="field col-2"><label>Descrição *</label><input name="descricao"></div>
        ${parceiro}
        <div class="field"><label>Valor *</label><input type="number" step="0.01" name="valor"></div>
        <div class="field"><label>Vencimento</label><input type="date" name="vencimento"></div>
        <div class="field"><label>Forma de pagamento</label><select name="forma_pagamento">
          ${FORMAS.map((f) => `<option value="${f}">${f}</option>`).join("")}</select></div>
      </div>`,
      `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
       <button class="btn btn--primary" id="fin-salvar"><i class="fa-solid fa-check"></i> Salvar</button>`);
    document.getElementById("fin-salvar").onclick = async () => {
      const f = document.getElementById("fin-form");
      const dados = {
        tipo, descricao: f.descricao.value.trim(),
        valor: parseFloat(f.valor.value) || 0,
        vencimento: f.vencimento.value || null,
        forma_pagamento: f.forma_pagamento.value,
        cliente_id: f.cliente_id ? (f.cliente_id.value || null) : null,
        fornecedor_id: f.fornecedor_id ? (f.fornecedor_id.value || null) : null,
      };
      if (!dados.descricao || !dados.valor) { toast("Informe descrição e valor", "warning"); return; }
      try { await API.post("/api/financeiro", dados); toast("Lançamento criado"); Modal.fechar(); carregar(); }
      catch (e) { toast(e.message, "error"); }
    };
  }

  window.__fin = {
    async baixar(id, valor) {
      Modal.abrir("Baixar lançamento", `
        <div class="form-grid" id="baixa-form">
          <div class="field"><label>Valor pago</label><input type="number" step="0.01" name="valor_pago" value="${valor}"></div>
          <div class="field"><label>Forma</label><select name="forma_pagamento">
            ${FORMAS.map((f) => `<option value="${f}">${f}</option>`).join("")}</select></div>
        </div>`,
        `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
         <button class="btn btn--success" id="baixa-ok"><i class="fa-solid fa-check-double"></i> Confirmar baixa</button>`);
      document.getElementById("baixa-ok").onclick = async () => {
        const f = document.getElementById("baixa-form");
        try {
          await API.post(`/api/financeiro/${id}/baixar`, {
            valor_pago: parseFloat(f.valor_pago.value) || valor,
            forma_pagamento: f.forma_pagamento.value,
          });
          toast("Baixa registrada"); Modal.fechar(); carregar();
        } catch (e) { toast(e.message, "error"); }
      };
    },
    async excluir(id) {
      if (!confirm("Excluir este lançamento?")) return;
      try { await API.del(`/api/financeiro/${id}`); toast("Excluído"); carregar(); }
      catch (e) { toast(e.message, "error"); }
    },
  };

  carregar();
})();
