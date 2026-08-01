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
    { id: "dre", nome: "DRE (Resultado)", icone: "fa-chart-pie" },
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
      if (b.dataset.rel === "dre") return abrirDRE();
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

  // ---- DRE — Demonstrativo de Resultado (competência), com filtro de período ----
  let dreAtual = null;   // guarda o último DRE gerado (para exportar em PDF)

  async function abrirDRE() {
    const box = document.getElementById("rel-box");
    box.style.display = "";
    document.getElementById("rel-titulo").textContent = "DRE — Demonstrativo de Resultado";
    document.getElementById("rel-csv").style.display = "none";
    const alvo = document.getElementById("rel-conteudo");
    alvo.innerHTML = `
      <div class="toolbar" style="gap:8px;flex-wrap:wrap">
        <label>De <input type="date" id="dre-inicio" value="${primeiroDiaMes()}"></label>
        <label>Até <input type="date" id="dre-fim" value="${hojeISO()}"></label>
        <button class="btn btn--primary btn--sm" id="dre-filtrar"><i class="fa-solid fa-magnifying-glass"></i> Gerar</button>
        <div class="toolbar__spacer"></div>
        <button class="btn btn--ghost btn--sm" id="dre-pdf"><i class="fa-solid fa-file-pdf"></i> Exportar PDF</button>
      </div>
      <div id="dre-resultado"><div class="loading"><i class="fa-solid fa-spinner spin"></i></div></div>`;
    document.getElementById("dre-filtrar").onclick = carregarDRE;
    document.getElementById("dre-pdf").onclick = exportarDREpdf;
    carregarDRE();
  }

  async function carregarDRE() {
    const inicio = document.getElementById("dre-inicio").value;
    const fim = document.getElementById("dre-fim").value;
    const res = document.getElementById("dre-resultado");
    res.innerHTML = `<div class="loading"><i class="fa-solid fa-spinner spin"></i></div>`;
    try {
      const r = await API.get(`/api/relatorios/dre?inicio=${inicio}&fim=${fim}`);
      dreAtual = { ...r, inicio, fim };
      const neg = (v) => v < 0 ? "dre-neg" : "";
      const linha = (rot, val, opts = {}) => `
        <tr class="${opts.forte ? "dre-forte" : ""} ${opts.sub ? "dre-sub" : ""}">
          <td>${opts.deducao ? "(–) " : ""}${rot}</td>
          <td class="text-right ${neg(val)}">${fmt.moeda(val)}</td></tr>`;

      const despesasHtml = r.despesas.length
        ? r.despesas.map((d) => `<tr class="dre-item">
            <td style="padding-left:22px">${d.categoria}</td>
            <td class="text-right">${fmt.moeda(d.total)}</td></tr>`).join("")
        : `<tr class="dre-item"><td style="padding-left:22px" class="text-muted">Nenhuma despesa no período</td><td></td></tr>`;

      const resultadoClasse = r.resultado >= 0 ? "dre-lucro" : "dre-prejuizo";

      res.innerHTML = `
        <div class="stat-grid" style="margin:4px 0 16px">
          <div class="stat"><div class="stat__body"><div class="stat__value">${fmt.moeda(r.receita_bruta)}</div><div class="stat__label">Receita Bruta</div></div></div>
          <div class="stat"><div class="stat__body"><div class="stat__value">${fmt.moeda(r.lucro_bruto)}</div><div class="stat__label">Lucro Bruto</div></div></div>
          <div class="stat ${r.resultado >= 0 ? "stat--success" : "stat--danger"}"><div class="stat__body"><div class="stat__value">${fmt.moeda(r.resultado)}</div><div class="stat__label">Resultado (${r.margem}%)</div></div></div>
        </div>
        <div class="table-wrap"><table class="data dre-tabela">
          <tbody>
            ${linha("Receita Bruta de Vendas", r.receita_bruta, { forte: true })}
            <tr class="dre-item"><td style="padding-left:22px" class="text-muted">Vendas (PDV)</td><td class="text-right text-muted">${fmt.moeda(r.receita_pdv)}</td></tr>
            <tr class="dre-item"><td style="padding-left:22px" class="text-muted">Ordens de Serviço</td><td class="text-right text-muted">${fmt.moeda(r.receita_os)}</td></tr>
            ${linha("Deduções (impostos sobre venda)", r.deducoes, { deducao: true })}
            ${linha("Receita Líquida", r.receita_liquida, { forte: true, sub: true })}
            ${linha("Custo das Peças/Serviços (CMV)", r.cmv, { deducao: true })}
            ${linha("Lucro Bruto", r.lucro_bruto, { forte: true, sub: true })}
            <tr class="dre-forte"><td>Despesas Operacionais</td><td class="text-right">${fmt.moeda(r.total_despesas)}</td></tr>
            ${despesasHtml}
            <tr class="dre-total ${resultadoClasse}">
              <td>Resultado Líquido do Período</td>
              <td class="text-right">${fmt.moeda(r.resultado)}</td></tr>
          </tbody></table></div>
        <p class="text-muted" style="margin-top:10px;font-size:12px">
          Receita por competência (vendas + OS finalizadas). CMV pelo preço de custo dos produtos vendidos.
          Despesas pelos lançamentos pagos no período, agrupados por categoria.</p>`;
    } catch (e) {
      dreAtual = null;
      res.innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
    }
  }

  // ---- Exportar o DRE em PDF (carrega jsPDF do CDN se ainda não estiver na página) ----
  async function carregarJsPDF() {
    if (window.jspdf && window.jspdf.jsPDF) return true;
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
    return !!(window.jspdf && window.jspdf.jsPDF);
  }

  async function exportarDREpdf() {
    if (!dreAtual) { toast("Gere o DRE antes de exportar", "warning"); return; }
    try {
      const ok = await carregarJsPDF();
      if (!ok) { toast("Não foi possível carregar o gerador de PDF", "error"); return; }
    } catch (_) { toast("Não foi possível carregar o gerador de PDF", "error"); return; }

    const d = dreAtual;
    const cfg = Layout.config || {};
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const teal = [13, 148, 136];
    const M = 16, LARG = 210 - M * 2;
    let y = 16;

    if (cfg.empresa_logo) {
      try {
        const f = cfg.empresa_logo.includes("image/png") ? "PNG" : "JPEG";
        doc.addImage(cfg.empresa_logo, f, M, y, 22, 22);
      } catch (_) {}
    }
    const xe = cfg.empresa_logo ? M + 27 : M;
    doc.setFont("helvetica", "bold").setFontSize(14).setTextColor(20);
    doc.text(cfg.empresa_nome || "Demonstrativo de Resultado", xe, y + 6);
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(90);
    let ly = y + 11;
    if (cfg.empresa_cnpj) { doc.text("CNPJ: " + cfg.empresa_cnpj, xe, ly); ly += 4; }
    (Layout.enderecoLinhas ? Layout.enderecoLinhas() : []).forEach((l) => { doc.text(l, xe, ly); ly += 4; });

    doc.setFont("helvetica", "bold").setFontSize(15).setTextColor(teal[0], teal[1], teal[2]);
    doc.text("DRE — Demonstrativo de Resultado", 210 - M, y + 6, { align: "right" });
    const per = `Período: ${fmt.data(d.inicio) || "—"} a ${fmt.data(d.fim) || "—"}`;
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(90);
    doc.text(per, 210 - M, y + 12, { align: "right" });

    y = Math.max(ly, y + 20) + 2;
    doc.setDrawColor(teal[0], teal[1], teal[2]).setLineWidth(0.5).line(M, y, 210 - M, y);
    y += 8;

    const linha = (rot, val, opts = {}) => {
      const bold = opts.forte || opts.total;
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(opts.total ? 11 : 10);
      if (opts.total) {
        const cor = val >= 0 ? [21, 128, 61] : [185, 28, 28];
        doc.setFillColor(245, 245, 245);
        doc.rect(M, y - 5, LARG, 8, "F");
        doc.setTextColor(cor[0], cor[1], cor[2]);
      } else {
        doc.setTextColor(bold ? 20 : (opts.sub2 ? 120 : 60));
      }
      const rotulo = (opts.deducao ? "(-) " : "") + rot;
      doc.text((opts.indent ? "    " : "") + rotulo, M + (opts.indent ? 4 : 0), y);
      doc.text(fmt.moeda(val), 210 - M, y, { align: "right" });
      y += opts.total ? 9 : 6.5;
    };
    const sep = () => { doc.setDrawColor(225).setLineWidth(0.2).line(M, y - 3, 210 - M, y - 3); };

    linha("Receita Bruta de Vendas", d.receita_bruta, { forte: true });
    linha("Vendas (PDV)", d.receita_pdv, { indent: true, sub2: true });
    linha("Ordens de Serviço", d.receita_os, { indent: true, sub2: true });
    linha("Deduções (impostos sobre venda)", d.deducoes, { deducao: true });
    sep(); linha("Receita Líquida", d.receita_liquida, { forte: true });
    linha("Custo das Peças/Serviços (CMV)", d.cmv, { deducao: true });
    sep(); linha("Lucro Bruto", d.lucro_bruto, { forte: true });
    linha("Despesas Operacionais", d.total_despesas, { forte: true });
    (d.despesas || []).forEach((x) => linha(x.categoria, x.total, { indent: true, sub2: true }));
    y += 2;
    linha(`Resultado Líquido do Período  (margem ${d.margem}%)`, d.resultado, { total: true });

    doc.setFont("helvetica", "italic").setFontSize(7.5).setTextColor(130);
    doc.text("Receita por competência (vendas + OS finalizadas). CMV pelo preço de compra dos produtos vendidos. "
      + "Despesas pelos lançamentos pagos no período. Documento gerencial, não contábil.",
      M, 285, { maxWidth: LARG });

    const nome = `DRE_${(d.inicio || "").replace(/-/g, "")}_${(d.fim || "").replace(/-/g, "")}.pdf`;
    doc.save(nome);
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
