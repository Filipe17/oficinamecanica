
/* ---- utilitários embutidos (sem depender do app.js) ---- */
const Modal = {
  abrir(titulo, htmlCorpo, htmlRodape = "", grande = false) {
    this.fechar();
    const bd = document.createElement("div");
    bd.className = "modal-backdrop";
    bd.id = "modal-atual";
    bd.innerHTML = `
      <div class="modal ${grande ? "modal--lg" : ""}">
        <div class="modal__head">
          <div class="modal__title">${titulo}</div>
          <button class="modal__close" onclick="Modal.fechar()">&times;</button>
        </div>
        <div class="modal__body">${htmlCorpo}</div>
        ${htmlRodape ? `<div class="modal__foot">${htmlRodape}</div>` : ""}
      </div>`;
    document.body.appendChild(bd);
    requestAnimationFrame(() => bd.classList.add("open"));
    return bd;
  },
  fechar() {
    const bd = document.getElementById("modal-atual");
    if (bd) { bd.classList.remove("open"); setTimeout(() => bd.remove(), 200); }
  },
};

function toast(msg, tipo = "success") {
  const el = document.createElement("div");
  el.className = "toast toast--" + tipo;
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, 3200);
}

function debounce(fn, ms = 350) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
/* --------------------------------------------------------- */

/* =======================================================================
   caixa.js — Caixa integrado ao painel administrativo.
   Abre em aba separada com login próprio (token em sessionStorage).
   Usa o mesmo banco, Modal e toast do painel.

   - Aguardando pagamento: cobranças geradas pelo "Finalizar orçamento".
   - Receber pagamento: formas simples ou mistas, troco, Pix manual,
     cartão (sem dados sensíveis), documento fiscal conforme configuração.
   - Histórico, estorno (admin/gerente), entradas/saídas e fechamento.
   ======================================================================= */
