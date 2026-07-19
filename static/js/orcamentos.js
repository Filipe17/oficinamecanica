/* =======================================================================
   orcamentos.js — Orçamentos em PÁGINA INTEIRA (estilo documento).
   Lista + editor completo: cabeçalho da empresa, dados do cliente/veículo,
   tabela de produtos/serviços, condições de pagamento e totais.
   Usa o mesmo backend da OS (/api/os com eh_orcamento=1).
   ======================================================================= */
(async () => {
  await Layout.iniciar("orcamentos", "Orçamentos");

  const soLeitura = Layout.usuario?.perfil !== "administrador"
                 && (Layout.permissoes?.orcamentos ?? 2) < 2;
  const cfg = Layout.config || {};

  let clientes = [], veiculos = [], produtos = [], servicos = [];
  let itens = [];         // itens do orçamento em edição
  let editando = null;    // registro em edição (null = novo)

  const FORMAS = ["Dinheiro", "Pix", "Cartão de Crédito", "Cartão de Débito", "Boleto", "Transferência"];

  const money = (v) => "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = (s) => (s == null ? "" : String(s).replace(/"/g, "&quot;"));

  await carregarRefs();
  renderLista();

  async function carregarRefs() {
    const [rc, rv, rp, rs] = await Promise.allSettled([
      API.get("/api/clientes?por_pagina=1000&ordem=nome"),
      API.get("/api/veiculos?por_pagina=1000"),
      API.get("/api/produtos?por_pagina=1000&ordem=nome"),
      API.get("/api/servicos"),
    ]);
    const ok = (r) => (r.status === "fulfilled" ? r.value : {});
    clientes = ok(rc).dados || [];
    veiculos = ok(rv).dados || [];
    produtos = ok(rp).dados || [];
    servicos = ok(rs).dados || [];
  }

  /* ------------------------------------------------------------------ LISTA */
  async function renderLista() {
    editando = null;
    let lista = [];
    try { lista = (await API.get("/api/os?orcamento=1")).dados || []; } catch (_) {}

    Layout.set(`
      <div class="page-head">
        <div><h1>Orçamentos</h1><p>Crie e gerencie orçamentos para seus clientes</p></div>
        ${soLeitura ? "" : `<button class="btn btn--primary" id="orc-novo"><i class="fa-solid fa-plus"></i> Novo orçamento</button>`}
      </div>
      <div class="card"><div class="card__body">
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Número</th><th>Cliente</th><th>Veículo</th><th>Data</th><th>Total</th><th></th></tr></thead>
          <tbody>
            ${lista.length ? lista.map((o) => `<tr>
              <td><b>${o.numero || "-"}</b></td>
              <td>${o.cliente_nome || "-"}</td>
              <td>${o.veiculo_placa || o.veiculo_modelo || "-"}</td>
              <td>${fmt.data(o.data || o.criado_em)}</td>
              <td>${money(o.total)}</td>
              <td class="text-right">
                <button class="icon-btn btn--sm" title="Abrir" onclick="window.__orc.abrir(${o.id})"><i class="fa-solid fa-eye"></i></button>
                ${soLeitura ? "" : `<button class="icon-btn btn--sm" title="Excluir" onclick="window.__orc.excluir(${o.id})"><i class="fa-solid fa-trash"></i></button>`}
              </td></tr>`).join("") : `<tr><td colspan="6" class="text-center text-muted" style="padding:30px">Nenhum orçamento ainda.</td></tr>`}
          </tbody>
        </table></div>
      </div></div>
    `);
    window.__orc = api;
    const bn = document.getElementById("orc-novo");
    if (bn) bn.onclick = () => abrirEditor(null);
  }

  /* ----------------------------------------------------------------- EDITOR */
  async function abrirEditor(id) {
    let orc = null;
    if (id) { try { orc = await API.get(`/api/os/${id}`); } catch (_) {} }
    editando = orc;
    itens = (orc?.itens || []).map((it) => ({
      tipo: it.tipo || "produto", referencia_id: it.referencia_id || null,
      codigo: it.codigo || "", descricao: it.descricao || "",
      unidade: it.unidade || "UN", quantidade: Number(it.quantidade) || 1,
      valor_unitario: Number(it.valor_unitario) || 0, desconto: Number(it.desconto) || 0,
    }));

    const cli = orc ? clientes.find((c) => c.id === orc.cliente_id) : null;

    Layout.set(`
      <div class="orc">
        <div class="orc-topbar">
          <button class="orc-voltar" id="orc-voltar"><i class="fa-solid fa-arrow-left"></i></button>
          <h1>Orçamento</h1>
          <div class="orc-topbar__acoes">
            ${editando ? `<button class="btn btn--ghost" id="orc-imprimir"><i class="fa-solid fa-print"></i> Imprimir</button>
            <button class="btn btn--ghost" id="orc-pdf"><i class="fa-solid fa-file-pdf"></i> Gerar PDF</button>
            <button class="btn btn--zap" id="orc-whats"><i class="fa-brands fa-whatsapp"></i> Enviar WhatsApp</button>` : ""}
          </div>
        </div>

        <!-- Cabeçalho da empresa / documento -->
        <div class="orc-doc-head">
          <div class="orc-empresa">
            ${cfg.empresa_logo ? `<img src="${cfg.empresa_logo}" alt="logo">` : `<div class="orc-empresa__semlogo"><i class="fa-solid fa-gear"></i></div>`}
            <div>
              <div class="orc-empresa__nome">${cfg.empresa_nome || "Sua Empresa"}</div>
              <div class="orc-empresa__linha">${cfg.empresa_cnpj ? "CNPJ: " + cfg.empresa_cnpj : ""}</div>
              <div class="orc-empresa__linha">${cfg.empresa_telefone ? "<i class='fa-solid fa-phone'></i> " + cfg.empresa_telefone : ""}</div>
              ${Layout.enderecoLinhas().map((l) => `<div class="orc-empresa__linha"><i class='fa-solid fa-location-dot'></i> ${l}</div>`).join("")}
            </div>
          </div>
          <div class="orc-doc-meta">
            <div class="orc-doc-titulo">ORÇAMENTO</div>
            <div class="orc-doc-num">Nº ${orc?.numero || "novo"}</div>
            <div class="orc-doc-info"><i class="fa-solid fa-calendar"></i> Data: ${fmt.data(orc?.data || new Date().toISOString())}</div>
            <div class="orc-doc-info"><i class="fa-solid fa-clock"></i> Validade:
              <input id="orc-validade" class="orc-mini" value="${esc(orc?.validade || "10 dias")}"></div>
          </div>
        </div>

        <!-- Cliente/veículo -->
        <div class="orc-secao">
          <div class="orc-secao__titulo"><i class="fa-solid fa-user"></i> Dados do Cliente e Veículo</div>
          <div class="orc-cv">
            <label class="orc-campo"><span>Cliente</span>
              <select id="orc-cliente">${clientes.map((c) => `<option value="${c.id}" ${cli && cli.id === c.id ? "selected" : ""}>${c.nome}</option>`).join("")}</select>
            </label>
            <label class="orc-campo"><span>Veículo</span>
              <select id="orc-veiculo"></select>
            </label>
            <div class="orc-campo"><span>Telefone</span><div id="d-tel" class="orc-val">—</div></div>
            <div class="orc-campo"><span>Placa</span><div id="d-placa" class="orc-val">—</div></div>
            <div class="orc-campo"><span>E-mail</span><div id="d-email" class="orc-val">—</div></div>
            <div class="orc-campo"><span>KM</span><div id="d-km" class="orc-val">—</div></div>
            <div class="orc-campo"><span>CPF/CNPJ</span><div id="d-doc" class="orc-val">—</div></div>
            <div class="orc-campo"><span>Ano/Modelo</span><div id="d-ano" class="orc-val">—</div></div>
            <div class="orc-campo"><span>Combustível</span><div id="d-comb" class="orc-val">—</div></div>
          </div>
        </div>

        <!-- Produtos / serviços -->
        <div class="orc-secao">
          <div class="orc-secao__head">
            <div class="orc-secao__titulo"><i class="fa-solid fa-cart-shopping"></i> Produtos / Serviços</div>
            ${soLeitura ? "" : `<div class="orc-secao__acoes">
              <button class="btn btn--primary btn--sm" id="orc-add"><i class="fa-solid fa-plus"></i> Adicionar</button>
              <button class="btn btn--ghost btn--sm" id="orc-buscar"><i class="fa-solid fa-magnifying-glass"></i> Buscar produto</button>
            </div>`}
          </div>
          <div class="table-wrap"><table class="orc-itens">
            <thead><tr>
              <th>Item</th><th>Código</th><th>Descrição</th><th>Qtd</th><th>Un</th>
              <th>Valor Unit.</th><th>Desc.</th><th>Total</th><th></th>
            </tr></thead>
            <tbody id="orc-tbody"></tbody>
          </table></div>
        </div>

        <!-- Pagamento / observações finais / totais -->
        <div class="orc-grid-final">
          <div class="orc-secao">
            <div class="orc-secao__titulo"><i class="fa-solid fa-dollar-sign"></i> Condições de Pagamento</div>
            <label class="orc-campo"><span>Forma de pagamento</span>
              <select id="orc-forma">${FORMAS.map((f) => `<option ${orc?.forma_pagamento === f ? "selected" : ""}>${f}</option>`).join("")}</select>
            </label>
            <label class="orc-campo"><span>Condições</span>
              <input id="orc-cond" value="${esc(orc?.condicoes || "À vista")}"></label>
            <div class="orc-secao__titulo" style="margin-top:14px"><i class="fa-solid fa-note-sticky"></i> Observações finais</div>
            <textarea id="orc-obsf" class="orc-obs" placeholder="Ex: Este orçamento tem validade de 10 dias.">${esc(orc?.obs_finais || "")}</textarea>
          </div>
          <div class="orc-totais">
            <div class="orc-totais__linha"><span>Subtotal</span><b id="t-sub">R$ 0,00</b></div>
            <div class="orc-totais__linha"><span>Desconto</span>
              <input id="orc-desc" class="orc-mini" type="number" step="0.01" value="${Number(orc?.desconto) || 0}"></div>
            <div class="orc-totais__total"><span>Total do Orçamento</span><b id="t-total">R$ 0,00</b></div>
          </div>
        </div>

        <div class="orc-rodape-acoes">
          ${soLeitura ? "" : (editando
            ? `<button class="btn btn--success" id="orc-salvar"><i class="fa-solid fa-flag-checkered"></i> Finalizar orçamento</button>
               <button class="btn btn--ghost" id="orc-limpar"><i class="fa-solid fa-broom"></i> Limpar</button>`
            : `<button class="btn btn--success" id="orc-salvar"><i class="fa-solid fa-floppy-disk"></i> Salvar orçamento</button>`)}
          <button class="btn btn--danger-ghost" id="orc-cancelar"><i class="fa-solid fa-xmark"></i> ${soLeitura ? "Voltar" : "Cancelar"}</button>
        </div>
      </div>
    `);

    window.__orc = api;
    wireEditor();
    preencherVeiculos(orc?.veiculo_id);
    preencherCliente();
    renderItens();
    recalc();
    if (soLeitura) document.querySelectorAll(".orc input, .orc select, .orc textarea").forEach((el) => el.disabled = true);
  }

  function wireEditor() {
    const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
    on("orc-voltar", "click", renderLista);
    on("orc-cancelar", "click", renderLista);
    on("orc-cliente", "change", () => { preencherVeiculos(); preencherCliente(); });
    on("orc-veiculo", "change", preencherVeiculoDados);
    on("orc-add", "click", () => { itens.push({ tipo: "produto", referencia_id: null, codigo: "", descricao: "", unidade: "UN", quantidade: 1, valor_unitario: 0, desconto: 0 }); renderItens(); recalc(); });
    on("orc-buscar", "click", abrirBusca);
    on("orc-desc", "input", recalc);
    on("orc-salvar", "click", salvar);
    on("orc-limpar", "click", () => abrirEditor(null));
    on("orc-imprimir", "click", imprimir);
    on("orc-pdf", "click", gerarPDF);
    on("orc-whats", "click", enviarWhats);
  }

  function preencherCliente() {
    const id = Number(document.getElementById("orc-cliente")?.value);
    const c = clientes.find((x) => x.id === id) || {};
    document.getElementById("d-tel").textContent = c.telefone || c.whatsapp || "—";
    document.getElementById("d-email").textContent = c.email || "—";
    document.getElementById("d-doc").textContent = c.cpf_cnpj || "—";
  }

  function preencherVeiculos(selecionado) {
    const cid = Number(document.getElementById("orc-cliente")?.value);
    const sel = document.getElementById("orc-veiculo");
    if (!sel) return;
    const doCliente = veiculos.filter((v) => v.cliente_id === cid);
    sel.innerHTML = `<option value="">— selecione —</option>` +
      doCliente.map((v) => `<option value="${v.id}" ${selecionado === v.id ? "selected" : ""}>${[v.marca, v.modelo, v.placa].filter(Boolean).join(" ")}</option>`).join("");
    preencherVeiculoDados();
  }

  function preencherVeiculoDados() {
    const id = Number(document.getElementById("orc-veiculo")?.value);
    const v = veiculos.find((x) => x.id === id) || {};
    document.getElementById("d-placa").textContent = v.placa || "—";
    document.getElementById("d-km").textContent = v.quilometragem != null && v.placa ? Number(v.quilometragem).toLocaleString("pt-BR") : "—";
    document.getElementById("d-ano").textContent = [v.marca, v.modelo].filter(Boolean).join(" ") + (v.ano ? " " + v.ano : "") || "—";
    document.getElementById("d-comb").textContent = v.combustivel || "—";
  }

  /* --------------------------------------------------------- itens (tabela) */
  function renderItens() {
    const tb = document.getElementById("orc-tbody");
    if (!tb) return;
    if (!itens.length) {
      tb.innerHTML = `<tr><td colspan="9" class="text-center text-muted" style="padding:22px">Nenhum item. Clique em “Adicionar” ou “Buscar produto”.</td></tr>`;
      return;
    }
    tb.innerHTML = itens.map((it, i) => {
      const total = (it.quantidade * it.valor_unitario) - it.desconto;
      const dis = soLeitura ? "disabled" : "";
      return `<tr>
        <td class="orc-item-num">${String(i + 1).padStart(3, "0")}</td>
        <td><input class="orc-cel orc-cel--cod" data-i="${i}" data-f="codigo" value="${esc(it.codigo)}" ${dis}></td>
        <td><input class="orc-cel orc-cel--desc" data-i="${i}" data-f="descricao" value="${esc(it.descricao)}" ${dis}></td>
        <td><input class="orc-cel orc-cel--num" data-i="${i}" data-f="quantidade" type="number" step="0.01" value="${it.quantidade}" ${dis}></td>
        <td><input class="orc-cel orc-cel--un" data-i="${i}" data-f="unidade" value="${esc(it.unidade)}" ${dis}></td>
        <td><input class="orc-cel orc-cel--num" data-i="${i}" data-f="valor_unitario" type="number" step="0.01" value="${it.valor_unitario}" ${dis}></td>
        <td><input class="orc-cel orc-cel--num" data-i="${i}" data-f="desconto" type="number" step="0.01" value="${it.desconto}" ${dis}></td>
        <td class="orc-item-total">${money(total)}</td>
        <td class="text-right">${soLeitura ? "" : `<button class="icon-btn btn--sm" title="Remover" onclick="window.__orc.remItem(${i})"><i class="fa-solid fa-trash"></i></button>`}</td>
      </tr>`;
    }).join("");

    tb.querySelectorAll(".orc-cel").forEach((inp) => {
      inp.addEventListener("input", () => {
        const i = +inp.dataset.i, f = inp.dataset.f;
        itens[i][f] = (inp.type === "number") ? (parseFloat(inp.value) || 0) : inp.value;
        // atualiza só o total da linha e os totais gerais
        const linha = inp.closest("tr");
        const it = itens[i];
        linha.querySelector(".orc-item-total").textContent = money((it.quantidade * it.valor_unitario) - it.desconto);
        recalc();
      });
    });
  }

  function recalc() {
    const sub = itens.reduce((s, it) => s + ((it.quantidade * it.valor_unitario) - it.desconto), 0);
    const desc = parseFloat(document.getElementById("orc-desc")?.value) || 0;
    const ts = document.getElementById("t-sub"), tt = document.getElementById("t-total");
    if (ts) ts.textContent = money(sub);
    if (tt) tt.textContent = money(sub - desc);
  }

  /* ------------------------------------------------------- buscar produto */
  function abrirBusca() {
    const linhas = [
      ...produtos.map((p) => ({ tipo: "produto", id: p.id, codigo: p.codigo || "", nome: p.nome, valor: p.preco_venda || 0, un: "UN" })),
      ...servicos.map((s) => ({ tipo: "servico", id: s.id, codigo: "", nome: s.descricao, valor: s.valor || 0, un: "SV" })),
    ];
    Modal.abrir("Buscar produto ou serviço", `
      <input id="busca-q" class="input" placeholder="Digite para filtrar..." style="width:100%;margin-bottom:10px">
      <div class="table-wrap" style="max-height:50vh;overflow:auto"><table class="data"><tbody id="busca-lista">
        ${linhas.map((l, i) => linhaBusca(l, i)).join("")}
      </tbody></table></div>`,
      `<button class="btn btn--ghost" onclick="Modal.fechar()">Fechar</button>`);
    const q = document.getElementById("busca-q");
    q.oninput = () => {
      const t = q.value.toLowerCase();
      document.querySelectorAll("#busca-lista tr").forEach((tr) => {
        tr.style.display = tr.textContent.toLowerCase().includes(t) ? "" : "none";
      });
    };
    window.__buscaLinhas = linhas;
    q.focus();
  }
  function linhaBusca(l, i) {
    return `<tr style="cursor:pointer" onclick="window.__orc.pick(${i})">
      <td><span class="pill ${l.tipo === "servico" ? "pill--accent" : ""}">${l.un}</span></td>
      <td>${l.codigo ? "<b>" + l.codigo + "</b> · " : ""}${l.nome}</td>
      <td class="text-right">${money(l.valor)}</td></tr>`;
  }

  /* --------------------------------------------------------------- salvar */
  function coletar() {
    return {
      eh_orcamento: 1,
      cliente_id: Number(document.getElementById("orc-cliente")?.value) || null,
      veiculo_id: Number(document.getElementById("orc-veiculo")?.value) || null,
      validade: document.getElementById("orc-validade")?.value.trim(),
      forma_pagamento: document.getElementById("orc-forma")?.value,
      condicoes: document.getElementById("orc-cond")?.value.trim(),
      observacoes: editando?.observacoes || "",   // campo removido da tela; preserva o que já existia
      obs_finais: document.getElementById("orc-obsf")?.value.trim(),
      desconto: parseFloat(document.getElementById("orc-desc")?.value) || 0,
      status: editando?.status || "aberta",
      itens: itens.map((it) => ({
        tipo: it.tipo, referencia_id: it.referencia_id, codigo: it.codigo,
        descricao: it.descricao, unidade: it.unidade,
        quantidade: it.quantidade, valor_unitario: it.valor_unitario, desconto: it.desconto,
      })),
    };
  }

  async function salvar() {
    const d = coletar();
    if (!d.cliente_id) { toast("Selecione um cliente", "warning"); return; }
    try {
      if (editando) {
        // Orçamento já salvo -> "Finalizar orçamento": grava e volta à lista.
        await API.put(`/api/os/${editando.id}`, d);
        toast("Orçamento finalizado");
        renderLista();
      } else {
        // Novo -> salva e reabre já salvo (aí surgem Imprimir/PDF/WhatsApp/Finalizar).
        const r = await API.post("/api/os", d);
        toast("Orçamento salvo");
        abrirEditor(r.id);
      }
    } catch (e) { toast(e.message || "Erro ao salvar", "error"); }
  }

  async function excluir(id) {
    if (!confirm("Excluir este orçamento?")) return;
    try { await API.del(`/api/os/${id}`); toast("Orçamento excluído"); renderLista(); }
    catch (e) { toast(e.message, "error"); }
  }

  /* ------------------------------------------------ PDF (jsPDF) / whats */
  function gerarPDFBlob(opts = {}) {
    const JS = window.jspdf && window.jspdf.jsPDF;
    if (!JS) return null;
    const doc = new JS({ unit: "mm", format: "a4" });
    const teal = [13, 148, 136];
    const M = 14, LARG = 210 - M * 2;
    const d = coletar();
    const cli = clientes.find((c) => c.id === d.cliente_id) || {};
    const vei = veiculos.find((v) => v.id === d.veiculo_id) || {};
    let y = 14;

    if (cfg.empresa_logo) {
      try {
        const f = cfg.empresa_logo.includes("image/png") ? "PNG" : "JPEG";
        doc.addImage(cfg.empresa_logo, f, M, y, 26, 26);
      } catch (_) {}
    }
    const xe = cfg.empresa_logo ? M + 30 : M;
    doc.setFont("helvetica", "bold").setFontSize(14).setTextColor(20);
    doc.text(cfg.empresa_nome || "Orçamento", xe, y + 5);
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(90);
    let ly = y + 10;
    if (cfg.empresa_cnpj) { doc.text("CNPJ: " + cfg.empresa_cnpj, xe, ly); ly += 4; }
    if (cfg.empresa_telefone) { doc.text("Tel: " + cfg.empresa_telefone, xe, ly); ly += 4; }
    Layout.enderecoLinhas().forEach((l) => { doc.text(l, xe, ly); ly += 4; });

    doc.setFont("helvetica", "bold").setFontSize(16).setTextColor(teal[0], teal[1], teal[2]);
    doc.text("ORÇAMENTO", 210 - M, y + 4, { align: "right" });
    doc.setFontSize(11).setTextColor(20);
    doc.text("Nº " + (editando?.numero || "—"), 210 - M, y + 11, { align: "right" });
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(90);
    doc.text("Data: " + fmt.data(new Date().toISOString()), 210 - M, y + 17, { align: "right" });
    doc.text("Validade: " + (d.validade || ""), 210 - M, y + 22, { align: "right" });

    y = Math.max(ly, y + 26) + 3;
    doc.setDrawColor(teal[0], teal[1], teal[2]).setLineWidth(0.6).line(M, y, 210 - M, y);
    y += 6;

    doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(teal[0], teal[1], teal[2]);
    doc.text("DADOS DO CLIENTE E VEÍCULO", M, y); y += 5;
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(40);
    doc.text(`Cliente: ${cli.nome || "—"}   Tel: ${cli.telefone || "—"}   CPF/CNPJ: ${cli.cpf_cnpj || "—"}`, M, y); y += 5;
    doc.text(`Veículo: ${[vei.marca, vei.modelo, vei.ano].filter(Boolean).join(" ") || "—"}   Placa: ${vei.placa || "—"}   Combustível: ${vei.combustivel || "—"}`, M, y); y += 3;
    if (d.observacoes) { y += 3; doc.setTextColor(90); doc.text(doc.splitTextToSize("Obs: " + d.observacoes, LARG), M, y); y += 6; }

    const body = itens.map((it, i) => [
      String(i + 1).padStart(3, "0"), it.codigo || "", it.descricao || "",
      String(it.quantidade), it.unidade || "", money(it.valor_unitario),
      money(it.desconto), money((it.quantidade * it.valor_unitario) - it.desconto),
    ]);
    doc.autoTable({
      startY: y + 2,
      head: [["Item", "Código", "Descrição", "Qtd", "Un", "Valor Unit.", "Desc.", "Total"]],
      body,
      theme: "grid",
      headStyles: { fillColor: teal, fontSize: 8, textColor: 255 },
      bodyStyles: { fontSize: 8 },
      columnStyles: { 2: { cellWidth: 55 }, 3: { halign: "center" }, 4: { halign: "center" },
                      5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" } },
      margin: { left: M, right: M },
    });

    let fy = doc.lastAutoTable.finalY + 7;
    const sub = itens.reduce((s, it) => s + ((it.quantidade * it.valor_unitario) - it.desconto), 0);
    doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(40);
    doc.text(`Subtotal: ${money(sub)}`, 210 - M, fy, { align: "right" }); fy += 5;
    doc.text(`Desconto: ${money(d.desconto)}`, 210 - M, fy, { align: "right" }); fy += 6;
    doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(teal[0], teal[1], teal[2]);
    doc.text(`TOTAL DO ORÇAMENTO: ${money(sub - d.desconto)}`, 210 - M, fy, { align: "right" }); fy += 9;

    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(60);
    // A forma de pagamento não vai no orçamento enviado ao cliente (é acertada só no pagamento).
    if (!opts.ocultarPagamento) {
      doc.text(`Forma de pagamento: ${d.forma_pagamento || "—"}    Condições: ${d.condicoes || "—"}`, M, fy); fy += 5;
    }
    if (d.obs_finais) doc.text(doc.splitTextToSize(d.obs_finais, LARG), M, fy);

    return doc.output("blob");
  }

  function baixarBlob(blob, nome) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function nomePDF() { return `orcamento-${(editando?.numero || "novo").replace(/\W/g, "")}.pdf`; }

  function gerarPDF() {
    const blob = gerarPDFBlob();
    if (!blob) { toast("PDF ainda carregando, tente novamente em 1s.", "warning"); return; }
    baixarBlob(blob, nomePDF());
  }

  // Impressão simples (abre o PDF gerado para imprimir/salvar)
  function imprimir() {
    const blob = gerarPDFBlob();
    if (!blob) { toast("PDF ainda carregando, tente novamente em 1s.", "warning"); return; }
    const url = URL.createObjectURL(blob);
    const w = window.open(url, "_blank");
    if (w) setTimeout(() => { try { w.print(); } catch (_) {} }, 700);
  }

  async function enviarWhats() {
    const blob = gerarPDFBlob({ ocultarPagamento: true });
    if (!blob) { toast("PDF ainda carregando, tente novamente em 1s.", "warning"); return; }
    const nome = nomePDF();
    const file = new File([blob], nome, { type: "application/pdf" });
    const cid = Number(document.getElementById("orc-cliente")?.value);
    const c = clientes.find((x) => x.id === cid) || {};
    const fone = (c.whatsapp || c.telefone || "").replace(/\D/g, "");
    const sub = itens.reduce((s, it) => s + ((it.quantidade * it.valor_unitario) - it.desconto), 0);
    const desc = parseFloat(document.getElementById("orc-desc")?.value) || 0;
    const texto = `*Orçamento ${editando?.numero || ""}* — ${cfg.empresa_nome || ""}\nTotal: ${money(sub - desc)}`;

    // Celular: compartilha o PDF direto (o WhatsApp aparece entre as opções).
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "Orçamento", text: texto }); return; }
      catch (_) { /* cancelado: segue para o fallback */ }
    }
    // Computador: baixa o PDF e abre o WhatsApp com a mensagem para anexar.
    baixarBlob(blob, nome);
    const base = fone ? `https://wa.me/55${fone}` : "https://wa.me/";
    window.open(`${base}?text=${encodeURIComponent(texto + "\n\nSegue o orçamento em PDF (anexe o arquivo que acabou de ser baixado).")}`, "_blank");
    toast("PDF baixado — anexe-o na conversa do WhatsApp.");
  }

  /* --------------------------------------------------------------- API pública */
  const api = {
    abrir: (id) => abrirEditor(id),
    excluir,
    remItem: (i) => { itens.splice(i, 1); renderItens(); recalc(); },
    pick: (i) => {
      const l = window.__buscaLinhas[i];
      itens.push({ tipo: l.tipo, referencia_id: l.id, codigo: l.codigo, descricao: l.nome, unidade: l.un, quantidade: 1, valor_unitario: l.valor, desconto: 0 });
      Modal.fechar(); renderItens(); recalc();
    },
  };
})();
