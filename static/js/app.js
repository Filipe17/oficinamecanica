/* =======================================================================
   app.js — Camada compartilhada do frontend (Vanilla JS)
   -----------------------------------------------------------------------
   Reúne o que todas as páginas usam:
     - API()      : wrapper do fetch com JSON e tratamento de erro/sessão
     - Layout     : monta sidebar + topbar dinamicamente (menu único)
     - Tema       : alterna claro/escuro e guarda a preferência
     - Modal      : abre/fecha modais reutilizáveis
     - Toast      : notificações
     - fmt        : formatação de moeda/data
   Cada página importa este arquivo antes do seu script específico.
   ======================================================================= */

/* ---------------------- Wrapper de API (fetch) ---------------------- */
const API = {
  async request(url, options = {}) {
    const opts = {
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",         // envia o cookie de sessão
      ...options,
    };
    if (opts.body && typeof opts.body !== "string" && !(opts.body instanceof FormData)) {
      opts.body = JSON.stringify(opts.body);
    }
    if (opts.body instanceof FormData) {
      delete opts.headers["Content-Type"];  // deixa o browser definir o boundary
    }
    const resp = await fetch(url, opts);
    // Sessão expirada -> volta ao login (exceto na própria tela de login)
    if (resp.status === 401 && !location.pathname.includes("login")) {
      location.href = "/login";
      return;
    }
    let dados = null;
    try { dados = await resp.json(); } catch (_) {}
    if (!resp.ok) {
      throw new Error((dados && dados.erro) || `Erro ${resp.status}`);
    }
    return dados;
  },
  get(u) { return this.request(u); },
  post(u, b) { return this.request(u, { method: "POST", body: b }); },
  put(u, b) { return this.request(u, { method: "PUT", body: b }); },
  del(u) { return this.request(u, { method: "DELETE" }); },
  upload(u, formData) { return this.request(u, { method: "POST", body: formData }); },
};

/* ---------------------- Tema claro/escuro ---------------------- */
const Tema = {
  init() {
    const salvo = localStorage.getItem("tema") || "light";
    document.documentElement.setAttribute("data-theme", salvo);
  },
  alternar() {
    const atual = document.documentElement.getAttribute("data-theme");
    const novo = atual === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", novo);
    localStorage.setItem("tema", novo);
    const icone = document.querySelector("#btn-tema i");
    if (icone) icone.className = novo === "dark" ? "fa-solid fa-sun" : "fa-solid fa-moon";
  },
};
Tema.init();

/* ---------------------- Toast ---------------------- */
function toast(msg, tipo = "success") {
  let box = document.getElementById("toasts");
  if (!box) { box = document.createElement("div"); box.id = "toasts"; document.body.appendChild(box); }
  const icones = { success: "fa-circle-check", error: "fa-circle-xmark", warning: "fa-triangle-exclamation" };
  const el = document.createElement("div");
  el.className = `toast toast--${tipo}`;
  el.innerHTML = `<i class="fa-solid ${icones[tipo] || icones.success}"></i><span>${msg}</span>`;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, 3200);
}

/* ---------------------- Modal reutilizável ---------------------- */
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
    // Clicar fora (no fundo) NÃO fecha o modal — evita perder o que está sendo
    // preenchido. O modal só fecha pelo X ou pelos botões do rodapé.
    return bd;
  },
  fechar() {
    const bd = document.getElementById("modal-atual");
    if (bd) { bd.classList.remove("open"); setTimeout(() => bd.remove(), 200); }
  },
};

/* ---------------------- Formatação ---------------------- */
const fmt = {
  moeda(v) {
    return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  },
  data(v) {
    if (!v) return "-";
    const d = new Date(v.replace(" ", "T"));
    return isNaN(d) ? v : d.toLocaleDateString("pt-BR");
  },
  dataHora(v) {
    if (!v) return "-";
    const d = new Date(v.replace(" ", "T"));
    return isNaN(d) ? v : d.toLocaleString("pt-BR");
  },
};