(async () => {
  /* ---------- token e fetch próprios do caixa ---------- */
  const TOKEN_KEY = "cx_token";
  const getToken = () => sessionStorage.getItem(TOKEN_KEY);
  const setToken = (t) => sessionStorage.setItem(TOKEN_KEY, t);
  const delToken = () => sessionStorage.removeItem(TOKEN_KEY);

  async function cx(method, path, body) {
    const opts = {
      method,
      headers: { "Content-Type": "application/json", "X-Caixa-Token": getToken() || "" },
      credentials: "same-origin",
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const resp = await fetch(path, opts);
    let dados = null;
    try { dados = await resp.json(); } catch (_) {}
    if (resp.status === 401) { delToken(); location.reload(); return; }
    if (!resp.ok) throw new Error((dados && dados.erro) || `Erro ${resp.status}`);
    return dados;
  }

  // Sobrescreve API para usar o token do caixa
  const API = {
    get: (u) => cx("GET", u),
    post: (u, b) => cx("POST", u, b),
    put: (u, b) => cx("PUT", u, b),
    del: (u) => cx("DELETE", u),
  };

  /* ---------- login próprio ---------- */
  async function telaLogin(aviso) {
    // Busca marca da empresa
    let marca = {};
    try { marca = await fetch("/api/marca").then((r) => r.json()); } catch (_) {}
    document.body.innerHTML = `
      <div class="login-wrap">
        <div class="login-side">
          <svg class="login-side__s" viewBox="0 0 300 380" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
            <path d="M 40 320 L 40 60 L 150 240 L 260 60 L 260 320" fill="none" stroke="currentColor"
              stroke-width="56" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <div class="login-side__brand">
            <div class="login-brand__nome">Mec<span>PRIME</span></div>
            <p class="login-brand__tag">Seu negócio, nosso sistema</p>
          </div>
        </div>
        <div class="login-form-side">
          <div class="login-card">
            <div class="login-card__marca">
              ${marca.empresa_logo ? `<img class="login-card__logo" src="${marca.empresa_logo}" alt="">` : ""}
              ${marca.empresa_nome ? `<div class="login-card__nome">${marca.empresa_nome}</div>` : ""}
            </div>
            <h2 class="login-title">Caixa</h2>
            <p class="login-sub">Entre com seu usuário de caixa</p>
            ${aviso ? `<div class="cx-erro">${aviso}</div>` : ""}
            <div class="login-group"><label>Usuário</label>
              <input class="login-input" id="lg-user" type="text" autocomplete="username" autocapitalize="none"></div>
            <div class="login-group"><label>Senha</label>
              <div class="login-inp">
                <input class="login-input" id="lg-senha" type="password" autocomplete="current-password">
                <button type="button" class="login-eye" id="lg-eye"><i class="fa-solid fa-eye"></i></button>
              </div></div>
            <button class="login-btn" id="lg-ok"><i class="fa-solid fa-right-to-bracket"></i> Entrar no caixa</button>
          </div>
        </div>
      </div>`;
    document.getElementById("lg-eye").onclick = () => {
      const i = document.getElementById("lg-senha");
      i.type = i.type === "password" ? "text" : "password";
    };
    const entrar = async () => {
      const email = document.getElementById("lg-user").value.trim();
      const senha = document.getElementById("lg-senha").value;
      try {
        const r = await fetch("/api/caixa/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, senha }),
        }).then((r) => r.json().then((d) => { if (!r.ok) throw new Error(d.erro); return d; }));
        setToken(r.token);
        location.reload();
      } catch (e) { telaLogin(e.message || "Falha no login"); }
    };
    document.getElementById("lg-ok").onclick = entrar;
    document.addEventListener("keydown", (e) => { if (e.key === "Enter") entrar(); }, { once: true });
  }

  /* ---------- verificar se tem token válido ---------- */
  if (!getToken()) { telaLogin(); return; }
  // testa o token silenciosamente
  let st;
  try { st = await cx("GET", "/api/caixa/status"); }
  catch (_) { telaLogin("Sessão expirada. Faça login novamente."); return; }

  /* ---------- montar casca da página com Layout mínimo ---------- */
  let marca = {};
  try { marca = await fetch("/api/marca").then((r) => r.json()); } catch (_) {}
  const cfg = st.config || marca;

  function montarCasca() {
    document.body.innerHTML = `
      <div class="caixa-body" style="min-height:100vh;background:var(--bg)">
        <header class="cx-top">
          <div class="cx-marca">
            ${cfg.empresa_logo ? `<img src="${cfg.empresa_logo}" alt="">` : `<i class="fa-solid fa-cash-register"></i>`}
            <div><b>${cfg.empresa_nome || "Caixa"}</b><span>Sistema de Caixa</span></div>
          </div>
          <div class="cx-op">
            <span><i class="fa-solid fa-user"></i> ${st.operador || ""}</span>
            <span><i class="fa-solid fa-calendar"></i> ${new Date().toLocaleDateString("pt-BR")}</span>
            <button class="btn btn--outline btn--sm" onclick="window.__cx.sair()">
              <i class="fa-solid fa-right-from-bracket"></i> Sair</button>
          </div>
        </header>
        <div id="cx-corpo" style="max-width:1200px;margin:0 auto;padding:20px"></div>
      </div>`;
  }
  montarCasca();

  // Adaptar Layout.set para o container do caixa
  const Layout = {
    usuario: { nome: st.operador, perfil: "caixa" },
    config: cfg,
    permissoes: {},
    set: (html) => { document.getElementById("cx-corpo").innerHTML = html; },
    enderecoLinhas: () => {
      const c = cfg;
      const rua = [c.empresa_endereco, c.empresa_numero].filter(Boolean).join(", ");
      const l1 = [rua, c.empresa_bairro].filter(Boolean).join(" - ");
      const cidUf = [c.empresa_cidade, c.empresa_estado].filter(Boolean).join("/");
      const l2 = [c.empresa_cep ? "CEP: " + c.empresa_cep : "", cidUf].filter(Boolean).join(" - ");
      return [l1, l2].filter(Boolean);
    },
  };
  const fmt = {
    moeda: (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
    data: (v) => { if (!v) return "-"; const d = new Date(v.replace(" ", "T")); return isNaN(d) ? v : d.toLocaleDateString("pt-BR"); },
    dataHora: (v) => { if (!v) return "-"; const d = new Date(v.replace(" ", "T")); return isNaN(d) ? v : d.toLocaleString("pt-BR"); },
  };

  const money = (v) => fmt.moeda(v);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v) => {
    if (typeof v === "number") return v;
    const s = String(v || "").trim();
    if (!s) return 0;
    const n = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
    return Math.round((parseFloat(n) || 0) * 100) / 100;
  };
  const hojeISO = () => new Date().toISOString().slice(0, 10);

  const FORMAS = [
    { id: "dinheiro", nome: "Dinheiro", icone: "fa-money-bill-wave" },
    { id: "pix", nome: "Pix", icone: "fa-brands fa-pix" },
    { id: "debito", nome: "Cartão de débito", icone: "fa-credit-card" },
    { id: "credito", nome: "Cartão de crédito", icone: "fa-credit-card" },
    { id: "transferencia", nome: "Transferência", icone: "fa-building-columns" },
    { id: "outros", nome: "Outros", icone: "fa-ellipsis" },
  ];
  const nomeForma = (id) => (FORMAS.find((f) => f.id === id) || { nome: id || "-" }).nome;
  const iconeForma = (id) => {
    const f = FORMAS.find((x) => x.id === id);
    if (!f) return "fa-solid fa-circle";
    return f.icone.startsWith("fa-brands") ? f.icone : "fa-solid " + f.icone;
  };
  const BANDEIRAS = ["Visa", "Mastercard", "Elo", "Hipercard", "American Express", "Outra"];

  // st já declarado no boot
  let aba = "aguardando";
  let aguardando = [];

  /* ------------------------------------------------------------ carregar */
  // carregar definido acima

  const podeOperar = () => (st?.nivel || 0) >= 2;

  function sair() { delToken(); location.reload(); }

  function render() {
    const aberto = st.aberto;
    const c = st.caixa || {};
    const t = st.totais || {};
    Layout.set(`
      <div class="page-head cx-head">
        <div>
          <h1><i class="fa-solid fa-cash-register"></i> Caixa</h1>
          <div class="cx-info">
            <span class="cx-status ${aberto ? "cx-status--on" : "cx-status--off"}">
              <i class="fa-solid fa-circle"></i> Caixa ${aberto ? "aberto" : "fechado"}</span>
            <span>Operador: <b>${esc(st.operador)}</b></span>
            <span>Data: <b>${new Date().toLocaleDateString("pt-BR")}</b></span>
            ${aberto ? `<span>Abertura: <b>${fmt.dataHora(c.aberto_em)}</b></span>
                        <span>Saldo inicial: <b>${money(t.abertura)}</b></span>` : ""}
          </div>
        </div>
        <div class="cx-head__acoes">
          ${podeOperar() && aberto ? `
            <button class="btn btn--success" id="cx-entrada"><i class="fa-solid fa-plus"></i> Nova entrada</button>
            <button class="btn btn--danger" id="cx-saida"><i class="fa-solid fa-minus"></i> Nova saída</button>
            <button class="btn btn--primary" id="cx-fechar"><i class="fa-solid fa-lock"></i> Fechar caixa</button>` : ""}
          ${podeOperar() && !aberto ? `
            <button class="btn btn--primary" id="cx-abrir"><i class="fa-solid fa-lock-open"></i> Abrir caixa</button>` : ""}
        </div>
      </div>

      ${aberto ? `
      <div class="cx-cards">
        <div class="cx-card"><span><i class="fa-solid fa-coins"></i> Saldo inicial</span><b>${money(t.abertura)}</b></div>
        <div class="cx-card cx-card--in"><span><i class="fa-solid fa-arrow-down"></i> Entradas</span><b>${money(t.entradas)}</b></div>
        <div class="cx-card cx-card--out"><span><i class="fa-solid fa-arrow-up"></i> Saídas</span><b>${money(t.saidas)}</b></div>
        <div class="cx-card"><span><i class="fa-solid fa-hand-holding-dollar"></i> Total recebido</span><b>${money(t.total_recebido)}</b></div>
        <div class="cx-card cx-card--saldo"><span><i class="fa-solid fa-wallet"></i> Saldo atual</span><b>${money(t.saldo)}</b></div>
      </div>
      <div class="cx-formas-resumo">
        ${[["dinheiro", "Dinheiro"], ["pix", "Pix"], ["debito", "Débito"], ["credito", "Crédito"], ["outros", "Outros"]].map(([k, r]) => {
          const v = k === "outros" ? (t.por_forma.outros + t.por_forma.transferencia) : t.por_forma[k];
          return `<div class="cx-fr"><i class="${iconeForma(k)}"></i><span>${r}</span><b>${money(v)}</b></div>`;
        }).join("")}
      </div>` : `
      <div class="card"><div class="card__body cx-fechado">
        <i class="fa-solid fa-cash-register"></i>
        <h3>O caixa está fechado</h3>
        <p class="text-muted">${podeOperar()
          ? "Abra o caixa informando o saldo inicial para começar a receber."
          : "Você pode consultar as cobranças e o histórico, mas não tem permissão para operar o caixa."}</p>
      </div></div>`}

      <div class="card"><div class="card__body">
        <div class="cx-tabs">
          <button class="cx-tab ${aba === "aguardando" ? "ativa" : ""}" data-aba="aguardando">
            <i class="fa-solid fa-hourglass-half"></i> Aguardando pagamento <span class="cx-tab__n" id="cx-n-ag"></span></button>
          <button class="cx-tab ${aba === "historico" ? "ativa" : ""}" data-aba="historico">
            <i class="fa-solid fa-clock-rotate-left"></i> Histórico de pagamentos</button>
          ${aberto ? `<button class="cx-tab ${aba === "movimentos" ? "ativa" : ""}" data-aba="movimentos">
            <i class="fa-solid fa-list"></i> Movimentações do caixa</button>` : ""}
        </div>
        <div id="cx-aba"></div>
      </div></div>
    `);

    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    on("cx-abrir", abrirCaixa);
    on("cx-fechar", fecharCaixa);
    on("cx-entrada", () => movimento("suprimento"));
    on("cx-saida", () => movimento("sangria"));
    document.querySelectorAll(".cx-tab").forEach((b) => b.onclick = () => {
      aba = b.dataset.aba;
      document.querySelectorAll(".cx-tab").forEach((x) => x.classList.toggle("ativa", x === b));
      renderAba();
    });
    renderAba();
    atualizarContador();
  }

  async function atualizarContador() {
    try {
      const r = await API.get("/api/caixa/receber");
      const el = document.getElementById("cx-n-ag");
      if (el) el.textContent = r.dados.length || "";
    } catch (_) {}
  }

  function renderAba() {
    if (aba === "historico") return abaHistorico();
    if (aba === "movimentos") return abaMovimentos();
    return abaAguardando();
  }

  /* ------------------------------------------------ aguardando pagamento */
  function abaAguardando() {
    document.getElementById("cx-aba").innerHTML = `
      <div class="cx-filtros">
        <div class="toolbar__search"><i class="fa-solid fa-magnifying-glass"></i>
          <input id="ag-q" placeholder="Nº da OS, cliente ou placa…"></div>
        <label class="cx-f"><span>Data</span><input type="date" id="ag-data"></label>
      </div>
      <div id="ag-lista"><div class="loading"><i class="fa-solid fa-spinner spin"></i> Carregando…</div></div>`;
    const buscar = debounce(listarAguardando, 300);
    document.getElementById("ag-q").oninput = buscar;
    document.getElementById("ag-data").onchange = listarAguardando;
    listarAguardando();
  }

  async function listarAguardando() {
    const q = document.getElementById("ag-q")?.value || "";
    const data = document.getElementById("ag-data")?.value || "";
    const box = document.getElementById("ag-lista");
    try {
      const r = await API.get(`/api/caixa/receber?q=${encodeURIComponent(q)}&data=${data}`);
      aguardando = r.dados;
    } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    if (!aguardando.length) {
      box.innerHTML = `<div class="empty"><i class="fa-solid fa-circle-check"></i>Nenhum orçamento aguardando pagamento.</div>`;
      return;
    }
    box.innerHTML = `<div class="table-wrap"><table class="data">
      <thead><tr><th>OS</th><th>Cliente</th><th>Veículo</th><th>Placa</th><th>Data</th>
        <th class="text-right">Valor</th><th>Status</th><th></th></tr></thead>
      <tbody>${aguardando.map((c) => `<tr>
        <td><b>${esc(c.os_numero)}</b></td>
        <td>${esc(c.cliente_nome || "-")}</td>
        <td>${esc([c.veiculo_marca, c.veiculo_modelo].filter(Boolean).join(" ") || "-")}</td>
        <td>${esc(c.veiculo_placa || "-")}</td>
        <td>${fmt.data(c.criado_em)}</td>
        <td class="text-right"><b>${money(c.restante)}</b></td>
        <td>${c.status === "parcial" ? `<span class="badge badge--warning">Pago parcialmente</span>`
             : c.status === "atrasado" ? `<span class="badge badge--danger">Vencido</span>`
             : `<span class="badge badge--warning">Aguardando pagamento</span>`}</td>
        <td class="text-right">${st.aberto && podeOperar()
          ? `<button class="btn btn--success btn--sm" onclick="window.__cx.receber(${c.id})">
               <i class="fa-solid fa-hand-holding-dollar"></i> Receber pagamento</button>`
          : `<span class="text-muted" title="${st.aberto ? "Sem permissão" : "Abra o caixa para receber"}">
               <i class="fa-solid fa-lock"></i></span>`}</td>
      </tr>`).join("")}</tbody></table></div>`;
  }

  /* ------------------------------------------------------ receber pagamento */
  async function receber(fid) {
    let c;
    try { c = await API.get(`/api/caixa/receber/${fid}`); }
    catch (e) { toast(e.message, "error"); return; }
    const total = c.resumo.total;
    const linhas = [];          // formas escolhidas
    const nfceAtiva = Layout.config?.nfce_ativo === "1";
    const veiculo = [c.veiculo_marca, c.veiculo_modelo].filter(Boolean).join(" ");

    Modal.abrir(`Receber pagamento — ${esc(c.os_numero)}`, `
      <div class="rc">
        <div class="rc__main">
          <div class="rc-id">
            <div><span>OS</span><b>${esc(c.os_numero)}</b></div>
            <div><span>Cliente</span><b>${esc(c.cliente_nome || "-")}</b>
              ${c.cliente_doc ? `<small>${esc(c.cliente_doc)}</small>` : ""}</div>
            <div><span>Veículo</span><b>${esc(veiculo || "-")}</b>
              ${c.veiculo_placa ? `<small>Placa ${esc(c.veiculo_placa)}</small>` : ""}</div>
            <div><span>Data da OS</span><b>${fmt.data(c.os_data || c.criado_em)}</b></div>
          </div>

          <div class="rc-tit">Forma de pagamento <small>clique em mais de uma para pagamento misto</small></div>
          <div class="rc-formas">
            ${FORMAS.map((f) => `<button type="button" class="rc-forma" data-forma="${f.id}">
              <i class="${iconeForma(f.id)}"></i><span>${f.nome}</span></button>`).join("")}
          </div>
          <div id="rc-linhas"></div>

          <div class="rc-tit">Documento fiscal</div>
          <div class="rc-fiscal">
            <label><input type="radio" name="rc-nf" value="nao" checked> Não emitir agora</label>
            <label class="${nfceAtiva ? "" : "rc-off"}" title="${nfceAtiva ? "" : "A emissão de NFC-e não está ativa em Configurações"}">
              <input type="radio" name="rc-nf" value="nfce" ${nfceAtiva ? "" : "disabled"}> Emitir NFC-e</label>
            ${nfceAtiva ? "" : `<small class="text-muted">A emissão fiscal segue a configuração da oficina. Ative e configure em Configurações → Nota Fiscal.</small>`}
          </div>
        </div>

        <aside class="rc__lado">
          <div class="rc-tit">Resumo do orçamento</div>
          <div class="rc-l"><span>Serviços</span><b>${money(c.resumo.servicos)}</b></div>
          <div class="rc-l"><span>Peças</span><b>${money(c.resumo.pecas)}</b></div>
          <div class="rc-l"><span>Desconto</span><b>− ${money(c.resumo.desconto)}</b></div>
          <div class="rc-l"><span>Acréscimo</span><b>+ ${money(c.resumo.acrescimo)}</b></div>
          ${c.resumo.ja_pago ? `<div class="rc-l"><span>Já pago</span><b>− ${money(c.resumo.ja_pago)}</b></div>` : ""}
          <div class="rc-l rc-l--total"><span>Total</span><b>${money(total)}</b></div>
          <div class="rc-sep"></div>
          <div class="rc-l"><span>Total informado</span><b id="rc-inf">${money(0)}</b></div>
          <div class="rc-l"><span id="rc-falta-l">Falta</span><b id="rc-falta">${money(total)}</b></div>
          <div class="rc-l" id="rc-troco-l" style="display:none"><span>Troco</span><b id="rc-troco"></b></div>
          <div class="rc-situacao" id="rc-sit">Escolha a forma de pagamento</div>
          <p class="rc-aviso"><i class="fa-solid fa-circle-info"></i> Os itens do orçamento não podem ser alterados no caixa.</p>
        </aside>
      </div>`,
      `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
       <button class="btn btn--success" id="rc-ok" disabled><i class="fa-solid fa-check"></i> Confirmar pagamento</button>`,
      true);

    const restante = () => Math.round((total - linhas.reduce((s, l) => s + num(l.valor), 0)) * 100) / 100;

    function addForma(forma) {
      const falta = Math.max(restante(), 0);
      linhas.push({ forma, valor: falta || 0, valor_recebido: "", parcelas: 1, bandeira: "", confirmado: false, observacao: "" });
      pintarLinhas();
    }
    document.querySelectorAll(".rc-forma").forEach((b) => b.onclick = () => addForma(b.dataset.forma));

    function pintarLinhas() {
      const box = document.getElementById("rc-linhas");
      box.innerHTML = linhas.map((l, i) => {
        const v = (x) => (x === "" || x == null) ? "" : Number(x).toFixed(2).replace(".", ",");
        let extra = "";
        if (l.forma === "dinheiro") {
          const troco = Math.max(num(l.valor_recebido) - num(l.valor), 0);
          extra = `
            <label class="cx-f"><span>Valor recebido</span>
              <input data-i="${i}" data-c="valor_recebido" inputmode="decimal" value="${v(l.valor_recebido)}" placeholder="${v(l.valor)}"></label>
            <div class="rc-troco"><span>Troco</span><b id="rc-tr-${i}">${money(troco)}</b></div>`;
        } else if (l.forma === "pix" || l.forma === "transferencia") {
          extra = `
            <div class="rc-pix ${l.confirmado ? "ok" : ""}">
              <span>${l.confirmado ? `<i class="fa-solid fa-circle-check"></i> Confirmado por ${esc(st.operador)}`
                                   : `<i class="fa-solid fa-clock"></i> Aguardando confirmação`}</span>
              <label><input type="checkbox" data-i="${i}" data-c="confirmado" ${l.confirmado ? "checked" : ""}>
                Confirmo que o valor foi recebido na conta</label>
            </div>`;
        } else if (l.forma === "debito" || l.forma === "credito") {
          extra = `
            <label class="cx-f"><span>Bandeira</span>
              <select data-i="${i}" data-c="bandeira"><option value="">Selecione</option>
                ${BANDEIRAS.map((b) => `<option ${l.bandeira === b ? "selected" : ""}>${b}</option>`).join("")}</select></label>
            ${l.forma === "credito" ? `<label class="cx-f"><span>Parcelas</span>
              <select data-i="${i}" data-c="parcelas">
                ${Array.from({ length: 12 }, (_, k) => k + 1).map((p) =>
                  `<option value="${p}" ${Number(l.parcelas) === p ? "selected" : ""}>${p}x de ${money(num(l.valor) / p)}</option>`).join("")}
              </select></label>` : ""}`;
        } else {
          extra = `<label class="cx-f rc-grow"><span>Observação</span>
            <input data-i="${i}" data-c="observacao" value="${esc(l.observacao)}" placeholder="Ex.: cheque, vale…"></label>`;
        }
        return `<div class="rc-linha">
          <div class="rc-linha__tit"><i class="${iconeForma(l.forma)}"></i> ${nomeForma(l.forma)}
            <button type="button" class="icon-btn btn--sm" data-rm="${i}" title="Remover"><i class="fa-solid fa-xmark"></i></button></div>
          <div class="rc-linha__campos">
            <label class="cx-f"><span>Valor</span>
              <input data-i="${i}" data-c="valor" inputmode="decimal" value="${v(l.valor)}"></label>
            ${extra}
          </div></div>`;
      }).join("");
      box.querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => { linhas.splice(+b.dataset.rm, 1); pintarLinhas(); });
      box.querySelectorAll("[data-c]").forEach((el) => {
        const i = +el.dataset.i, campo = el.dataset.c;
        const ev = el.type === "checkbox" || el.tagName === "SELECT" ? "change" : "input";
        el.addEventListener(ev, () => {
          linhas[i][campo] = el.type === "checkbox" ? el.checked : el.value;
          if (el.type === "checkbox") return pintarLinhas();
          const l = linhas[i];
          const tr = document.getElementById(`rc-tr-${i}`);
          if (tr) tr.textContent = money(Math.max(num(l.valor_recebido) - num(l.valor), 0));
          const parc = document.querySelector(`select[data-i="${i}"][data-c="parcelas"]`);
          if (parc && campo === "valor") [...parc.options].forEach((o) =>
            o.textContent = `${o.value}x de ${money(num(l.valor) / Number(o.value))}`);
          atualizarResumo();
        });
      });
      atualizarResumo();
    }

    function validar() {
      if (!linhas.length) return "Escolha a forma de pagamento";
      for (const l of linhas) {
        if (num(l.valor) <= 0) return `Informe o valor em ${nomeForma(l.forma)}`;
        if (l.forma === "dinheiro" && l.valor_recebido !== "" && num(l.valor_recebido) < num(l.valor))
          return "Valor recebido em dinheiro menor que o valor da compra";
        if ((l.forma === "pix" || l.forma === "transferencia") && !l.confirmado)
          return `${nomeForma(l.forma)} aguardando confirmação`;
      }
      const r = restante();
      if (r > 0.009) return `Faltam ${money(r)}`;
      if (r < -0.009) return `Valor informado passa ${money(-r)} do total`;
      return "";
    }

    function atualizarResumo() {
      const inf = linhas.reduce((s, l) => s + num(l.valor), 0);
      const r = restante();
      const troco = linhas.filter((l) => l.forma === "dinheiro")
        .reduce((s, l) => s + Math.max(num(l.valor_recebido) - num(l.valor), 0), 0);
      document.getElementById("rc-inf").textContent = money(inf);
      document.getElementById("rc-falta-l").textContent = r >= 0 ? "Falta" : "Excedente";
      document.getElementById("rc-falta").textContent = money(Math.abs(r));
      document.getElementById("rc-troco-l").style.display = troco > 0 ? "" : "none";
      document.getElementById("rc-troco").textContent = money(troco);
      const erro = validar();
      const sit = document.getElementById("rc-sit");
      sit.className = "rc-situacao " + (erro ? "" : "ok");
      sit.innerHTML = erro ? esc(erro) : `<i class="fa-solid fa-circle-check"></i> Pagamento completo`;
      document.getElementById("rc-ok").disabled = !!erro;
    }

    document.getElementById("rc-ok").onclick = async () => {
      const btn = document.getElementById("rc-ok");
      if (validar()) return;
      btn.disabled = true;
      btn.innerHTML = `<i class="fa-solid fa-spinner spin"></i> Registrando…`;
      const nf = document.querySelector("input[name=rc-nf]:checked")?.value;
      try {
        const r = await API.post(`/api/caixa/receber/${fid}`, {
          formas: linhas.map((l) => ({
            forma: l.forma, valor: num(l.valor),
            valor_recebido: l.forma === "dinheiro" ? (l.valor_recebido === "" ? num(l.valor) : num(l.valor_recebido)) : null,
            parcelas: Number(l.parcelas) || 1, bandeira: l.bandeira || null,
            confirmado: !!l.confirmado, observacao: l.observacao || null,
          })),
        });
        let nfMsg = "";
        if (nf === "nfce") {
          try {
            const e = await API.post("/api/nfce/emitir", { financeiro_id: fid, cpf_cnpj_consumidor: c.cliente_doc || "" });
            nfMsg = e?.ok ? "NFC-e enviada para emissão." : (e?.erro || "");
          } catch (e) { nfMsg = "Documento fiscal não emitido: " + e.message; }
        }
        toast("Pagamento registrado");
        posPagamento(r.pagamento_id, r.troco, nfMsg);
        st.totais = r.totais;
      } catch (e) {
        toast(e.message, "error");
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-check"></i> Confirmar pagamento`;
      }
    };
    atualizarResumo();
  }

  function posPagamento(pid, troco, nfMsg) {
    Modal.abrir("Pagamento confirmado", `
      <div class="cx-ok">
        <i class="fa-solid fa-circle-check"></i>
        <h3>Pagamento registrado com sucesso</h3>
        <p>A OS foi marcada como <b>paga</b> e saiu da lista de aguardando pagamento.</p>
        ${troco > 0 ? `<div class="cx-ok__troco">Troco a devolver: <b>${money(troco)}</b></div>` : ""}
        ${nfMsg ? `<p class="text-muted"><i class="fa-solid fa-file-invoice"></i> ${esc(nfMsg)}</p>` : ""}
      </div>`,
      `<button class="btn btn--outline" onclick="window.__cx.imprimir(${pid})"><i class="fa-solid fa-print"></i> Imprimir comprovante</button>
       <button class="btn btn--outline" onclick="window.__cx.enviar(${pid})"><i class="fa-brands fa-whatsapp"></i> Enviar comprovante</button>
       <button class="btn btn--primary" onclick="Modal.fechar();window.__cx.recarregar()"><i class="fa-solid fa-check"></i> Finalizar</button>`);
  }

  /* ------------------------------------------------------------ comprovante */
  async function dadosPagamento(pid) {
    try { return await API.get(`/api/caixa/pagamento/${pid}`); }
    catch (e) { toast(e.message, "error"); return null; }
  }

  function textoFormas(p) {
    return p.formas.map((f) => {
      let t = `${nomeForma(f.forma)}: ${money(f.valor)}`;
      if (f.forma === "credito" && f.parcelas > 1) t += ` (${f.parcelas}x)`;
      if (f.bandeira) t += ` ${f.bandeira}`;
      return t;
    });
  }

  async function imprimir(pid) {
    const p = await dadosPagamento(pid);
    if (!p) return;
    const cfg = Layout.config || {};
    const serv = p.itens.filter((i) => i.tipo === "servico");
    const pecas = p.itens.filter((i) => i.tipo !== "servico");
    const bloco = (tit, it) => it.length ? `<div class="t">${tit}</div>${it.map((i) =>
      `<div class="l"><span>${esc(i.quantidade)}x ${esc(i.descricao)}</span><span>${money(i.subtotal)}</span></div>`).join("")}` : "";
    const w = window.open("", "_blank", "width=420,height=700");
    if (!w) { toast("Permita pop-ups para imprimir", "error"); return; }
    w.document.write(`<html><head><title>Comprovante ${esc(p.os_numero || "")}</title><style>
      body{font-family:Arial,sans-serif;font-size:12px;width:300px;margin:10px auto;color:#000}
      h2{font-size:14px;margin:0;text-align:center} .c{text-align:center} .t{font-weight:bold;margin-top:8px;border-top:1px dashed #000;padding-top:6px}
      .l{display:flex;justify-content:space-between;gap:8px} .tot{font-size:14px;font-weight:bold}
      .est{border:2px solid #000;text-align:center;font-weight:bold;padding:4px;margin:8px 0}
    </style></head><body>
      <h2>${esc(cfg.empresa_nome || "Oficina")}</h2>
      <div class="c">${cfg.empresa_cnpj ? "CNPJ: " + esc(cfg.empresa_cnpj) + "<br>" : ""}
        ${Layout.enderecoLinhas().map(esc).join("<br>")}${cfg.empresa_telefone ? "<br>Tel: " + esc(cfg.empresa_telefone) : ""}</div>
      <div class="t c">COMPROVANTE DE PAGAMENTO<br><small>Não é documento fiscal</small></div>
      ${p.status === "estornado" ? `<div class="est">PAGAMENTO ESTORNADO</div>` : ""}
      <div class="l"><span>OS</span><span>${esc(p.os_numero || "-")}</span></div>
      <div class="l"><span>Cliente</span><span>${esc(p.cliente_nome || "-")}</span></div>
      <div class="l"><span>Veículo</span><span>${esc([p.veiculo_marca, p.veiculo_modelo].filter(Boolean).join(" ") || "-")}</span></div>
      <div class="l"><span>Placa</span><span>${esc(p.veiculo_placa || "-")}</span></div>
      ${bloco("Serviços", serv)}${bloco("Peças", pecas)}
      <div class="t l tot"><span>TOTAL PAGO</span><span>${money(p.valor_total)}</span></div>
      ${textoFormas(p).map((t) => `<div>${esc(t)}</div>`).join("")}
      ${p.troco > 0 ? `<div class="l"><span>Troco</span><span>${money(p.troco)}</span></div>` : ""}
      <div class="t l"><span>Data/hora</span><span>${fmt.dataHora(p.criado_em)}</span></div>
      <div class="l"><span>Operador</span><span>${esc(p.operador_nome || "-")}</span></div>
      ${p.documento_fiscal ? `<div class="l"><span>Doc. fiscal</span><span>${esc(p.documento_fiscal)}</span></div>` : ""}
      <script>window.onload=()=>{window.print();}<\/script></body></html>`);
    w.document.close();
  }

  async function enviar(pid) {
    const p = await dadosPagamento(pid);
    if (!p) return;
    const cfg = Layout.config || {};
    const msg = [
      `*${cfg.empresa_nome || "Oficina"}* — Comprovante de pagamento`,
      `OS: ${p.os_numero || "-"}`,
      `Cliente: ${p.cliente_nome || "-"}`,
      `Veículo: ${[p.veiculo_marca, p.veiculo_modelo].filter(Boolean).join(" ")} ${p.veiculo_placa || ""}`.trim(),
      `Total pago: ${money(p.valor_total)}`,
      ...textoFormas(p),
      `Data: ${fmt.dataHora(p.criado_em)}`,
      "Obrigado pela preferência!",
    ].join("\n");
    const fone = String(p.cliente_whatsapp || p.cliente_telefone || "").replace(/\D/g, "");
    const alvo = fone ? (fone.length <= 11 ? "55" + fone : fone) : "";
    window.open(`https://wa.me/${alvo}?text=${encodeURIComponent(msg)}`, "_blank");
  }

  /* -------------------------------------------------------------- histórico */
  function abaHistorico() {
    document.getElementById("cx-aba").innerHTML = `
      <div class="cx-filtros">
        <div class="toolbar__search"><i class="fa-solid fa-magnifying-glass"></i>
          <input id="h-q" placeholder="Nº da OS, cliente ou placa…"></div>
        <label class="cx-f"><span>De</span><input type="date" id="h-ini" value="${hojeISO()}"></label>
        <label class="cx-f"><span>Até</span><input type="date" id="h-fim" value="${hojeISO()}"></label>
        <label class="cx-f"><span>Forma</span><select id="h-forma"><option value="">Todas</option>
          ${FORMAS.map((f) => `<option value="${f.id}">${f.nome}</option>`).join("")}</select></label>
        <label class="cx-f"><span>Status</span><select id="h-status"><option value="">Todos</option>
          <option value="pago">Pago</option><option value="estornado">Estornado</option></select></label>
      </div>
      <div id="h-lista"></div>`;
    ["h-ini", "h-fim", "h-forma", "h-status"].forEach((id) => document.getElementById(id).onchange = listarHistorico);
    document.getElementById("h-q").oninput = debounce(listarHistorico, 300);
    listarHistorico();
  }

  async function listarHistorico() {
    const g = (id) => encodeURIComponent(document.getElementById(id)?.value || "");
    const box = document.getElementById("h-lista");
    let dados;
    try {
      dados = (await API.get(`/api/caixa/historico?q=${g("h-q")}&data_ini=${g("h-ini")}&data_fim=${g("h-fim")}&forma=${g("h-forma")}&status=${g("h-status")}`)).dados;
    } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    if (!dados.length) { box.innerHTML = `<div class="empty"><i class="fa-solid fa-receipt"></i>Nenhum pagamento no período.</div>`; return; }
    box.innerHTML = `<div class="table-wrap"><table class="data">
      <thead><tr><th>Data</th><th>Hora</th><th>OS</th><th>Cliente</th><th>Forma</th>
        <th class="text-right">Valor</th><th>Operador</th><th>Status</th><th>Doc. fiscal</th><th></th></tr></thead>
      <tbody>${dados.map((p) => `<tr class="${p.status === "estornado" ? "cx-riscado" : ""}">
        <td>${fmt.data(p.criado_em)}</td>
        <td>${(p.criado_em || "").slice(11, 16)}</td>
        <td><b>${esc(p.os_numero || "-")}</b></td>
        <td>${esc(p.cliente_nome || "-")}</td>
        <td>${p.formas.length > 1 ? `<span title="${esc(textoFormas(p).join(" | "))}">Misto (${p.formas.length})</span>`
             : `<i class="${iconeForma(p.formas[0]?.forma)}"></i> ${nomeForma(p.formas[0]?.forma)}`}</td>
        <td class="text-right"><b>${money(p.valor_total)}</b></td>
        <td>${esc(p.operador_nome || "-")}</td>
        <td>${p.status === "estornado" ? `<span class="badge badge--danger">Estornado</span>` : `<span class="badge badge--success">Pago</span>`}</td>
        <td>${esc(p.documento_fiscal || "—")}</td>
        <td class="text-right"><button class="btn btn--outline btn--sm" onclick="window.__cx.detalhes(${p.id})">
          <i class="fa-solid fa-eye"></i> Ver detalhes</button></td>
      </tr>`).join("")}</tbody></table></div>`;
  }

  async function detalhes(pid) {
    const p = await dadosPagamento(pid);
    if (!p) return;
    const podeEstornar = st.pode_estornar && p.status === "pago";
    Modal.abrir(`Pagamento — ${esc(p.os_numero || "")}`, `
      <div class="cx-det">
        <div class="rc-l"><span>Cliente</span><b>${esc(p.cliente_nome || "-")}</b></div>
        <div class="rc-l"><span>Veículo</span><b>${esc([p.veiculo_marca, p.veiculo_modelo, p.veiculo_placa].filter(Boolean).join(" ") || "-")}</b></div>
        <div class="rc-l"><span>Data/hora</span><b>${fmt.dataHora(p.criado_em)}</b></div>
        <div class="rc-l"><span>Operador</span><b>${esc(p.operador_nome || "-")}</b></div>
        <div class="rc-l"><span>Status</span><b>${p.status === "estornado" ? "Estornado" : "Pago"}</b></div>
        <div class="rc-tit">Formas de pagamento</div>
        ${p.formas.map((f) => `<div class="rc-l"><span><i class="${iconeForma(f.forma)}"></i> ${nomeForma(f.forma)}
            ${f.forma === "credito" && f.parcelas > 1 ? ` · ${f.parcelas}x` : ""}${f.bandeira ? ` · ${esc(f.bandeira)}` : ""}
            ${f.confirmado_por_nome ? ` · confirmado por ${esc(f.confirmado_por_nome)}` : ""}
            ${f.forma === "dinheiro" && f.valor_recebido ? ` · recebido ${money(f.valor_recebido)}` : ""}</span>
            <b>${money(f.valor)}</b></div>`).join("")}
        ${p.troco > 0 ? `<div class="rc-l"><span>Troco</span><b>${money(p.troco)}</b></div>` : ""}
        <div class="rc-l rc-l--total"><span>Total</span><b>${money(p.valor_total)}</b></div>
        ${p.status === "estornado" ? `<div class="cx-estorno-info"><b>Estornado</b> por ${esc(p.estornado_por_nome || "-")}
          em ${fmt.dataHora(p.estornado_em)}<br>Motivo: ${esc(p.motivo_estorno)}</div>` : ""}
      </div>`,
      `${podeEstornar ? `<button class="btn btn--danger" onclick="window.__cx.estornar(${p.id})"><i class="fa-solid fa-rotate-left"></i> Estornar</button>` : ""}
       <button class="btn btn--outline" onclick="window.__cx.imprimir(${p.id})"><i class="fa-solid fa-print"></i> Imprimir</button>
       <button class="btn btn--primary" onclick="Modal.fechar()">Fechar</button>`);
  }

  function estornar(pid) {
    if (!st.aberto) { toast("Abra o seu caixa para registrar o estorno", "error"); return; }
    Modal.abrir("Estornar pagamento", `
      <p>O pagamento <b>não será apagado</b>: ele fica marcado como estornado, a saída é lançada no seu caixa
         e a cobrança volta para "Aguardando pagamento".</p>
      <label class="cx-f"><span>Motivo do estorno *</span>
        <textarea id="est-motivo" rows="3" placeholder="Descreva o motivo"></textarea></label>`,
      `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
       <button class="btn btn--danger" id="est-ok"><i class="fa-solid fa-rotate-left"></i> Confirmar estorno</button>`);
    document.getElementById("est-ok").onclick = async () => {
      const motivo = document.getElementById("est-motivo").value.trim();
      if (motivo.length < 5) { toast("Informe o motivo do estorno", "error"); return; }
      try {
        await API.post(`/api/caixa/pagamento/${pid}/estornar`, { motivo });
        Modal.fechar();
        toast("Pagamento estornado");
        recarregar();
      } catch (e) { toast(e.message, "error"); }
    };
  }

  /* ----------------------------------------------------------- movimentações */
  async function abaMovimentos() {
    const box = document.getElementById("cx-aba");
    box.innerHTML = `<div class="loading"><i class="fa-solid fa-spinner spin"></i> Carregando…</div>`;
    let dados;
    try { dados = (await API.get("/api/caixa/movimentos")).dados; }
    catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const TIPO = {
      recebimento: ["Entrada", "badge--success"], suprimento: ["Entrada", "badge--success"],
      sangria: ["Saída", "badge--danger"], estorno: ["Estorno", "badge--danger"],
    };
    box.innerHTML = dados.length ? `<div class="table-wrap"><table class="data">
      <thead><tr><th>Data/hora</th><th>Tipo</th><th>Descrição</th><th>Forma</th><th class="text-right">Valor</th><th>Usuário</th></tr></thead>
      <tbody>${dados.map((m) => {
        const [r, cls] = TIPO[m.tipo] || [m.tipo, ""];
        const saida = m.tipo === "sangria" || m.tipo === "estorno";
        return `<tr><td>${fmt.dataHora(m.criado_em)}</td>
          <td><span class="badge ${cls}">${r}</span></td>
          <td>${esc(m.motivo || "-")}</td>
          <td>${m.forma_pagamento ? `<i class="${iconeForma(m.forma_pagamento)}"></i> ${nomeForma(m.forma_pagamento)}` : "-"}</td>
          <td class="text-right ${saida ? "cx-neg" : "cx-pos"}"><b>${saida ? "− " : ""}${money(m.valor)}</b></td>
          <td>${esc(m.usuario_nome || "-")}</td></tr>`;
      }).join("")}</tbody></table></div>`
      : `<div class="empty"><i class="fa-solid fa-list"></i>Nenhuma movimentação neste caixa.</div>`;
  }

  /* --------------------------------------------- abrir / entrada / saída */
  function abrirCaixa() {
    Modal.abrir("Abrir caixa", `
      <label class="cx-f"><span>Saldo inicial em dinheiro (troco)</span>
        <input id="ab-valor" inputmode="decimal" placeholder="0,00" autofocus></label>`,
      `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
       <button class="btn btn--primary" id="ab-ok"><i class="fa-solid fa-lock-open"></i> Abrir caixa</button>`);
    document.getElementById("ab-ok").onclick = async () => {
      try {
        await API.post("/api/caixa/abrir", { valor_abertura: num(document.getElementById("ab-valor").value) });
        Modal.fechar(); toast("Caixa aberto"); recarregar();
      } catch (e) { toast(e.message, "error"); }
    };
  }

  function movimento(tipo) {
    const entrada = tipo === "suprimento";
    Modal.abrir(entrada ? "Nova entrada (suprimento)" : "Nova saída (sangria)", `
      <p class="text-muted">${entrada ? "Dinheiro colocado na gaveta (ex.: reforço de troco)."
        : "Dinheiro retirado da gaveta (ex.: compra de material, depósito)."}</p>
      <label class="cx-f"><span>Descrição *</span><input id="mv-motivo" placeholder="${entrada ? "Ex.: reforço de troco" : "Ex.: compra de material"}"></label>
      <label class="cx-f"><span>Valor *</span><input id="mv-valor" inputmode="decimal" placeholder="0,00"></label>`,
      `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
       <button class="btn ${entrada ? "btn--success" : "btn--danger"}" id="mv-ok">Registrar ${entrada ? "entrada" : "saída"}</button>`);
    document.getElementById("mv-ok").onclick = async () => {
      try {
        await API.post("/api/caixa/movimento", {
          tipo, motivo: document.getElementById("mv-motivo").value,
          valor: num(document.getElementById("mv-valor").value),
        });
        Modal.fechar(); toast(entrada ? "Entrada registrada" : "Saída registrada"); recarregar();
      } catch (e) { toast(e.message, "error"); }
    };
  }

  /* --------------------------------------------------------------- fechar */
  async function fecharCaixa() {
    try { st = await API.get("/api/caixa/status"); } catch (_) {}
    const t = st.totais;
    const pf = t.por_forma;
    Modal.abrir("Fechar caixa — conferência", `
      <div class="cx-rel">
        <div class="rc-l"><span>Saldo inicial</span><b>${money(t.abertura)}</b></div>
        <div class="rc-l"><span>+ Dinheiro recebido</span><b>${money(pf.dinheiro)}</b></div>
        <div class="rc-l"><span>+ Pix recebido</span><b>${money(pf.pix)}</b></div>
        <div class="rc-l"><span>+ Débito</span><b>${money(pf.debito)}</b></div>
        <div class="rc-l"><span>+ Crédito</span><b>${money(pf.credito)}</b></div>
        <div class="rc-l"><span>+ Outros / transferência</span><b>${money(pf.outros + pf.transferencia)}</b></div>
        <div class="rc-l"><span>+ Entradas avulsas</span><b>${money(t.suprimentos)}</b></div>
        <div class="rc-l"><span>− Saídas</span><b>${money(t.sangrias)}</b></div>
        <div class="rc-l rc-l--total"><span>= Saldo final</span><b>${money(t.saldo)}</b></div>
        <div class="rc-l"><span>Transações</span><b>${t.qtd_transacoes}</b></div>
        <div class="rc-sep"></div>
        <div class="rc-l"><span>Dinheiro esperado na gaveta</span><b>${money(t.dinheiro_gaveta)}</b></div>
        <label class="cx-f"><span>Dinheiro contado na gaveta</span>
          <input id="fc-valor" inputmode="decimal" value="${t.dinheiro_gaveta.toFixed(2).replace(".", ",")}"></label>
        <div class="rc-l" id="fc-dif-l"><span>Diferença</span><b id="fc-dif">${money(0)}</b></div>
        <p class="text-muted">Depois de fechado, novos lançamentos só com uma nova abertura de caixa.</p>
      </div>`,
      `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
       <button class="btn btn--primary" id="fc-ok"><i class="fa-solid fa-lock"></i> Confirmar fechamento</button>`);
    const inp = document.getElementById("fc-valor");
    inp.oninput = () => {
      const d = Math.round((num(inp.value) - t.dinheiro_gaveta) * 100) / 100;
      const el = document.getElementById("fc-dif");
      el.textContent = (d > 0 ? "+ " : d < 0 ? "− " : "") + money(Math.abs(d));
      el.className = d < 0 ? "cx-neg" : d > 0 ? "cx-pos" : "";
    };
    document.getElementById("fc-ok").onclick = async () => {
      try {
        const r = await API.post("/api/caixa/fechar", { valor_informado: num(inp.value) });
        relatorio(r.relatorio);
      } catch (e) { toast(e.message, "error"); }
    };
  }

  function relatorio(r) {
    const pf = r.por_forma;
    const linhas = [
      ["Operador", r.operador], ["Abertura", fmt.dataHora(r.aberto_em)], ["Fechamento", fmt.dataHora(r.fechado_em)],
      ["Saldo inicial", money(r.abertura)], ["Dinheiro", money(pf.dinheiro)], ["Pix", money(pf.pix)],
      ["Débito", money(pf.debito)], ["Crédito", money(pf.credito)], ["Outros", money(pf.outros + pf.transferencia)],
      ["Entradas avulsas", money(r.suprimentos)], ["Saídas", money(r.sangrias + r.estornos)],
      ["Saldo final", money(r.saldo)], ["Transações", r.qtd_transacoes],
      ["Dinheiro esperado", money(r.esperado)], ["Dinheiro contado", money(r.informado)], ["Diferença", money(r.diferenca)],
    ];
    Modal.abrir("Caixa fechado", `<div class="cx-rel" id="rel-fech">
      ${linhas.map(([a, b]) => `<div class="rc-l"><span>${a}</span><b>${esc(b)}</b></div>`).join("")}</div>`,
      `<button class="btn btn--outline" id="rel-print"><i class="fa-solid fa-print"></i> Imprimir</button>
       <button class="btn btn--primary" onclick="Modal.fechar();window.__cx.recarregar()">Concluir</button>`);
    document.getElementById("rel-print").onclick = () => {
      const w = window.open("", "_blank", "width=420,height=700");
      if (!w) return;
      w.document.write(`<html><head><title>Fechamento de caixa</title><style>
        body{font-family:Arial;font-size:12px;width:300px;margin:10px auto} h2{text-align:center;font-size:14px}
        .l{display:flex;justify-content:space-between;border-bottom:1px dashed #999;padding:3px 0}</style></head><body>
        <h2>${esc(Layout.config?.empresa_nome || "Oficina")}<br>Fechamento de caixa</h2>
        ${linhas.map(([a, b]) => `<div class="l"><span>${a}</span><b>${esc(b)}</b></div>`).join("")}
        <script>window.onload=()=>window.print()<\/script></body></html>`);
      w.document.close();
    };
  }

  function recarregar() { carregar(); }

  async function carregar() {
    try { st = await cx("GET", "/api/caixa/status"); }
    catch (e) { document.getElementById("cx-corpo").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    render();
  }

  window.__cx = { receber, imprimir, enviar, detalhes, estornar, recarregar, sair };
  carregar();
})();
