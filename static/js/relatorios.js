/* =======================================================================
   relatorios.js — Relatórios (visualização + exportação CSV)
   ======================================================================= */
(async () => {
  await Layout.iniciar("relatorios", "Relatórios");

  const RELATORIOS = [
    { id: "clientes", nome: "Clientes", icone: "fa-users" },
    { id: "veiculos", nome: "Veículos", icone: "fa-car" },
    { id: "produtos", nome: "Produtos", icone: "fa-box" },
    { id: "os", nome: "Ordens de Serviço", icone: "fa-screwdriver-wrench" },
    { id: "vendas", nome: "Vendas (PDV)", icone: "fa-cash-register" },
    { id: "financeiro", nome: "Financeiro", icone: "fa-wallet" },
    { id: "comissoes", nome: "Comissões", icone: "fa-hand-holding-dollar" },
  ];

  Layout.set(`
    <div class="page-head">
      <div><h1>Relatórios</h1><p>Visualize e exporte dados do sistema</p></div>
    </div>
    <div class="rel-cards">
      ${RELATORIOS.map((r) => `
        <button class="rel-card" data-rel="${r.id}">
          <i class="fa-solid ${r.icone}"></i><span>${r.nome}</span>
        </button>`).join("")}
    </div>
    <div class="card" id="rel-box" style="display:none"><div class="card__body">
      <div class="toolbar">
        <h3 id="rel-titulo"></h3>
        <div class="toolbar__spacer"></div>
        <a class="btn btn--ghost btn--sm" id="rel-csv" href="#"><i class="fa-solid fa-file-csv"></i> Exportar CSV</a>
      </div>
      <div id="rel-conteudo"></div>
    </div></div>
  `);

  document.querySelectorAll(".rel-card").forEach((b) => {
    b.onclick = () => {
      if (b.dataset.rel === "comissoes") return abrirComissoes();
      abrir(b.dataset.rel, b.querySelector("span").textContent);
    };
  });

  // ---- Relatório de comissões (visão dedicada, com filtro de período) ----
  function primeiroDiaMes() {
    const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  }
  function hojeISO() {
    const d = new Date(); return d.toISOString().slice(0, 10);
  }

  async function abrirComissoes() {
    const box = document.getElementById("rel-box");
    box.style.display = "";
    document.getElementById("rel-titulo").textContent = "Comissões";
    document.getElementById("rel-csv").style.display = "none";  // export próprio abaixo
    const alvo = document.getElementById("rel-conteudo");
    alvo.innerHTML = `
      <div class="toolbar" style="gap:8px;flex-wrap:wrap">
        <label>De <input type="date" id="com-inicio" value="${primeiroDiaMes()}"></label>
        <label>Até <input type="date" id="com-fim" value="${hojeISO()}"></label>
        <button class="btn btn--primary btn--sm" id="com-filtrar"><i class="fa-solid fa-magnifying-glass"></i> Filtrar</button>
      </div>
      <div id="com-resultado"><div class="loading"><i class="fa-solid fa-spinner spin"></i></div></div>`;
    document.getElementById("com-filtrar").onclick = carregarComissoes;
    carregarComissoes();
  }

  async function carregarComissoes() {
    const inicio = document.getElementById("com-inicio").value;
    const fim = document.getElementById("com-fim").value;
    const res = document.getElementById("com-resultado");
    res.innerHTML = `<div class="loading"><i class="fa-solid fa-spinner spin"></i></div>`;
    try {
      const r = await API.get(`/api/relatorios/comissoes?inicio=${inicio}&fim=${fim}`);
      const resumo = r.resumo || [], detalhe = r.detalhe || [];
      if (!resumo.length) {
        res.innerHTML = `<div class="empty"><i class="fa-solid fa-inbox"></i>Nenhuma comissão no período</div>`;
        return;
      }
      res.innerHTML = `
        <div class="stat-grid" style="margin-bottom:16px">
          <div class="stat stat--success"><div class="stat__icon"><i class="fa-solid fa-hand-holding-dollar"></i></div>
            <div class="stat__body"><div class="stat__value">${fmt.moeda(r.total_geral)}</div>
            <div class="stat__label">Total no período</div></div></div>
        </div>
        <h4>Por profissional</h4>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Profissional</th><th>Qtd. lançamentos</th><th>Total</th></tr></thead>
          <tbody>${resumo.map((x) => `<tr>
            <td>${x.profissional || "—"}</td>
            <td>${x.qtd}</td>
            <td><strong>${fmt.moeda(x.total)}</strong></td></tr>`).join("")}
          </tbody></table></div>
        <h4 style="margin-top:20px">Detalhamento</h4>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Profissional</th><th>OS</th><th>Item</th><th>Base</th><th>%</th><th>Comissão</th><th>Data</th></tr></thead>
          <tbody>${detalhe.map((d) => `<tr>
            <td>${d.profissional || "—"}</td>
            <td>${d.os_numero || d.origem_id || "-"}</td>
            <td>${d.item || "-"}</td>
            <td>${fmt.moeda(d.base_calculo)}</td>
            <td>${d.percentual}%</td>
            <td>${fmt.moeda(d.valor)}</td>
            <td>${fmt.data ? fmt.data(d.criado_em) : (d.criado_em || "").slice(0, 10)}</td></tr>`).join("")}
          </tbody></table></div>`;
    } catch (e) {
      res.innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
    }
  }

  async function abrir(id, nome) {
    const box = document.getElementById("rel-box");
    box.style.display = "";
    document.getElementById("rel-titulo").textContent = nome;
    const csv = document.getElementById("rel-csv");
    csv.style.display = "";
    csv.href = `/api/relatorios/${id}/csv`;
    const alvo = document.getElementById("rel-conteudo");
    alvo.innerHTML = `<div class="loading"><i class="fa-solid fa-spinner spin"></i></div>`;
    try {
      const r = await API.get(`/api/relatorios/${id}`);
      const lista = r.dados || [];
      if (!lista.length) { alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-inbox"></i>Sem dados</div>`; return; }
      const cols = Object.keys(lista[0]);
      alvo.innerHTML = `<p class="text-muted">${r.total} registros</p>
        <div class="table-wrap"><table class="data">
        <thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
        <tbody>${lista.map((row) => `<tr>${cols.map((c) => `<td>${row[c] ?? "-"}</td>`).join("")}</tr>`).join("")}</tbody>
        </table></div>`;
    } catch (e) {
      alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
    }
  }
})();
