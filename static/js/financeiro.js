/* =======================================================================
   financeiro.js — Contas a receber / a pagar + fluxo de caixa
   Baixa parcial + juros/multa + edição de lançamento.
   ======================================================================= */
(async () => {
  await Layout.iniciar("financeiro", "Financeiro");

  const FORMAS = ["pix", "cartao", "dinheiro", "boleto", "cheque", "carne"];

  // Categorias para a DRE. As de "pagar" separam custo x despesa operacional;
  // as de "receber" são simples. O usuário pode deixar em "— sem categoria —".
  const CATEGORIAS = {
    pagar: [
      "Custo - Peças/Mercadorias", "Custo - Serviços de terceiros",
      "Despesa - Aluguel", "Despesa - Pessoal/Salários", "Despesa - Água/Luz/Telefone",
      "Despesa - Impostos/Taxas", "Despesa - Manutenção", "Despesa - Marketing",
      "Despesa - Financeira (juros/tarifas)", "Despesa - Outras",
    ],
    receber: [
      "Receita - Serviços", "Receita - Peças/Mercadorias", "Receita - Outras",
    ],
  };
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

  // Guarda os lançamentos carregados para o form de baixa/edição consultar.
  let cache = [];

  const num = (v) => (parseFloat(v) || 0);
  const totalDevido = (f) => num(f.valor) + num(f.juros) + num(f.multa);
  const restante = (f) => Math.max(totalDevido(f) - num(f.valor_pago), 0);

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
      cache = lista;
      document.getElementById("fin-totais").innerHTML = `
        <div class="stat stat--info"><div class="stat__icon"><i class="fa-solid fa-clock"></i></div>
          <div class="stat__body"><div class="stat__value">${fmt.moeda(t.aberto)}</div><div class="stat__label">Em aberto</div></div></div>
        <div class="stat stat--success"><div class="stat__icon"><i class="fa-solid fa-circle-check"></i></div>
          <div class="stat__body"><div class="stat__value">${fmt.moeda(t.pago)}</div><div class="stat__label">Baixado</div></div></div>
        <div class="stat stat--danger"><div class="stat__icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
          <div class="stat__body"><div class="stat__value">${fmt.moeda(t.atrasado)}</div><div class="stat__label">Atrasado</div></div></div>`;

      if (!lista.length) { alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-inbox"></i>Nenhum lançamento</div>`; return; }
      const tom = { aberto: "info", parcial: "warning", pago: "success", atrasado: "danger" };
      const rotulo = { aberto: "aberto", parcial: "parcial", pago: "pago", atrasado: "atrasado" };
      alvo.innerHTML = `<div class="table-wrap"><table class="data">
        <thead><tr><th>Descrição</th><th>${tipo === "receber" ? "Cliente" : "Fornecedor"}</th>
          <th>Categoria</th><th>Vencimento</th><th>Valor</th><th>Pago</th><th>Status</th><th></th></tr></thead>
        <tbody>${lista.map((f) => {
          const temEncargo = num(f.juros) + num(f.multa) > 0;
          const rest = restante(f);
          return `<tr>
          <td>${f.descricao || "-"}</td>
          <td>${(tipo === "receber" ? f.cliente_nome : f.fornecedor_nome) || "-"}</td>
          <td>${f.categoria ? `<span class="badge badge--info">${f.categoria}</span>` : `<small class="muted">—</small>`}</td>
          <td>${fmt.data(f.vencimento)}</td>
          <td>${fmt.moeda(f.valor)}${temEncargo ? ` <i class="fa-solid fa-plus-circle" title="+ ${fmt.moeda(num(f.juros)+num(f.multa))} juros/multa"></i>` : ""}</td>
          <td>${num(f.valor_pago) ? fmt.moeda(f.valor_pago) : "-"}${f.status === "parcial" ? ` <small class="muted">(falta ${fmt.moeda(rest)})</small>` : ""}</td>
          <td><span class="badge badge--${tom[f.status] || ""}">${rotulo[f.status] || f.status}</span></td>
          <td class="text-right">
            ${f.status !== "pago" ? `<button class="icon-btn btn--sm" title="Baixar" onclick="window.__fin.baixar(${f.id})"><i class="fa-solid fa-check-double"></i></button>` : ""}
            ${tipo === "receber" && f.status !== "pago" ? (f.boleto_url
              ? `<a class="icon-btn btn--sm" title="Ver boleto" href="${f.boleto_url}" target="_blank"><i class="fa-solid fa-barcode"></i></a>`
              : `<button class="icon-btn btn--sm" title="Gerar boleto" onclick="window.__fin.boleto(${f.id})"><i class="fa-solid fa-barcode"></i></button>`) : ""}
            ${f.status !== "pago" ? `<button class="icon-btn btn--sm" title="Editar" onclick="window.__fin.editar(${f.id})"><i class="fa-solid fa-pen"></i></button>` : ""}
            <button class="icon-btn btn--sm" title="Excluir" onclick="window.__fin.excluir(${f.id})"><i class="fa-solid fa-trash"></i></button>
          </td></tr>`;
        }).join("")}
        </tbody></table></div>`;
    } catch (e) {
      alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
    }
  }

  // Form de criar/editar. Se "reg" vier preenchido, é edição.
  function abrirForm(reg) {
    const ed = !!reg;
    const val = (k, d = "") => (ed && reg[k] != null ? reg[k] : d);
    const parceiro = tipo === "receber"
      ? `<div class="field col-2"><label>Cliente</label><select name="cliente_id"><option value="">— nenhum —</option>
          ${clientes.map((c) => `<option value="${c.id}" ${String(val("cliente_id")) === String(c.id) ? "selected" : ""}>${c.nome}</option>`).join("")}</select></div>`
      : `<div class="field col-2"><label>Fornecedor</label><select name="fornecedor_id"><option value="">— nenhum —</option>
          ${fornecedores.map((f) => `<option value="${f.id}" ${String(val("fornecedor_id")) === String(f.id) ? "selected" : ""}>${f.nome}</option>`).join("")}</select></div>`;
    Modal.abrir(`${ed ? "Editar" : "Novo"} lançamento — ${tipo === "receber" ? "a receber" : "a pagar"}`, `
      <div class="form-grid" id="fin-form">
        <div class="field col-2"><label>Descrição *</label><input name="descricao" value="${val("descricao")}"></div>
        ${parceiro}
        <div class="field"><label>Valor *</label><input type="number" step="0.01" name="valor" value="${val("valor")}"></div>
        <div class="field"><label>Vencimento</label><input type="date" name="vencimento" value="${val("vencimento") ? String(val("vencimento")).slice(0,10) : ""}"></div>
        <div class="field"><label>Juros (R$)</label><input type="number" step="0.01" name="juros" value="${val("juros", 0)}"></div>
        <div class="field"><label>Multa (R$)</label><input type="number" step="0.01" name="multa" value="${val("multa", 0)}"></div>
        <div class="field"><label>Forma de pagamento</label><select name="forma_pagamento">
          ${FORMAS.map((f) => `<option value="${f}" ${val("forma_pagamento") === f ? "selected" : ""}>${f}</option>`).join("")}</select></div>
        <div class="field"><label>Categoria (DRE)</label><select name="categoria">
          <option value="">— sem categoria —</option>
          ${(CATEGORIAS[tipo] || []).map((c) => `<option value="${c}" ${val("categoria") === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
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
        categoria: f.categoria.value || null,
        juros: parseFloat(f.juros.value) || 0,
        multa: parseFloat(f.multa.value) || 0,
        cliente_id: f.cliente_id ? (f.cliente_id.value || null) : null,
        fornecedor_id: f.fornecedor_id ? (f.fornecedor_id.value || null) : null,
      };
      if (!dados.descricao || !dados.valor) { toast("Informe descrição e valor", "warning"); return; }
      try {
        if (ed) { await API.put(`/api/financeiro/${reg.id}`, dados); toast("Lançamento atualizado"); }
        else { await API.post("/api/financeiro", dados); toast("Lançamento criado"); }
        Modal.fechar(); carregar();
      } catch (e) { toast(e.message, "error"); }
    };
  }

  window.__fin = {
    async baixar(id) {
      const f = cache.find((x) => x.id === id);
      if (!f) return;
      const devido = totalDevido(f);
      const rest = restante(f);
      const encargo = num(f.juros) + num(f.multa);
      Modal.abrir("Baixar lançamento", `
        <div class="form-grid" id="baixa-form">
          <div class="field col-2">
            <div class="baixa-resumo">
              <div>Valor: <strong>${fmt.moeda(f.valor)}</strong></div>
              ${encargo > 0 ? `<div>Juros + multa: <strong>${fmt.moeda(encargo)}</strong></div>` : ""}
              <div>Total devido: <strong>${fmt.moeda(devido)}</strong></div>
              ${num(f.valor_pago) ? `<div>Já pago: <strong>${fmt.moeda(f.valor_pago)}</strong></div>` : ""}
              <div>Restante: <strong>${fmt.moeda(rest)}</strong></div>
            </div>
          </div>
          <div class="field"><label>Valor a pagar agora</label><input type="number" step="0.01" name="valor_pago" value="${rest.toFixed(2)}"></div>
          <div class="field"><label>Forma</label><select name="forma_pagamento">
            ${FORMAS.map((x) => `<option value="${x}" ${f.forma_pagamento === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
          <div class="field col-2"><small class="muted">Pagar menos que o restante registra baixa parcial; o saldo continua em aberto.</small></div>
        </div>`,
        `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
         <button class="btn btn--success" id="baixa-ok"><i class="fa-solid fa-check-double"></i> Confirmar baixa</button>`);
      document.getElementById("baixa-ok").onclick = async () => {
        const form = document.getElementById("baixa-form");
        const vp = parseFloat(form.valor_pago.value) || rest;
        try {
          const r = await API.post(`/api/financeiro/${id}/baixar`, {
            valor_pago: vp,
            forma_pagamento: form.forma_pagamento.value,
          });
          toast(r.status === "parcial"
            ? `Baixa parcial — restam ${fmt.moeda(r.restante)}`
            : "Lançamento quitado");
          Modal.fechar(); carregar();
        } catch (e) { toast(e.message, "error"); }
      };
    },
    editar(id) {
      const f = cache.find((x) => x.id === id);
      if (f) abrirForm(f);
    },
    async boleto(id) {
      if (!confirm("Gerar boleto para esta conta a receber?")) return;
      try {
        const r = await API.post(`/api/boletos/gerar/${id}`, {});
        if (r.status === "nao_configurado") { toast(r.mensagem || "Provedor de boleto não configurado", "warning"); return; }
        if (r.ok) {
          toast("Boleto gerado");
          if (r.boleto_url) window.open(r.boleto_url, "_blank");
          carregar();
        } else {
          toast(r.mensagem || "Não foi possível gerar o boleto", "error");
        }
      } catch (e) { toast(e.message, "error"); }
    },
    async excluir(id) {
      if (!confirm("Excluir este lançamento?")) return;
      try { await API.del(`/api/financeiro/${id}`); toast("Excluído"); carregar(); }
      catch (e) { toast(e.message, "error"); }
    },
  };

  carregar();
})();