/* ---------------------- Menu lateral (definição única) ---------------------- */
const MENU = [
  { grupo: "Principal", itens: [
    { id: "dashboard", nome: "Dashboard", icone: "fa-gauge-high" },
    { id: "clientes", nome: "Clientes", icone: "fa-users" },
    { id: "veiculos", nome: "Veículos", icone: "fa-car" },
    { id: "ordem_servico", nome: "Ordem de Serviço", icone: "fa-screwdriver-wrench" },
    { id: "orcamentos", nome: "Orçamentos", icone: "fa-file-invoice-dollar" },
    { id: "agendamentos", nome: "Agendamentos", icone: "fa-calendar-days" },
    { id: "lembretes", nome: "Lembretes de Revisão", icone: "fa-bell" },
    { id: "nps", nome: "NPS / Avaliações", icone: "fa-star" },
  ]},
  { grupo: "Cadastros", itens: [
    { id: "servicos", nome: "Serviços", icone: "fa-list-check" },
    { id: "produtos", nome: "Produtos", icone: "fa-box" },
    { id: "fornecedores", nome: "Fornecedores", icone: "fa-truck" },
    { id: "estoque", nome: "Estoque", icone: "fa-warehouse" },
    { id: "xml", nome: "Importação XML", icone: "fa-file-code" },
  ]},
  { grupo: "Financeiro", itens: [
    { id: "financeiro", nome: "Financeiro", icone: "fa-wallet" },
    { id: "cobrancas", nome: "Cobranças", icone: "fa-hand-holding-dollar" },
    { id: "mala_direta", nome: "Mala Direta", icone: "fa-envelope-open-text" },
    { id: "caixa", nome: "Caixa", icone: "fa-cash-register", novaAba: true },
  ]},
  { grupo: "Sistema", itens: [
    { id: "relatorios", nome: "Relatórios", icone: "fa-chart-column" },
    { id: "notas_fiscais", nome: "Notas Fiscais", icone: "fa-file-invoice" },
    { id: "cartao", nome: "Cartão / Taxas", icone: "fa-credit-card" },
    { id: "cheques", nome: "Cheques", icone: "fa-money-check" },
    { id: "usuarios", nome: "Usuários", icone: "fa-user-gear" },
    { id: "permissoes", nome: "Permissões", icone: "fa-user-shield" },
    { id: "configuracoes", nome: "Configurações", icone: "fa-gear" },
    { id: "logs", nome: "Logs", icone: "fa-clipboard-list" },
  ]},
];

/* Cada item de menu depende de um "módulo" de permissão. Itens de mesmo módulo
   (ex.: orcamentos→ordem_servico, cobrancas→financeiro) seguem o mesmo nível. */
const MODULO_DO_ITEM = {
  dashboard: "dashboard", clientes: "clientes", veiculos: "veiculos",
  ordem_servico: "ordem_servico", orcamentos: "orcamentos",
  agendamentos: "agendamentos", lembretes: "lembretes", nps: "nps",
  servicos: "servicos", produtos: "produtos", fornecedores: "fornecedores", estoque: "estoque", xml: "xml",
  financeiro: "financeiro", cobrancas: "cobrancas", mala_direta: "mala_direta", caixa: "caixa",
  relatorios: "relatorios", notas_fiscais: "notas_fiscais", cartao: "cartao", cheques: "cheques", usuarios: "usuarios", logs: "logs",
};

