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
  ordem_servico: "ordem_servico", orcamentos: "orcamentos", agendamentos: "agendamentos",
  servicos: "servicos", produtos: "produtos", fornecedores: "fornecedores", estoque: "estoque", xml: "xml",
  financeiro: "financeiro", cobrancas: "financeiro", mala_direta: "financeiro", caixa: "caixa",
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
        agendamentos: "agendamentos", lembretes: "lembretes", lembretes: "lembretes", servicos: "servicos", produtos: "produtos",
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
      const itens = g.itens.filter((i) => podeVer(i.id));
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

  toggleSidebar() { document.getElementById("sidebar").classList.toggle("open"); },

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

/* Utilitário: debounce para campos de busca */
function debounce(fn, ms = 350) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
