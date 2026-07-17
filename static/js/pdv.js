/* =======================================================================
   pdv.js — Ponto de Venda
   Fluxo: abrir caixa → buscar produtos → montar carrinho → finalizar venda.
   Também: sangria, suprimento e fechamento de caixa com resumo.
   ======================================================================= */
(async () => {
  await Layout.iniciar("pdv", "PDV");

  const FORMAS = [["dinheiro", "Dinheiro"], ["pix", "PIX"], ["cartao", "Cartão"], ["boleto", "Boleto"]];
  let produtos = [], clientes = [], carrinho = [], caixa = null;

  try {
    const [rp, rc] = await Promise.all([
      API.get("/api/produtos?por_pagina=1000&ordem=nome"),
      API.get("/api/clientes?por_pagina=1000&ordem=nome"),
    ]);
    produtos = rp.dados || [];
    clientes = rc.dados || [];
  } catch (_) {}

  async function checarCaixa() {
    try { const r = await API.get("/api/pdv/caixa"); caixa = r.caixa; } catch (_) { caixa = null; }
  }
  await checarCaixa();

  render();

  function render() {
    if (!caixa) return renderCaixaFechado();
    renderPdv();
  }

  function renderCaixaFechado() {
    Layout.set(`
      <div class="pdv-fechado">
        <div class="pdv-fechado__card card">
          <i class="fa-solid fa-cash-register"></i>
          <h2>Caixa fechado</h2>
          <p class="text-muted">Informe o valor de abertura (fundo de troco) para iniciar as vendas.</p>
          <div class="field"><label>Valor de abertura</label>
            <input type="number" step="0.01" id="pdv-abertura" value="0"></div>
          <button class="btn btn--primary btn--block" id="pdv-abrir">
            <i class="fa-solid fa-lock-open"></i> Abrir caixa</button>
        </div>
      </div>`);
    document.getElementById("pdv-abrir").onclick = async () => {
      try {
        await API.post("/api/pdv/caixa/abrir", { valor_abertura: parseFloat(document.getElementById("pdv-abertura").value) || 0 });
        toast("Caixa aberto");
        await checarCaixa(); render();
      } catch (e) { toast(e.message, "error"); }
    };
  }

  function renderPdv() {
    Layout.set(`
      <div class="page-head">
        <div><h1>PDV</h1><p>Caixa aberto desde ${fmt.dataHora(caixa.aberto_em)} — abertura ${fmt.moeda(caixa.valor_abertura)}</p></div>
        <div class="pdv-acoes">
          <button class="btn btn--ghost btn--sm" id="pdv-sup"><i class="fa-solid fa-plus"></i> Suprimento</button>
          <button class="btn btn--ghost btn--sm" id="pdv-sang"><i class="fa-solid fa-minus"></i> Sangria</button>
          <button class="btn btn--danger btn--sm" id="pdv-fechar"><i class="fa-solid fa-lock"></i> Fechar caixa</button>
        </div>
      </div>
      <div class="pdv-grid">
        <div class="card pdv-busca-box"><div class="card__body">
          <div class="toolbar__search"><i class="fa-solid fa-magnifying-glass"></i>
            <input id="pdv-busca" placeholder="Buscar produto por nome, código ou barras…" autocomplete="off"></div>
          <div id="pdv-resultados" class="pdv-resultados"></div>
        </div></div>

        <div class="card pdv-carrinho"><div class="card__body">
          <h3>Carrinho</h3>
          <div id="pdv-itens" class="pdv-itens"></div>
          <div class="pdv-resumo">
            <div class="field"><label>Cliente (opcional)</label>
              <select id="pdv-cliente"><option value="">Consumidor final</option>
                ${clientes.map((c) => `<option value="${c.id}">${c.nome}</option>`).join("")}</select></div>
            <div class="pdv-linha"><span>Desconto (R$)</span>
              <input type="number" step="0.01" id="pdv-desconto" value="0" oninput="window.__pdv.calc()"></div>
            <div class="pdv-linha"><label>Forma</label>
              <select id="pdv-forma">${FORMAS.map((f) => `<option value="${f[0]}">${f[1]}</option>`).join("")}</select></div>
            <div class="pdv-total">Total <b id="pdv-total">${fmt.moeda(0)}</b></div>
            <button class="btn btn--success btn--block" id="pdv-finalizar"><i class="fa-solid fa-check"></i> Finalizar venda</button>
          </div>
        </div></div>
      </div>`);

    document.getElementById("pdv-busca").oninput = debounce((e) => buscar(e.target.value.trim()));
    document.getElementById("pdv-busca").onkeydown = (e) => {
      // Enter adiciona direto o primeiro resultado (fluxo de leitor de código de barras)
      if (e.key === "Enter") { const p = document.querySelector("#pdv-resultados .pdv-res-item"); if (p) p.click(); }
    };
    document.getElementById("pdv-finalizar").onclick = finalizar;
    document.getElementById("pdv-sup").onclick = () => movimento("suprimento");
    document.getElementById("pdv-sang").onclick = () => movimento("sangria");
    document.getElementById("pdv-fechar").onclick = fechar;
    renderCarrinho();
  }

  function buscar(termo) {
    const box = document.getElementById("pdv-resultados");
    if (!termo) { box.innerHTML = ""; return; }
    const t = termo.toLowerCase();
    const achados = produtos.filter((p) =>
      (p.nome || "").toLowerCase().includes(t) ||
      (p.codigo || "").toLowerCase().includes(t) ||
      (p.codigo_barras || "").toLowerCase().includes(t) ||
      (p.ean || "").toLowerCase().includes(t)).slice(0, 12);
    if (!achados.length) { box.innerHTML = `<div class="empty"><i class="fa-solid fa-inbox"></i>Nada encontrado</div>`; return; }
    box.innerHTML = achados.map((p) => `
      <div class="pdv-res-item" onclick="window.__pdv.add(${p.id})">
        <div><b>${p.nome}</b><small>${p.codigo || p.ean || ""}</small></div>
        <div class="pdv-res-preco">${fmt.moeda(p.preco_venda)}</div>
      </div>`).join("");
  }

  function renderCarrinho() {
    const box = document.getElementById("pdv-itens");
    if (!carrinho.length) { box.innerHTML = `<div class="empty"><i class="fa-solid fa-basket-shopping"></i>Carrinho vazio</div>`; api.calc(); return; }
    box.innerHTML = carrinho.map((it, i) => `
      <div class="pdv-item">
        <div class="pdv-item__nome">${it.descricao}</div>
        <input class="pdv-item__qtd" type="number" min="0.01" step="0.01" value="${it.quantidade}"
          onchange="window.__pdv.qtd(${i}, this.value)">
        <div class="pdv-item__sub">${fmt.moeda(it.quantidade * it.valor_unitario)}</div>
        <button class="icon-btn btn--sm" onclick="window.__pdv.rem(${i})"><i class="fa-solid fa-xmark"></i></button>
      </div>`).join("");
    api.calc();
  }

  const api = {
    add(id) {
      const p = produtos.find((x) => x.id === id); if (!p) return;
      const ex = carrinho.find((c) => c.produto_id === id);
      if (ex) ex.quantidade += 1;
      else carrinho.push({ produto_id: id, descricao: p.nome, quantidade: 1, valor_unitario: p.preco_venda || 0 });
      document.getElementById("pdv-busca").value = "";
      document.getElementById("pdv-resultados").innerHTML = "";
      document.getElementById("pdv-busca").focus();
      renderCarrinho();
    },
    qtd(i, v) { carrinho[i].quantidade = parseFloat(v) || 0; renderCarrinho(); },
    rem(i) { carrinho.splice(i, 1); renderCarrinho(); },
    calc() {
      const bruto = carrinho.reduce((s, it) => s + it.quantidade * it.valor_unitario, 0);
      const desc = parseFloat(document.getElementById("pdv-desconto")?.value) || 0;
      const el = document.getElementById("pdv-total");
      if (el) el.textContent = fmt.moeda(Math.max(0, bruto - desc));
    },
  };
  window.__pdv = api;

  async function finalizar() {
    if (!carrinho.length) { toast("Carrinho vazio", "warning"); return; }
    const dados = {
      itens: carrinho,
      cliente_id: document.getElementById("pdv-cliente").value || null,
      desconto: parseFloat(document.getElementById("pdv-desconto").value) || 0,
      forma_pagamento: document.getElementById("pdv-forma").value,
    };
    try {
      const r = await API.post("/api/pdv/venda", dados);
      toast(`Venda registrada — ${fmt.moeda(r.total)}`);
      carrinho = [];
      document.getElementById("pdv-desconto").value = 0;
      renderCarrinho();
    } catch (e) { toast(e.message, "error"); }
  }

  function movimento(tipo) {
    Modal.abrir(tipo === "sangria" ? "Sangria (retirada)" : "Suprimento (reforço)", `
      <div class="form-grid" id="mov-form">
        <div class="field"><label>Valor</label><input type="number" step="0.01" name="valor"></div>
        <div class="field"><label>Motivo</label><input name="motivo"></div>
      </div>`,
      `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
       <button class="btn btn--primary" id="mov-ok">Confirmar</button>`);
    document.getElementById("mov-ok").onclick = async () => {
      const f = document.getElementById("mov-form");
      try {
        await API.post("/api/pdv/caixa/movimento", { tipo, valor: parseFloat(f.valor.value) || 0, motivo: f.motivo.value });
        toast("Registrado"); Modal.fechar();
      } catch (e) { toast(e.message, "error"); }
    };
  }

  async function fechar() {
    if (!confirm("Fechar o caixa agora?")) return;
    try {
      const r = await API.post("/api/pdv/caixa/fechar");
      const s = r.resumo || {};
      Modal.abrir("Caixa fechado", `
        <div class="pdv-resumo-fech">
          <div><span>Abertura</span><b>${fmt.moeda(s.abertura)}</b></div>
          <div><span>Vendas</span><b>${fmt.moeda(s.vendas)}</b></div>
          <div><span>Suprimentos</span><b>${fmt.moeda(s.suprimentos)}</b></div>
          <div><span>Sangrias</span><b>- ${fmt.moeda(s.sangrias)}</b></div>
          <div class="pdv-resumo-fech__total"><span>Total em caixa</span><b>${fmt.moeda(s.total)}</b></div>
        </div>`,
        `<button class="btn btn--primary" onclick="Modal.fechar()">OK</button>`);
      caixa = null;
      const bd = document.getElementById("modal-atual");
      if (bd) bd.addEventListener("click", (e) => { if (e.target === bd) render(); });
      // Ao fechar o modal, volta para a tela de caixa fechado
      const btn = document.querySelector("#modal-atual .btn--primary");
      if (btn) btn.onclick = () => { Modal.fechar(); render(); };
    } catch (e) { toast(e.message, "error"); }
  }
})();