/* ---------------------- Layout: monta a "casca" da página ---------------------- */
const Layout = {
  usuario: null,
  permissoes: {},
  config: {},

  // Monta o endereço da empresa em 1-2 linhas a partir dos campos estruturados
  // (com compatibilidade para o endereço antigo em um campo só).
  enderecoLinhas() {
    const c = this.config || {};
    const rua = [c.empresa_endereco, c.empresa_numero].filter(Boolean).join(", ");
    const l1 = [rua, c.empresa_bairro].filter(Boolean).join(" - ");
    const cidUf = [c.empresa_cidade, c.empresa_estado].filter(Boolean).join("/");
    const l2 = [c.empresa_cep ? "CEP: " + c.empresa_cep : "", cidUf].filter(Boolean).join(" - ");
    return [l1, l2].filter(Boolean);
  },

  // Retorna a primeira página que o usuário tem permissão de acessar
  _primeiraPaginaPermitida(permissoes, perfil) {
    if (perfil === "administrador") return "/dashboard";
    const candidatos = [
      ["dashboard",     "dashboard"],
      ["ordem_servico", "ordem_servico"],
      ["agendamentos",  "agendamentos"],
      ["clientes",      "clientes"],
      ["veiculos",      "veiculos"],
      ["produtos",      "produtos"],
      ["servicos",      "servicos"],
      ["estoque",       "estoque"],
      ["financeiro",    "financeiro"],
      ["relatorios",    "relatorios"],
      ["orcamentos",    "orcamentos"],
    ];
    for (const [pagina, modulo] of candidatos) {
      if ((permissoes[modulo] || 0) > 0) return `/${pagina}`;
    }
    return "/login";
  },

  // Protege a página, carrega o usuário e injeta sidebar/topbar
  async iniciar(paginaAtiva, titulo) {
    try {
      const r = await API.get("/api/me");
      this.usuario = r.usuario;
      this.permissoes = r.permissoes || {};
    } catch (_) {
      location.href = "/login";
      return null;
    }
    try { this.config = await API.get("/api/configuracoes"); } catch (_) { this.config = {}; }

    // Verifica se o usuário tem permissão para a página atual
    const perfil = this.usuario.perfil;
    if (perfil !== "administrador") {
      const MODULO_PAGINA = {
        dashboard: "dashboard", clientes: "clientes", veiculos: "veiculos",
        ordem_servico: "ordem_servico", orcamentos: "orcamentos",
        agendamentos: "agendamentos", lembretes: "lembretes", nps: "nps", servicos: "servicos", produtos: "produtos",
        fornecedores: "fornecedores", estoque: "estoque", xml: "xml",
        financeiro: "financeiro", cobrancas: "financeiro", mala_direta: "financeiro",
        relatorios: "relatorios", notas_fiscais: "notas_fiscais",
        cartao: "cartao", cheques: "cheques", usuarios: "usuarios", logs: "logs",
      };
      const modulo = MODULO_PAGINA[paginaAtiva];
      if (modulo && (this.permissoes[modulo] || 0) === 0) {
        // Sem permissão — redireciona para primeira página permitida
        location.href = this._primeiraPaginaPermitida(this.permissoes, perfil);
        return null;
      }
    }

    // Oculta Caixa/PDV se modo_financeiro = sem_caixa
    if ((this.config?.modo_financeiro || "completo") === "sem_caixa") {
      this._menuItens = this._menuItens || null;
      // Marca os itens a ocultar
      window.__semCaixa = true;
    } else {
      window.__semCaixa = false;
    }
    this._render(paginaAtiva, titulo);
    return this.usuario;
  },

  _render(ativa, titulo) {
    const iniciais = (this.usuario.nome || "?").split(" ")
      .map((p) => p[0]).slice(0, 2).join("").toUpperCase();

    const ehAdmin = this.usuario.perfil === "administrador";
    const podeVer = (id) => {
      if (id === "permissoes" || id === "configuracoes") return ehAdmin;  // só o admin
      if (ehAdmin) return true;
      const mod = MODULO_DO_ITEM[id];
      return !mod || (this.permissoes[mod] || 0) > 0;   // nível > 0 = visível
    };
    const nav = MENU.map((g) => {
      const itens = g.itens.filter((i) => {
        if (!podeVer(i.id)) return false;
        // Oculta Caixa e PDV no modo sem_caixa
        if (window.__semCaixa && ["caixa", "pdv"].includes(i.id)) return false;
        return true;
      });
      if (!itens.length) return "";   // não mostra grupo sem itens
      return `
      <div class="sidebar__group">
        <div class="sidebar__group-label">${g.grupo}</div>
        ${itens.map((i) => `
          <a href="/${i.id}" ${i.novaAba ? 'target="_blank" rel="noopener"' : ""} class="sidebar__link ${i.id === ativa ? "active" : ""}">
            <i class="fa-solid ${i.icone}"></i><span>${i.nome}</span>
          </a>`).join("")}
      </div>`;
    }).join("");

    const temaEscuro = document.documentElement.getAttribute("data-theme") === "dark";

    document.body.innerHTML = `
      <div class="app">
        <aside class="sidebar" id="sidebar">
          <div class="sidebar__brand">
            <div class="sidebar__logo">${this.config.empresa_logo
              ? `<img src="${this.config.empresa_logo}" alt="logo">`
              : `<i class="fa-solid fa-gear"></i>`}</div>
            <div class="sidebar__title">${this.config.empresa_nome || "DevSystem"}<small>${this.config.empresa_nome ? "Gestão do negócio" : "Seu negócio, nosso sistema"}</small></div>
          </div>
          <nav class="sidebar__nav">${nav}</nav>
        </aside>

        <div class="main">
          <header class="topbar">
            <button class="topbar__toggle" onclick="Layout.toggleSidebar()"><i class="fa-solid fa-bars"></i></button>
            <div class="topbar__title">${titulo}</div>
            <div class="topbar__spacer"></div>
            ${this.usuario.perfil === "mecanico" ? `<button class="icon-btn notif-bell" id="btn-notif-orc" title="Orçamentos aprovados" style="display:none;position:relative" onclick="Layout.abrirNotifOrc()">
              <i class="fa-solid fa-bell" style="color:#ef4444"></i>
              <span id="notif-orc-badge" style="position:absolute;top:2px;right:2px;width:10px;height:10px;background:#ef4444;border-radius:50%;animation:piscar 1s infinite"></span>
            </button>` : ""}
            ${this.usuario.perfil === "mecanico" ? `<button class="icon-btn" id="btn-notif-orc-fin" title="Orçamento finalizado — feche a OS" style="display:none;position:relative" onclick="Layout.abrirNotifOrcFin()">
              <i class="fa-solid fa-file-circle-check" style="color:#16a34a"></i>
              <span id="notif-orc-fin-badge" style="position:absolute;top:2px;right:2px;width:10px;height:10px;background:#16a34a;border-radius:50%;animation:piscar 1s infinite"></span>
            </button>` : ""}
            ${["administrador","gerente","atendente"].includes(this.usuario.perfil) ? `<button class="icon-btn" id="btn-notif-diag" title="Diagnósticos pendentes" style="display:none;position:relative" onclick="Layout.abrirNotifDiag()">
              <i class="fa-solid fa-stethoscope" style="color:#ef4444"></i>
              <span id="notif-diag-badge" style="position:absolute;top:2px;right:2px;width:10px;height:10px;background:#ef4444;border-radius:50%;animation:piscar 1s infinite"></span>
            </button>` : ""}
            <button class="icon-btn" id="btn-tema" onclick="Tema.alternar()" title="Alternar tema">
              <i class="fa-solid ${temaEscuro ? "fa-sun" : "fa-moon"}"></i>
            </button>
            <div class="user-chip" onclick="Layout.menuUsuario()">
              <div class="user-chip__avatar">${iniciais}</div>
              <div>
                <div class="user-chip__name">${this.usuario.nome}</div>
                <div class="user-chip__role">${this.usuario.perfil}</div>
              </div>
            </div>
          </header>
          <main class="content" id="conteudo">
            <div class="loading"><i class="fa-solid fa-spinner spin"></i> Carregando…</div>
          </main>
        </div>
      </div>`;
  },

  toggleSidebar() {
    const sb = document.getElementById("sidebar");
    const aberto = sb.classList.toggle("open");
    let ov = document.getElementById("sidebar-overlay");
    if (aberto) {
      if (!ov) {
        ov = document.createElement("div");
        ov.id = "sidebar-overlay";
        ov.style.cssText = "position:fixed;inset:0;z-index:99;background:rgba(0,0,0,.35);cursor:pointer";
        ov.addEventListener("click", (e) => { e.stopPropagation(); Layout.toggleSidebar(); });
        document.body.appendChild(ov);
      }
      ov.style.display = "block";
      sb.style.zIndex = "200";
    } else {
      if (ov) ov.style.display = "none";
      sb.style.zIndex = "";
    }
  },

  menuUsuario() {
    Modal.abrir("Conta",
      `<p class="text-muted">Conectado como <b>${this.usuario.nome}</b> (${this.usuario.perfil}).</p>`,
      `<button class="btn btn--ghost" onclick="Modal.fechar()">Fechar</button>
       <button class="btn btn--danger" onclick="Layout.sair()"><i class="fa-solid fa-right-from-bracket"></i> Sair</button>`);
  },

  async sair() {
    await API.post("/api/logout");
    location.href = "/login";
  },

  // Atalho: escreve HTML dentro da área de conteúdo
  set(html) { document.getElementById("conteudo").innerHTML = html; },
};

