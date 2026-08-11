/* =======================================================================
   dashboard.js — Painel principal
   -----------------------------------------------------------------------
   Consome /api/dashboard (cards) e /api/dashboard/graficos (séries) e
   /api/financeiro/fluxo (fluxo de caixa). Desenha os gráficos com Chart.js.
   ======================================================================= */
(async () => {
  await Layout.iniciar("dashboard", "Dashboard");

  // ---- Definição visual dos cards (na ordem do ERP) ----
  const CARDS = [
    { chave: "os_abertas",          rotulo: "OS abertas",          icone: "fa-folder-open",        tom: "info" },
    { chave: "os_finalizadas",      rotulo: "OS finalizadas",      icone: "fa-circle-check",       tom: "success" },
    { chave: "veiculos_manutencao", rotulo: "Em manutenção",       icone: "fa-car-on",             tom: "warning" },
    { chave: "orcamentos_pendentes",rotulo: "Orçamentos",          icone: "fa-file-invoice-dollar",tom: "info" },
    { chave: "clientes",            rotulo: "Clientes",            icone: "fa-users",              tom: "" },
    { chave: "veiculos",            rotulo: "Veículos",            icone: "fa-car",                tom: "" },
    { chave: "produtos",            rotulo: "Produtos",            icone: "fa-box",                tom: "" },
    { chave: "servicos_realizados", rotulo: "Serviços realizados", icone: "fa-screwdriver-wrench", tom: "" },
    { chave: "receita_mes",         rotulo: "Receita do mês",      icone: "fa-arrow-trend-up",     tom: "success", moeda: true },
    { chave: "despesa_mes",         rotulo: "Despesa do mês",      icone: "fa-arrow-trend-down",   tom: "danger",  moeda: true },
    { chave: "lucro_mes",           rotulo: "Lucro",               icone: "fa-sack-dollar",        tom: "success", moeda: true },
    { chave: "contas_receber",      rotulo: "Contas a receber",    icone: "fa-hand-holding-dollar",tom: "info",    moeda: true },
    { chave: "contas_pagar",        rotulo: "Contas a pagar",      icone: "fa-file-invoice",       tom: "warning", moeda: true },
    { chave: "cobrancas_atraso",    rotulo: "Cobranças em atraso", icone: "fa-triangle-exclamation",tom: "danger" },
    { chave: "itens_estoque",       rotulo: "Itens em estoque",    icone: "fa-warehouse",          tom: "" },
    { chave: "itens_criticos",      rotulo: "Itens críticos",      icone: "fa-bell",               tom: "danger" },
    { chave: "pdv_dia",             rotulo: "PDV — vendas do dia", icone: "fa-cash-register",      tom: "success", moeda: true },
  ];

  // ---- Casca da página (cards + área de gráficos) ----
  Layout.set(`
    <div class="page-head">
      <div><h1>Visão geral</h1><p>Resumo operacional e financeiro da oficina</p></div>
      <button class="btn btn--ghost" onclick="location.reload()"><i class="fa-solid fa-rotate"></i> Atualizar</button>
    </div>
    <div class="stat-grid" id="cards">
      ${CARDS.map(() => `<div class="stat stat--skel"></div>`).join("")}
    </div>

    <div class="dash-charts">
      <div class="card"><div class="card__head">Fluxo de caixa</div><div class="card__body"><canvas id="g-fluxo" height="120"></canvas></div></div>
      <div class="card"><div class="card__head">Ordens por status</div><div class="card__body"><canvas id="g-status" height="120"></canvas></div></div>
      <div class="card"><div class="card__head">Faturamento por mês</div><div class="card__body"><canvas id="g-fat" height="120"></canvas></div></div>
      <div class="card"><div class="card__head">Serviços mais vendidos</div><div class="card__body"><canvas id="g-serv" height="120"></canvas></div></div>
      <div class="card"><div class="card__head">Produtos mais vendidos</div><div class="card__body"><canvas id="g-prod" height="120"></canvas></div></div>
      <div class="card"><div class="card__head">Movimentação de estoque</div><div class="card__body"><canvas id="g-est" height="120"></canvas></div></div>
    </div>
  `);

  // ---- Cards ----
  try {
    const { cards } = await API.get("/api/dashboard");
    document.getElementById("cards").innerHTML = CARDS.map((c) => {
      const bruto = cards[c.chave] ?? 0;
      const valor = c.moeda ? fmt.moeda(bruto) : bruto;
      return `
        <div class="stat ${c.tom ? "stat--" + c.tom : ""}">
          <div class="stat__icon"><i class="fa-solid ${c.icone}"></i></div>
          <div class="stat__body">
            <div class="stat__value">${valor}</div>
            <div class="stat__label">${c.rotulo}</div>
          </div>
        </div>`;
    }).join("");
  } catch (e) {
    toast("Falha ao carregar indicadores: " + e.message, "error");
  }

  // ---- Gráficos ----
  const escuro = document.documentElement.getAttribute("data-theme") === "dark";
  Chart.defaults.color = escuro ? "#9fb0c0" : "#5b6b7b";
  Chart.defaults.font.family = "system-ui, Inter, sans-serif";
  const PAL = ["#0e7c86", "#f59e0b", "#2563eb", "#16a34a", "#dc2626", "#7c3aed", "#0891b2", "#ea580c"];
  const grid = escuro ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.06)";

  const semDados = (id) => {
    const c = document.getElementById(id);
    if (c) c.parentElement.innerHTML = `<div class="empty"><i class="fa-solid fa-chart-simple"></i>Sem dados ainda</div>`;
  };

  try {
    const g = await API.get("/api/dashboard/graficos");

    // Ordens por status (rosca)
    if (g.os_status && g.os_status.length) {
      new Chart(document.getElementById("g-status"), {
        type: "doughnut",
        data: { labels: g.os_status.map((r) => r.status),
          datasets: [{ data: g.os_status.map((r) => r.total), backgroundColor: PAL }] },
        options: { plugins: { legend: { position: "right" } } },
      });
    } else semDados("g-status");

    // Faturamento por mês (barras)
    if (g.faturamento && g.faturamento.length) {
      new Chart(document.getElementById("g-fat"), {
        type: "bar",
        data: { labels: g.faturamento.map((r) => r.mes),
          datasets: [{ label: "Faturamento", data: g.faturamento.map((r) => r.total), backgroundColor: PAL[0] }] },
        options: { scales: { y: { grid: { color: grid } }, x: { grid: { display: false } } }, plugins: { legend: { display: false } } },
      });
    } else semDados("g-fat");

    // Serviços mais vendidos (barras horizontais)
    if (g.servicos_top && g.servicos_top.length) {
      new Chart(document.getElementById("g-serv"), {
        type: "bar",
        data: { labels: g.servicos_top.map((r) => r.descricao),
          datasets: [{ label: "Qtd", data: g.servicos_top.map((r) => r.qtd), backgroundColor: PAL[1] }] },
        options: { indexAxis: "y", scales: { x: { grid: { color: grid } }, y: { grid: { display: false } } }, plugins: { legend: { display: false } } },
      });
    } else semDados("g-serv");

    // Produtos mais vendidos (barras horizontais)
    if (g.produtos_top && g.produtos_top.length) {
      new Chart(document.getElementById("g-prod"), {
        type: "bar",
        data: { labels: g.produtos_top.map((r) => r.descricao),
          datasets: [{ label: "Qtd", data: g.produtos_top.map((r) => r.qtd), backgroundColor: PAL[2] }] },
        options: { indexAxis: "y", scales: { x: { grid: { color: grid } }, y: { grid: { display: false } } }, plugins: { legend: { display: false } } },
      });
    } else semDados("g-prod");

    // Movimentação de estoque (pizza)
    if (g.estoque_mov && g.estoque_mov.length) {
      new Chart(document.getElementById("g-est"), {
        type: "pie",
        data: { labels: g.estoque_mov.map((r) => r.tipo),
          datasets: [{ data: g.estoque_mov.map((r) => r.total), backgroundColor: PAL }] },
        options: { plugins: { legend: { position: "right" } } },
      });
    } else semDados("g-est");
  } catch (e) {
    ["g-status", "g-fat", "g-serv", "g-prod", "g-est"].forEach(semDados);
  }

  // Fluxo de caixa (linha) — o endpoint devolve arrays separados por dia
  try {
    const f = await API.get("/api/financeiro/fluxo");
    // Unifica os dias das três séries e monta um eixo comum.
    const mapa = (arr) => Object.fromEntries((arr || []).map((r) => [r.dia, r.total || 0]));
    const mEnt = mapa(f.entradas), mSai = mapa(f.saidas), mVen = mapa(f.vendas);
    const dias = [...new Set([...Object.keys(mEnt), ...Object.keys(mSai), ...Object.keys(mVen)])]
      .filter(Boolean).sort();
    if (dias.length) {
      new Chart(document.getElementById("g-fluxo"), {
        type: "line",
        data: {
          labels: dias.map((d) => fmt.data(d)),
          datasets: [
            { label: "Entradas", data: dias.map((d) => (mEnt[d] || 0) + (mVen[d] || 0)), borderColor: PAL[3], backgroundColor: "transparent", tension: .3 },
            { label: "Saídas",   data: dias.map((d) => mSai[d] || 0), borderColor: PAL[4], backgroundColor: "transparent", tension: .3 },
          ],
        },
        options: { scales: { y: { grid: { color: grid } }, x: { grid: { display: false } } } },
      });
    } else semDados("g-fluxo");
  } catch (_) { semDados("g-fluxo"); }

  // Card de aniversariantes
  try {
    const r = await API.get("/api/clientes/aniversariantes?dias=7");
    const lista = r.dados || [];
    if (lista.length) {
      const cfg = Layout.config || {};
      const empresa = cfg.empresa_nome || "Oficina";
      const hoje = lista.filter((c) => c.dias_para_aniversario === 0);
      const proximos = lista.filter((c) => c.dias_para_aniversario > 0);

      const renderLinha = (c) => {
        const zap = c.whatsapp || c.telefone;
        const msgWpp = encodeURIComponent(
          `Olá ${c.nome.split(" ")[0]}! 🎂 Feliz Aniversário! A equipe da ${empresa} deseja muita saúde e alegria nesse dia especial! 🎉`
        );
        return `<div style="display:flex;justify-content:space-between;align-items:center;
          padding:.45rem 0;border-bottom:1px solid var(--border,#eee)">
          <div>
            <span style="font-size:1rem">${c.dias_para_aniversario === 0 ? "🎂" : "🎁"}</span>
            <strong style="margin-left:4px">${c.nome}</strong>
            <span style="font-size:.75rem;color:var(--text-muted);margin-left:6px">
              ${c.idade} anos${c.dias_para_aniversario > 0 ? ` · em ${c.dias_para_aniversario} dia(s)` : " · HOJE!"}
            </span>
          </div>
          <div style="display:flex;gap:.3rem">
            ${zap ? `<a class="icon-btn btn--sm" href="https://wa.me/55${String(zap).replace(/\D/g,"")}?text=${msgWpp}" target="_blank">
              <i class="fa-brands fa-whatsapp" style="color:#25d366"></i></a>` : ""}
            ${c.email ? `<button class="icon-btn btn--sm"
              onclick="window.__dashEnviarParabens(${c.id},'${c.email}','${c.nome.split(' ')[0]}')">
              <i class="fa-solid fa-envelope"></i></button>` : ""}
          </div>
        </div>`;
      };

      const card = document.createElement("div");
      card.className = "card";
      card.style.cssText = "border-left:4px solid #f59e0b;margin-bottom:1rem";
      card.innerHTML = `
        <div class="card__head" style="display:flex;align-items:center;gap:.5rem">
          <i class="fa-solid fa-cake-candles" style="color:#f59e0b"></i>
          Aniversariantes
          ${hoje.length ? `<span class="badge badge--warning" style="margin-left:auto">${hoje.length} hoje</span>` : ""}
        </div>
        <div class="card__body">
          ${hoje.length ? `<p style="font-size:.78rem;font-weight:700;color:#f59e0b;margin-bottom:.25rem">HOJE</p>${hoje.map(renderLinha).join("")}` : ""}
          ${proximos.length ? `<p style="font-size:.78rem;font-weight:700;color:var(--text-muted);margin:.6rem 0 .25rem">PRÓXIMOS 7 DIAS</p>${proximos.map(renderLinha).join("")}` : ""}
        </div>`;

      // Insere antes do primeiro card de gráfico
      const grids = document.querySelectorAll(".card");
      if (grids.length) grids[0].parentElement.insertBefore(card, grids[0]);

      window.__dashEnviarParabens = async (cid, email, nome) => {
        if (!confirm(`Enviar email de parabéns para ${nome}?`)) return;
        try {
          await API.post(`/api/clientes/${cid}/parabens`, { email });
          toast(`🎂 Email enviado para ${nome}!`);
        } catch(e) { toast(e.message, "error"); }
      };
    }
  } catch(_) {}

})();
