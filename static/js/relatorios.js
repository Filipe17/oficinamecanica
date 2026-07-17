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
    b.onclick = () => abrir(b.dataset.rel, b.querySelector("span").textContent);
  });

  async function abrir(id, nome) {
    const box = document.getElementById("rel-box");
    box.style.display = "";
    document.getElementById("rel-titulo").textContent = nome;
    document.getElementById("rel-csv").href = `/api/relatorios/${id}/csv`;
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