window.Layout = Layout;

/* Utilitário: debounce para campos de busca */
function debounce(fn, ms = 350) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* =========================================================================
   Notificação de orçamento aprovado pelo cliente (somente mecânico)
   Polling a cada 30s — acende um sininho vermelho piscando na topbar.
   ========================================================================= */

// Injeta o CSS da animação piscar uma única vez
(function () {
  if (document.getElementById("_piscar_css")) return;
  const s = document.createElement("style");
  s.id = "_piscar_css";
  s.textContent = `@keyframes piscar { 0%,100%{opacity:1} 50%{opacity:0} }`;
  document.head.appendChild(s);
})();

// Estado global dos orçamentos aprovados pendentes
window._orcsAprovados = [];

Layout.abrirNotifOrc = function () {
  const lista = window._orcsAprovados || [];
  if (!lista.length) return;
  window._diagOS = lista;
  const linhas = lista.map((o, idx) =>
    `<div style="padding:.75rem;border:1.5px solid #0d9488;border-radius:10px;margin-bottom:.5rem;background:#f0fdf4">
       <div style="font-weight:700;color:#0d9488"><i class="fa-solid fa-circle-check"></i> Orçamento Nº ${o.numero || o.id}</div>
       <div style="font-size:.9rem;color:#444;margin-top:.25rem">Cliente: <b>${o.cliente_nome || "—"}</b></div>
       <div style="font-size:.85rem;color:#666">Total: <b>R$ ${(parseFloat(o.total) || 0).toFixed(2).replace(".", ",")}</b></div>
     </div>`
  ).join("");
  Modal.abrir(
    "✅ Cliente aprovou o orçamento!",
    `<div style="margin-bottom:.75rem;color:#555">O(s) seguinte(s) orçamento(s) foram aprovados pelo cliente e aguardam sua execução:</div>
     ${linhas}`,
    `<button class="btn btn--primary" onclick="Modal.fechar()">Entendido</button>`
  );
};

