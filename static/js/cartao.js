/* =======================================================================
   cartao.js — Controle de vendas no cartão: taxas configuráveis + relatório.
   (Conciliação automática com a maquininha fica para quando houver adquirente.)
   ======================================================================= */
(async () => {
  await Layout.iniciar("cartao", "Cartão / Taxas");

  const soLeitura = (Layout.permissoes?.cartao || 0) < 2
    && Layout.usuario?.perfil !== "administrador";

  const hojeISO = () => new Date().toISOString().slice(0, 10);
  const primeiroDiaMes = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; };

  let aba = "taxas";
  let taxas = [];

  Layout.set(`
    <div class="page-head">
      <div><h1>Cartão / Taxas</h1><p>Taxas da maquininha e controle das vendas no cartão</p></div>
    </div>
    <div class="tabs" id="ct-tabs">
      <button class="tab active" data-aba="taxas"><i class="fa-solid fa-percent"></i> Taxas</button>
      <button class="tab" data-aba="relatorio"><i class="fa-solid fa-chart-column"></i> Vendas no cartão</button>
    </div>
    <div id="ct-conteudo"><div class="loading"><i class="fa-solid fa-spinner spin"></i></div></div>
  `);

  document.getElementById("ct-tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tab"); if (!b) return;
    document.querySelectorAll("#ct-tabs .tab").forEach((t) => t.classList.remove("active"));
    b.classList.add("active"); aba = b.dataset.aba;
    aba === "taxas" ? renderTaxas() : renderRelatorio();
  });

  // ------------------------------------------------------------- TAXAS
  async function renderTaxas() {
    const alvo = document.getElementById("ct-conteudo");
    alvo.innerHTML = `<div class="loading"><i class="fa-solid fa-spinner spin"></i></div>`;
    try {
      const r = await API.get("/api/cartao/taxas");
      taxas = r.dados || [];
      alvo.innerHTML = `
        ${soLeitura ? "" : `<div class="toolbar" style="margin-bottom:12px"><button class="btn btn--primary btn--sm" id="ct-nova"><i class="fa-solid fa-plus"></i> Nova taxa</button></div>`}
        <div class="card"><div class="card__body">
          ${taxas.length ? `<div class="table-wrap"><table class="data">
            <thead><tr><th>Bandeira</th><th>Modalidade</th><th>Parcelas</th><th>Taxa (%)</th><th>Prazo (dias)</th><th></th></tr></thead>
            <tbody>${taxas.map((t) => `<tr>
              <td>${t.bandeira || "Todas"}</td>
              <td>${t.modalidade === "debito" ? "Débito" : "Crédito"}</td>
              <td>${t.parcelas}x</td>
              <td>${(t.percentual || 0).toFixed(2)}%</td>
              <td>${t.prazo_dias || "—"}</td>
              <td class="text-right">${soLeitura ? "" : `
                <button class="icon-btn btn--sm" onclick="window.__ct.editar(${t.id})"><i class="fa-solid fa-pen"></i></button>
                <button class="icon-btn btn--sm" onclick="window.__ct.excluir(${t.id})"><i class="fa-solid fa-trash"></i></button>`}</td>
            </tr>`).join("")}</tbody></table></div>`
          : `<div class="empty"><i class="fa-solid fa-percent"></i>Nenhuma taxa cadastrada. Cadastre as taxas da sua maquininha.</div>`}
        </div></div>`;
      if (!soLeitura) document.getElementById("ct-nova").onclick = () => formTaxa();
    } catch (e) {
      alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
    }
  }

  function formTaxa(reg) {
    const ed = !!reg;
    const v = (k, d = "") => (ed && reg[k] != null ? reg[k] : d);
    Modal.abrir(`${ed ? "Editar" : "Nova"} taxa`, `
      <div class="form-grid" id="ct-form">
        <div class="field"><label>Bandeira</label>
          <input name="bandeira" value="${v("bandeira", "Todas")}" placeholder="Todas, Visa, Master…"></div>
        <div class="field"><label>Modalidade</label>
          <select name="modalidade">
            <option value="credito" ${v("modalidade") === "credito" ? "selected" : ""}>Crédito</option>
            <option value="debito" ${v("modalidade") === "debito" ? "selected" : ""}>Débito</option>
          </select></div>
        <div class="field"><label>Parcelas</label>
          <input name="parcelas" type="number" min="1" max="24" value="${v("parcelas", 1)}"></div>
        <div class="field"><label>Taxa (%)</label>
          <input name="percentual" type="number" step="0.01" min="0" value="${v("percentual", 0)}"></div>
        <div class="field"><label>Prazo p/ receber (dias)</label>
          <input name="prazo_dias" type="number" min="0" value="${v("prazo_dias", 30)}"></div>
      </div>`,
      `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
       <button class="btn btn--primary" id="ct-salvar"><i class="fa-solid fa-check"></i> Salvar</button>`);
    document.getElementById("ct-salvar").onclick = async () => {
      const f = document.getElementById("ct-form");
      const dados = {
        bandeira: f.bandeira.value.trim() || "Todas",
        modalidade: f.modalidade.value,
        parcelas: parseInt(f.parcelas.value) || 1,
        percentual: parseFloat(f.percentual.value) || 0,
        prazo_dias: parseInt(f.prazo_dias.value) || 30,
      };
      try {
        if (ed) await API.put(`/api/cartao/taxas/${reg.id}`, dados);
        else await API.post("/api/cartao/taxas", dados);
        toast("Taxa salva"); Modal.fechar(); renderTaxas();
      } catch (e) { toast(e.message, "error"); }
    };
  }

  // --------------------------------------------------------- RELATÓRIO
  async function renderRelatorio() {
    const alvo = document.getElementById("ct-conteudo");
    alvo.innerHTML = `
      <div class="toolbar" style="gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <label>De <input type="date" id="ct-ini" value="${primeiroDiaMes()}"></label>
        <label>Até <input type="date" id="ct-fim" value="${hojeISO()}"></label>
        <button class="btn btn--primary btn--sm" id="ct-gerar"><i class="fa-solid fa-magnifying-glass"></i> Gerar</button>
      </div>
      <div id="ct-rel"><div class="loading"><i class="fa-solid fa-spinner spin"></i></div></div>`;
    document.getElementById("ct-gerar").onclick = carregarRelatorio;
    carregarRelatorio();
  }

  async function carregarRelatorio() {
    const ini = document.getElementById("ct-ini").value;
    const fim = document.getElementById("ct-fim").value;
    const res = document.getElementById("ct-rel");
    res.innerHTML = `<div class="loading"><i class="fa-solid fa-spinner spin"></i></div>`;
    try {
      const r = await API.get(`/api/cartao/relatorio?inicio=${ini}&fim=${fim}`);
      const s = r.resumo;
      res.innerHTML = `
        <div class="stat-grid" style="margin-bottom:16px">
          <div class="stat"><div class="stat__body"><div class="stat__value">${fmt.moeda(s.bruto)}</div><div class="stat__label">Bruto (${s.qtd} vendas)</div></div></div>
          <div class="stat stat--danger"><div class="stat__body"><div class="stat__value">${fmt.moeda(s.taxas)}</div><div class="stat__label">Taxas da maquininha</div></div></div>
          <div class="stat stat--success"><div class="stat__body"><div class="stat__value">${fmt.moeda(s.liquido)}</div><div class="stat__label">Líquido a receber</div></div></div>
        </div>
        ${r.por_bandeira.length ? `<div class="card" style="margin-bottom:16px"><div class="card__body">
          <h3 style="margin:0 0 10px;font-size:14px">Por bandeira</h3>
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Bandeira</th><th>Vendas</th><th>Bruto</th><th>Líquido</th></tr></thead>
            <tbody>${r.por_bandeira.map((b) => `<tr><td>${b.bandeira}</td><td>${b.qtd}</td><td>${fmt.moeda(b.bruto)}</td><td>${fmt.moeda(b.liquido)}</td></tr>`).join("")}</tbody>
          </table></div></div></div>` : ""}
        <div class="card"><div class="card__body">
          ${r.dados.length ? `<div class="table-wrap"><table class="data">
            <thead><tr><th>Data</th><th>Descrição</th><th>Bandeira</th><th>Modalidade</th><th>Bruto</th><th>Taxa</th><th>Líquido</th></tr></thead>
            <tbody>${r.dados.map((l) => `<tr>
              <td>${fmt.data(l.data)}</td>
              <td>${l.descricao || "—"}</td>
              <td>${l.cartao_bandeira || "—"}</td>
              <td>${l.cartao_modalidade === "debito" ? "Débito" : "Crédito"} ${l.cartao_parcelas || 1}x</td>
              <td>${fmt.moeda(l.valor)}</td>
              <td>${(l.cartao_taxa || 0).toFixed(2)}%</td>
              <td>${fmt.moeda(l.cartao_valor_liquido)}</td>
            </tr>`).join("")}</tbody>
          </table></div>` : `<div class="empty"><i class="fa-solid fa-credit-card"></i>Nenhuma venda no cartão no período</div>`}
        </div>`;
    } catch (e) {
      res.innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
    }
  }

  window.__ct = {
    editar(id) { const t = taxas.find((x) => x.id === id); if (t) formTaxa(t); },
    async excluir(id) {
      if (!confirm("Excluir esta taxa?")) return;
      try { await API.del(`/api/cartao/taxas/${id}`); toast("Excluída"); renderTaxas(); }
      catch (e) { toast(e.message, "error"); }
    },
  };

  renderTaxas();
})();
