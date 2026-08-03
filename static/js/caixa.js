/* =======================================================================
   caixa.js — Tela do Caixa com LOGIN PRÓPRIO (token), independente do ERP.
   O token fica em sessionStorage (isolado por aba), então o login do caixa
   não se mistura com o do admin: sair de um não desloga o outro. As chamadas
   vão para /api/caixa/* com o cabeçalho X-Caixa-Token.
   ======================================================================= */
(async () => {
  const app = document.getElementById("app");
  const TOKEN_KEY = "caixa_token";
  const money = (v) => "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const FORMAS = ["Dinheiro", "Pix", "Cartão de Débito", "Cartão de Crédito"];

  let cfg = {}, operador = "";
  let marca = null;                  // {empresa_nome, empresa_logo} vindo de /api/marca
  let autoTimer = null;              // timer do auto-refresh (caixa aberto)
  const AUTO_INTERVALO = 12000;      // 12s: pega cobranças novas sem pesar

  // Marca pública (logo + razão social), igual ao login do admin. Endpoint
  // público: funciona antes de logar.
  async function carregarMarca() {
    if (marca) return marca;
    try {
      const resp = await fetch("/api/marca");
      marca = resp.ok ? await resp.json() : {};
    } catch (_) { marca = {}; }
    return marca;
  }

  const getToken = () => sessionStorage.getItem(TOKEN_KEY) || "";
  const setToken = (t) => sessionStorage.setItem(TOKEN_KEY, t);
  const limparToken = () => sessionStorage.removeItem(TOKEN_KEY);

  // fetch dedicado do caixa (token no cabeçalho, não depende do cookie do ERP)
  async function cx(method, path, body) {
    const resp = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json", "X-Caixa-Token": getToken() },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) { const e = new Error(data.erro || "Erro"); e.status = resp.status; throw e; }
    return data;
  }

  /* --------------------------------------------------------------- boot */
  async function boot() {
    pararAuto();   // evita timers duplicados a cada re-render
    if (!getToken()) return await telaLogin();
    try {
      const st = await cx("GET", "/api/caixa/status");
      cfg = st.config || {}; operador = st.operador || "";
      if (!st.aberto) renderFechado(); else renderAberto(st);
    } catch (e) {
      limparToken();
      await telaLogin(e.status === 401 ? null : e.message);
    }
  }

  /* ---------------------------------------------------- login do caixa */
  async function telaLogin(aviso) {
    await carregarMarca();
    // Bloco de marca idêntico ao login do admin (mesmas classes do login.css).
    const marcaCard = (marca && (marca.empresa_logo || marca.empresa_nome)) ? `
            <div class="login-card__marca">
              ${marca.empresa_logo ? `<img class="login-card__logo" src="${marca.empresa_logo}" alt="${marca.empresa_nome || "Empresa"}">` : ""}
              ${marca.empresa_nome ? `<div class="login-card__nome">${marca.empresa_nome}</div>` : ""}
            </div>` : "";

    app.innerHTML = `
      <div class="login-wrap">
        <div class="login-side">
          <svg class="login-side__s" viewBox="0 0 300 380" aria-hidden="true" preserveAspectRatio="xMidYMid meet"><path d="M 208 96 C 208 50, 118 42, 80 82 C 42 122, 72 168, 152 192 C 232 216, 258 264, 220 302 C 182 340, 96 332, 96 288" fill="none" stroke="currentColor" stroke-width="56" stroke-linecap="round"/></svg>
          <div class="login-side__brand">
            <div class="login-brand__nome">Dev<span>System</span></div>
            <span class="login-brand__prime">PRIME</span>
            <p class="login-brand__tag">Seu negócio, nosso sistema</p>
            <div class="login-brand__bar"></div>
            <p class="login-brand__desc">Transforme a gestão do seu negócio com um sistema moderno, completo e fácil de usar.</p>
          </div>
        </div>
        <div class="login-form-side">
          <div class="login-card">
            ${marcaCard}
            <h1>Acesse o caixa</h1>
            <p class="login-sub">Entre com seu usuário de caixa</p>
            ${aviso ? `<div class="cx-erro">${aviso}</div>` : ""}
            <div class="field">
              <label>E-mail</label>
              <input class="login-input" id="lg-email" type="email" placeholder="voce@empresa.com" autocomplete="username">
            </div>
            <div class="field">
              <label>Senha</label>
              <div class="login-inp">
                <input class="login-input" id="lg-senha" type="password" placeholder="••••••••" autocomplete="current-password">
                <button type="button" class="login-eye" id="lg-eye"><i class="fa-solid fa-eye"></i></button>
              </div>
            </div>
            <button class="login-btn" id="lg-ok" style="margin-top:8px"><i class="fa-solid fa-right-to-bracket"></i> Entrar no caixa</button>
          </div>
        </div>
      </div>`;
    const entrar = async () => {
      const email = document.getElementById("lg-email").value.trim();
      const senha = document.getElementById("lg-senha").value;
      if (!email || !senha) { toast("Informe e-mail e senha", "warning"); return; }
      try {
        const r = await cx("POST", "/api/caixa/login", { email, senha });
        setToken(r.token);
        boot();
      } catch (e) { toast(e.message || "Falha no login", "error"); }
    };
    document.getElementById("lg-ok").onclick = entrar;
    document.getElementById("lg-senha").addEventListener("keydown", (e) => { if (e.key === "Enter") entrar(); });
    document.getElementById("lg-eye").onclick = () => {
      const inp = document.getElementById("lg-senha");
      const ic = document.querySelector("#lg-eye i");
      if (inp.type === "password") { inp.type = "text"; ic.className = "fa-solid fa-eye-slash"; }
      else { inp.type = "password"; ic.className = "fa-solid fa-eye"; }
    };
    const em = document.getElementById("lg-email"); if (em) em.focus();
  }

  /* --------------------------------------------------------- cabeçalho */
  function cabecalho() {
    return `
      <header class="cx-top">
        <div class="cx-marca">
          ${cfg.empresa_logo ? `<img src="${cfg.empresa_logo}" alt="logo">` : `<i class="fa-solid fa-cash-register"></i>`}
          <div><b>${cfg.empresa_nome || "Caixa"}</b><span>Caixa</span></div>
        </div>
        <div class="cx-op">
          <span><i class="fa-solid fa-user"></i> ${operador}</span>
          <button class="btn btn--ghost btn--sm" id="cx-sair"><i class="fa-solid fa-right-from-bracket"></i> Sair</button>
        </div>
      </header>`;
  }
  function ligarComuns() {
    document.getElementById("cx-sair").onclick = () => { pararAuto(); limparToken(); telaLogin(); };
  }

  /* ------------------------------------------------------------ FECHADO */
  function renderFechado() {
    app.innerHTML = cabecalho() + `
      <div class="cx-centro">
        <div class="cx-card cx-abrir">
          <i class="fa-solid fa-cash-register cx-icone"></i>
          <h2>Caixa fechado</h2>
          <p class="text-muted">Informe o valor em dinheiro no início do turno (troco).</p>
          <label class="cx-campo"><span>Valor de abertura</span>
            <input id="cx-abertura" type="number" step="0.01" value="0" inputmode="decimal"></label>
          <button class="btn btn--primary btn--lg" id="cx-btn-abrir"><i class="fa-solid fa-lock-open"></i> Abrir caixa</button>
        </div>
      </div>`;
    ligarComuns();
    document.getElementById("cx-btn-abrir").onclick = async () => {
      const v = parseFloat(document.getElementById("cx-abertura").value) || 0;
      try { await cx("POST", "/api/caixa/abrir", { valor_abertura: v }); toast("Caixa aberto"); boot(); }
      catch (e) { toast(e.message, "error"); }
    };
  }

  /* ------------------------------------------------ auto-refresh (aberto) */
  function pararAuto() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  }

  function iniciarAuto() {
    pararAuto();
    autoTimer = setInterval(atualizarSilencioso, AUTO_INTERVALO);
  }

  // Atualiza totais e a lista de cobranças SEM reconstruir a tela inteira.
  // Pula o ciclo se houver um modal aberto (para não atrapalhar um recebimento
  // em andamento) ou se a aba estiver em segundo plano.
  async function atualizarSilencioso() {
    if (document.hidden) return;
    if (document.querySelector(".modal, .modal-backdrop, #modal")) return;
    try {
      const st = await cx("GET", "/api/caixa/status");
      if (!st.aberto) { boot(); return; }   // caixa foi fechado em outro lugar
      pintarTotais(st.totais || {});
      const cob = (await cx("GET", "/api/caixa/receber")).dados || [];
      pintarCobrancas(cob);
    } catch (_) { /* silencioso: erro de rede não interrompe o operador */ }
  }

  function pintarTotais(t) {
    const map = {
      abertura: t.abertura, recebimentos: t.recebimentos,
      suprimentos: t.suprimentos, sangrias: t.sangrias, saldo: t.saldo,
    };
    document.querySelectorAll("[data-tot]").forEach((el) => {
      const k = el.getAttribute("data-tot");
      if (k in map) el.textContent = money(map[k]);
    });
  }

  function pintarCobrancas(cobrancas) {
    const lista = document.getElementById("cx-lista");
    if (!lista) return;
    lista.innerHTML = cobrancas.length ? cobrancas.map((c) => `
      <div class="cx-cob">
        <div class="cx-cob__info">
          <b>${c.cliente_nome || "Cliente"}</b>
          <span>${c.descricao || "Cobrança"}${c.status === "atrasado" ? ` · <em class="cx-atraso">atrasado</em>` : ""}</span>
        </div>
        <div class="cx-cob__valor">${money(c.valor)}</div>
        <button class="btn btn--success btn--sm" onclick="window.__cx.receber(${c.id}, ${c.valor})">
          <i class="fa-solid fa-hand-holding-dollar"></i> Receber</button>
      </div>`).join("") : `<div class="cx-vazio-min">Nenhuma cobrança em aberto. 🎉</div>`;
  }

  /* ------------------------------------------------------------- ABERTO */
  async function renderAberto(st) {
    const t = st.totais || {};
    let cobrancas = [];
    try { cobrancas = (await cx("GET", "/api/caixa/receber")).dados || []; } catch (_) {}

    app.innerHTML = cabecalho() + `
      <div class="cx-painel">
        <div class="cx-totais">
          <div class="cx-tot"><span>Abertura</span><b data-tot="abertura">${money(t.abertura)}</b></div>
          <div class="cx-tot cx-tot--in"><span>Recebido</span><b data-tot="recebimentos">${money(t.recebimentos)}</b></div>
          <div class="cx-tot cx-tot--in"><span>Suprimentos</span><b data-tot="suprimentos">${money(t.suprimentos)}</b></div>
          <div class="cx-tot cx-tot--out"><span>Sangrias</span><b data-tot="sangrias">${money(t.sangrias)}</b></div>
          <div class="cx-tot cx-tot--saldo"><span>Saldo em caixa</span><b data-tot="saldo">${money(t.saldo)}</b></div>
        </div>
        <div class="cx-acoes">
          <button class="btn btn--ghost" id="cx-suprimento"><i class="fa-solid fa-arrow-down"></i> Suprimento</button>
          <button class="btn btn--ghost" id="cx-sangria"><i class="fa-solid fa-arrow-up"></i> Sangria</button>
          <button class="btn btn--danger-ghost" id="cx-fechar"><i class="fa-solid fa-lock"></i> Fechar caixa</button>
        </div>

        <div class="cx-secao-tit"><i class="fa-solid fa-file-invoice-dollar"></i> Cobranças a receber</div>
        <div class="cx-lista" id="cx-lista">
          ${cobrancas.length ? cobrancas.map((c) => `
            <div class="cx-cob">
              <div class="cx-cob__info">
                <b>${c.cliente_nome || "Cliente"}</b>
                <span>${c.descricao || "Cobrança"}${c.status === "atrasado" ? ` · <em class="cx-atraso">atrasado</em>` : ""}</span>
              </div>
              <div class="cx-cob__valor">${money(c.valor)}</div>
              <button class="btn btn--success btn--sm" onclick="window.__cx.receber(${c.id}, ${c.valor})">
                <i class="fa-solid fa-hand-holding-dollar"></i> Receber</button>
            </div>`).join("") : `<div class="cx-vazio-min">Nenhuma cobrança em aberto. 🎉</div>`}
        </div>
      </div>`;
    ligarComuns();
    document.getElementById("cx-suprimento").onclick = () => movimento("suprimento");
    document.getElementById("cx-sangria").onclick = () => movimento("sangria");
    document.getElementById("cx-fechar").onclick = () => fecharCaixa(t);
    window.__cx = api;
    iniciarAuto();   // liga o auto-refresh enquanto o caixa está aberto
  }

  /* ----------------------------------------------------------- receber */
  function receber(fid, valor) {
    let forma = FORMAS[0];
    Modal.abrir("Receber cobrança", `
      <p class="text-muted" style="margin-bottom:10px">Valor: <b>${money(valor)}</b></p>
      <label class="cx-campo"><span>Valor recebido</span>
        <input id="rc-valor" type="number" step="0.01" value="${Number(valor).toFixed(2)}"></label>
      <div class="cx-campo"><span>Forma de pagamento</span>
        <div class="cx-formas" id="rc-formas">
          ${FORMAS.map((f, i) => `<button type="button" class="cx-forma ${i === 0 ? "ativa" : ""}" data-f="${f}">${f}</button>`).join("")}
        </div>
      </div>
      <div id="rc-cartao" style="display:none;border-top:1px solid var(--border,#e5e7eb);margin-top:10px;padding-top:10px">
        <div class="cx-campo"><span>Modalidade</span>
          <select id="rc-modalidade" style="width:100%">
            <option value="credito">Crédito</option><option value="debito">Débito</option>
          </select></div>
        <div class="cx-campo"><span>Bandeira</span>
          <input id="rc-bandeira" placeholder="Visa, Master, Elo… (ou deixe vazio)"></div>
        <div class="cx-campo"><span>Parcelas</span>
          <input id="rc-parcelas" type="number" min="1" max="24" value="1"></div>
        <p id="rc-liquido" class="text-muted" style="margin:6px 0 0;font-size:13px"></p>
      </div>`,
      `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
       <button class="btn btn--success" id="rc-ok"><i class="fa-solid fa-check"></i> Confirmar recebimento</button>`);

    const blocoCartao = document.getElementById("rc-cartao");
    let liquidoInfo = null;

    async function recalcCartao() {
      if (forma !== "cartao") { liquidoInfo = null; return; }
      const valor_pago = parseFloat(document.getElementById("rc-valor").value) || 0;
      const body = {
        valor: valor_pago,
        modalidade: document.getElementById("rc-modalidade").value,
        parcelas: parseInt(document.getElementById("rc-parcelas").value) || 1,
        bandeira: document.getElementById("rc-bandeira").value.trim(),
      };
      try {
        const r = await cx("POST", "/api/caixa/cartao-calcular", body);
        liquidoInfo = r;
        const el = document.getElementById("rc-liquido");
        el.innerHTML = r.sem_taxa_cadastrada
          ? `<span style="color:#b91c1c">Sem taxa cadastrada para essa opção — líquido = bruto.</span>`
          : `Taxa: <b>${(r.percentual || 0).toFixed(2)}%</b> · Desconto: ${money(r.desconto)} · Líquido: <b>${money(r.valor_liquido)}</b>`;
      } catch (_) { liquidoInfo = null; }
    }

    document.querySelectorAll("#rc-formas .cx-forma").forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll("#rc-formas .cx-forma").forEach((x) => x.classList.remove("ativa"));
        b.classList.add("ativa"); forma = b.dataset.f;
        const ehCartao = forma === "cartao";
        blocoCartao.style.display = ehCartao ? "" : "none";
        if (ehCartao) recalcCartao();
      };
    });
    ["rc-modalidade", "rc-bandeira", "rc-parcelas", "rc-valor"].forEach((id) =>
      document.getElementById(id).addEventListener("change", recalcCartao));

    document.getElementById("rc-ok").onclick = async () => {
      const valor_pago = parseFloat(document.getElementById("rc-valor").value) || 0;
      const body = { forma_pagamento: forma, valor_pago };
      if (forma === "cartao") {
        body.cartao_modalidade = document.getElementById("rc-modalidade").value;
        body.cartao_bandeira = document.getElementById("rc-bandeira").value.trim();
        body.cartao_parcelas = parseInt(document.getElementById("rc-parcelas").value) || 1;
        body.cartao_taxa = liquidoInfo ? liquidoInfo.percentual : 0;
        body.cartao_valor_liquido = liquidoInfo ? liquidoInfo.valor_liquido : valor_pago;
      }
      try {
        await cx("POST", `/api/caixa/receber/${fid}`, body);
        Modal.fechar(); toast("Recebimento registrado"); boot();
      } catch (e) { toast(e.message, "error"); }
    };
  }

  /* ------------------------------------------------- sangria / suprimento */
  function movimento(tipo) {
    const titulo = tipo === "sangria" ? "Sangria (retirada)" : "Suprimento (reforço)";
    Modal.abrir(titulo, `
      <label class="cx-campo"><span>Valor</span>
        <input id="mv-valor" type="number" step="0.01" value="0"></label>
      <label class="cx-campo"><span>Motivo</span>
        <input id="mv-motivo" placeholder="${tipo === "sangria" ? "Ex: retirada para banco" : "Ex: troco adicional"}"></label>`,
      `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
       <button class="btn btn--primary" id="mv-ok"><i class="fa-solid fa-check"></i> Confirmar</button>`);
    document.getElementById("mv-ok").onclick = async () => {
      const valor = parseFloat(document.getElementById("mv-valor").value) || 0;
      const motivo = document.getElementById("mv-motivo").value.trim();
      try {
        await cx("POST", "/api/caixa/movimento", { tipo, valor, motivo });
        Modal.fechar(); toast(titulo + " registrada"); boot();
      } catch (e) { toast(e.message, "error"); }
    };
  }

  /* ----------------------------------------------------------- fechar */
  function fecharCaixa(t) {
    Modal.abrir("Fechar caixa", `
      <p class="text-muted">Saldo esperado na gaveta: <b>${money(t.saldo)}</b></p>
      <label class="cx-campo"><span>Valor conferido (contado na gaveta)</span>
        <input id="fc-valor" type="number" step="0.01" value="${Number(t.saldo).toFixed(2)}"></label>`,
      `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
       <button class="btn btn--danger-ghost" id="fc-ok"><i class="fa-solid fa-lock"></i> Fechar caixa</button>`);
    document.getElementById("fc-ok").onclick = async () => {
      const valor_informado = parseFloat(document.getElementById("fc-valor").value) || 0;
      try {
        const r = await cx("POST", "/api/caixa/fechar", { valor_informado });
        Modal.fechar(); relatorioFechamento(r.relatorio);
      } catch (e) { toast(e.message, "error"); }
    };
  }

  function relatorioFechamento(r) {
    const dif = r.diferenca;
    const corDif = dif === 0 ? "" : (dif > 0 ? "cx-dif--sobra" : "cx-dif--falta");
    const rotuloDif = dif === 0 ? "Fechou certinho" : (dif > 0 ? "Sobra" : "Falta");
    const html = `
      <div class="cx-rel" id="cx-rel">
        <h3>Relatório do caixa</h3>
        <div class="cx-rel__l"><span>Abertura</span><b>${money(r.abertura)}</b></div>
        <div class="cx-rel__l"><span>Recebimentos (${r.qtd_recebimentos})</span><b>${money(r.recebimentos)}</b></div>
        ${r.vendas ? `<div class="cx-rel__l"><span>Vendas</span><b>${money(r.vendas)}</b></div>` : ""}
        <div class="cx-rel__l"><span>Suprimentos</span><b>${money(r.suprimentos)}</b></div>
        <div class="cx-rel__l"><span>Sangrias</span><b>- ${money(r.sangrias)}</b></div>
        <div class="cx-rel__l cx-rel__esp"><span>Saldo esperado</span><b>${money(r.esperado)}</b></div>
        <div class="cx-rel__l"><span>Valor conferido</span><b>${money(r.informado)}</b></div>
        <div class="cx-rel__l cx-rel__dif ${corDif}"><span>${rotuloDif}</span><b>${money(Math.abs(dif))}</b></div>
      </div>`;
    Modal.abrir("Caixa fechado", html,
      `<button class="btn btn--ghost" id="cx-imprimir-rel"><i class="fa-solid fa-print"></i> Imprimir</button>
       <button class="btn btn--primary" onclick="Modal.fechar();window.__cx.recarregar()"><i class="fa-solid fa-check"></i> Concluir</button>`);
    document.getElementById("cx-imprimir-rel").onclick = () => {
      const w = window.open("", "_blank");
      w.document.write(`<html><head><meta charset="utf-8"><title>Fechamento de caixa</title>
        <style>body{font-family:Arial;padding:24px;max-width:360px}h3{color:#0d9488}
        .l{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #eee}
        .esp{font-weight:bold}.dif{font-weight:bold;color:${dif < 0 ? "#c0392b" : "#0d9488"}}</style></head>
        <body><h3>${cfg.empresa_nome || "Caixa"} — Fechamento</h3>
        <div class="l"><span>Operador</span><b>${operador}</b></div>
        ${document.getElementById("cx-rel").innerHTML.replace(/cx-rel__l/g, "l").replace(/cx-rel__esp/g, "esp").replace(/cx-rel__dif [a-z-]*/g, "dif").replace("<h3>Relatório do caixa</h3>", "")}
        </body></html>`);
      w.document.close();
      setTimeout(() => w.print(), 400);
    };
  }

  const api = { receber, recarregar: boot };
  await boot();
})();