Layout._iniciarPollingOrc = function () {
  if (this.usuario?.perfil !== "mecanico") return;

  const verificar = async () => {
    try {
      // O backend já filtra pela sessão do mecânico; busca status cliente_aprovou
      const r = await API.get("/api/os?orcamento=1&status=cliente_aprovou&notif=1&por_pagina=100");
      const dados = r.dados || [];
      window._orcsAprovados = dados;
      const btn = document.getElementById("btn-notif-orc");
      if (btn) btn.style.display = dados.length ? "inline-flex" : "none";
    } catch (_) {}
  };

  verificar(); // imediato ao carregar
  setInterval(verificar, 30000); // a cada 30s
};

// Hook: dispara o polling logo após o Layout.iniciar
const _iniciarOriginal = Layout.iniciar.bind(Layout);
Layout.iniciar = async function (...args) {
  const r = await _iniciarOriginal(...args);
  Layout._iniciarPollingOrc();
  return r;
};

/* =========================================================================
   Notificação de diagnóstico pendente (admin / gerente / atendente)
   ========================================================================= */
window._diagPendentes = [];

Layout.abrirNotifDiag = function () {
  const lista = window._diagPendentes || [];
  if (!lista.length) return;
  const linhas = lista.map((o, idx) =>
    `<div style="padding:.75rem;border:1.5px solid #f59e0b;border-radius:10px;margin-bottom:.5rem;background:#fffbeb">
       <div style="font-weight:700;color:#b45309"><i class="fa-solid fa-stethoscope"></i> OS Nº ${o.numero || o.id} — ${o.cliente_nome || "—"}</div>
       <div style="font-size:.85rem;color:#555;margin:.25rem 0"><b>Mecânico:</b> ${o.mecanico_nome || "—"}</div>
       <div style="font-size:.85rem;color:#444;background:#fef3c7;border-radius:6px;padding:.4rem .6rem;margin:.25rem 0">${o.diagnostico || ""}</div>
       <button class="btn btn--primary btn--sm" style="margin-top:.5rem"
         onclick="window._abrirOSDiag(${idx})">
         <i class="fa-solid fa-arrow-right"></i> Continuar preenchendo a OS
       </button>
     </div>`
  ).join("");
  Modal.abrir(
    "🔧 Diagnóstico aguardando sua atenção",
    `<div style="margin-bottom:.75rem;color:#555">O(s) mecânico(s) preencheram o diagnóstico. Complete a OS para prosseguir:</div>${linhas}`,
    `<button class="btn btn--ghost" onclick="Modal.fechar()">Fechar</button>`
  );
};

window._abrirOSDiag = function(idx) {
  var o = (window._diagPendentes || [])[idx];
  if (o) Layout._abrirOS(o.id);
};

Layout._abrirOS = function (id) {
  // Marca como lido em background (não bloqueia o redirect)
  try { API.post(`/api/os/${id}/diagnostico-lido`, {}); } catch (_) {}
  Modal.fechar();
  // Navega para a OS — location.assign força reload mesmo na mesma página
  location.assign(`/ordem_servico?abrir=${id}`);
};

Layout._iniciarPollingDiag = function () {
  const perfil = this.usuario?.perfil;
  if (!["administrador", "gerente", "atendente"].includes(perfil)) return;

  const verificar = async () => {
    try {
      const data = await API.get("/api/os/diagnostico-pendente");
      window._diagPendentes = data.dados || [];
      const btn = document.getElementById("btn-notif-diag");
      if (btn) btn.style.display = window._diagPendentes.length ? "inline-flex" : "none";
    } catch (_) {}
  };

  verificar();
  setInterval(verificar, 30000);
};


Layout.abrirNotifOrcFin = function () {
  const lista = window._orcFinPendentes || [];
  if (!lista.length) return;
  const linhas = lista.map((o, idx) =>
    `<div style="padding:.75rem;border:1.5px solid #16a34a;border-radius:10px;margin-bottom:.5rem;background:#f0fdf4">
       <div style="font-weight:700;color:#15803d"><i class="fa-solid fa-file-circle-check"></i> OS Nº ${o.numero || o.id} — ${o.cliente_nome || "—"}</div>
       <div style="font-size:.85rem;color:#555;margin:.25rem 0"><b>Status:</b> ${o.status || "—"}</div>
       <button class="btn btn--primary btn--sm" style="margin-top:.5rem;background:#16a34a;border-color:#16a34a"
         onclick="window._abrirOSOrcFin(${idx})">
         <i class="fa-solid fa-arrow-right"></i> Ir para a OS e finalizar
       </button>
     </div>`
  ).join("");
  Modal.abrir(
    "✅ Orçamento aprovado e finalizado!",
    `<div style="margin-bottom:.75rem;color:#555">O orçamento foi finalizado pelo cliente. Finalize a OS para concluir o serviço:</div>${linhas}`,
    `<button class="btn btn--ghost" onclick="Modal.fechar()">Fechar</button>`
  );
};

window._abrirOSOrcFin = function(idx) {
  const o = (window._orcFinPendentes || [])[idx];
  if (!o) return;
  try { API.post(`/api/os/${o.id}/orc-finalizado-lido`, {}); } catch (_) {}
  Modal.fechar();
  location.assign(`/ordem_servico?abrir=${o.id}`);
};

Layout._iniciarPollingOrcFin = function () {
  if (this.usuario?.perfil !== "mecanico") return;

  const verificar = async () => {
    try {
      const data = await API.get("/api/os/orc-finalizado-pendente");
      window._orcFinPendentes = data.dados || [];
      const btn = document.getElementById("btn-notif-orc-fin");
      if (btn) btn.style.display = window._orcFinPendentes.length ? "inline-flex" : "none";
    } catch (_) {}
  };

  verificar();
  setInterval(verificar, 30000);
};

// Hook no iniciar (complementa o anterior)
const _iniciarComDiag = Layout.iniciar.bind(Layout);
Layout.iniciar = async function (...args) {
  const r = await _iniciarComDiag(...args);
  Layout._iniciarPollingDiag();
  Layout._iniciarPollingOrcFin();
  return r;
};


/* =========================================================================
   Auto-refresh global: recarrega a tela atual a cada 30s silenciosamente
   ========================================================================= */
(function() {
  setInterval(function() {
    if (typeof window.__recarregar === "function") {
      try { window.__recarregar(); } catch(_) {}
    }
  }, 30000);
})();
