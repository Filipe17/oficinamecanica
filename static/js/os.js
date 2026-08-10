/* =======================================================================
   os.js — Ordens de Serviço e Orçamentos (código compartilhado)
   -----------------------------------------------------------------------
   O modo é definido pela URL: /orcamentos → orçamento; caso contrário, OS.
   Recursos: listagem com filtro por status + busca, editor completo com
   itens (produtos e serviços), finalização (baixa de estoque + financeiro)
   e conversão de orçamento em OS.
   ======================================================================= */
(async () => {
  const EH_ORC = location.pathname.includes("orcamento") ? 1 : 0;
  const PAG = EH_ORC ? "orcamentos" : "ordem_servico";
  const TITULO = EH_ORC ? "Orçamentos" : "Ordem de Serviço";
  await Layout.iniciar(PAG, TITULO);

  // Só-leitura quando o perfil tem nível "visualizar" (1) no módulo correspondente.
  const MODULO_PAG = EH_ORC ? "orcamentos" : "ordem_servico";
  const soLeitura = Layout.usuario?.perfil !== "administrador"
                 && (Layout.permissoes?.[MODULO_PAG] ?? 2) < 2;

  const STATUS = ["aberta", "em_analise", "aguardando_aprovacao", "aguardando_pecas", "em_execucao", "finalizada_mecanico", "finalizada", "cancelada"];
  const STATUS_LABEL = {
    aberta: "Aberta", em_analise: "Em análise", aguardando_aprovacao: "Aguard. aprovação",
    aguardando_pecas: "Aguard. peças", em_execucao: "Em execução",
    finalizada_mecanico: "Finalizada pelo mecânico", finalizada: "Finalizada", cancelada: "Cancelada",
  };
  const STATUS_TOM = {
    aberta: "info", em_analise: "", aguardando_aprovacao: "warning", aguardando_pecas: "warning",
    em_execucao: "info", finalizada_mecanico: "warning", finalizada: "success", cancelada: "danger",
  };

  // Dados auxiliares para os selects e itens
  let clientes = [], veiculos = [], mecanicos = [], produtos = [], servicos = [];
  try {
    // allSettled: se algum recurso for bloqueado pelo perfil (ex.: mecânico não
    // acessa produtos/serviços), os demais continuam funcionando.
    const [rc, rv, rm, rp, rs] = await Promise.allSettled([
      API.get("/api/clientes?por_pagina=1000&ordem=nome"),
      API.get("/api/veiculos?por_pagina=1000"),
      API.get("/api/os/mecanicos"),
      API.get("/api/produtos?por_pagina=1000&ordem=nome"),
      API.get("/api/servicos"),
    ]);
    const ok = (r) => (r.status === "fulfilled" ? r.value : {});
    clientes = ok(rc).dados || [];
    veiculos = ok(rv).dados || [];
    mecanicos = ok(rm).dados || [];   // já vem só com perfil "mecânico"
    produtos = ok(rp).dados || [];
    servicos = ok(rs).dados || [];
  } catch (_) {}

  let filtroStatus = "", busca = "";
  let itensAtuais = [];   // itens do editor aberto
  let pecasPreservadas = []; // itens não-produto (ex.: serviços) da OS aberta, mantidos ao salvar

  Layout.set(`
    <div class="page-head">
      <div><h1>${TITULO}</h1><p>${EH_ORC ? "Propostas para aprovação do cliente" : "Ordens de serviço e acompanhamento"}</p></div>
      <div class="page-head__acoes">
        ${soLeitura ? "" : `<button class="btn btn--primary" id="os-novo"><i class="fa-solid fa-plus"></i> ${EH_ORC ? "Novo orçamento" : "Nova OS"}</button>`}
      </div>
    </div>
    <div class="card"><div class="card__body">
      <div class="toolbar">
        <div class="toolbar__search"><i class="fa-solid fa-magnifying-glass"></i>
          <input id="os-busca" placeholder="Buscar por nº, cliente ou placa…"></div>
        <select id="os-status" class="toolbar__select">
          <option value="">Todos os status</option>
          ${STATUS.map((s) => `<option value="${s}">${STATUS_LABEL[s]}</option>`).join("")}
        </select>
        ${!EH_ORC ? `<div style="display:flex;gap:.3rem;margin-left:.5rem">
          <button id="btn-view-lista" class="btn btn--sm btn--primary" title="Visualização lista">
            <i class="fa-solid fa-list"></i>
          </button>
          <button id="btn-view-kanban" class="btn btn--sm btn--outline" title="Visualização Kanban">
            <i class="fa-solid fa-table-columns"></i>
          </button>
        </div>` : ""}
      </div>
      <div id="os-tabela"><div class="loading"><i class="fa-solid fa-spinner spin"></i></div></div>
    </div></div>
  `);

  const btnNovoOS = document.getElementById("os-novo");
  if (btnNovoOS) btnNovoOS.onclick = () => abrirEditor();
  document.getElementById("os-busca").oninput = debounce((e) => { busca = e.target.value.trim(); viewAtual === "kanban" ? carregarKanban() : carregar(); });
  document.getElementById("os-status").onchange = (e) => { filtroStatus = e.target.value; viewAtual === "kanban" ? carregarKanban() : carregar(); };

  let viewAtual = "lista";

  if (!EH_ORC) {
    document.getElementById("btn-view-lista")?.addEventListener("click", () => {
      viewAtual = "lista";
      document.getElementById("btn-view-lista").className = "btn btn--sm btn--primary";
      document.getElementById("btn-view-kanban").className = "btn btn--sm btn--outline";
      carregar();
    });
    document.getElementById("btn-view-kanban")?.addEventListener("click", () => {
      viewAtual = "kanban";
      document.getElementById("btn-view-lista").className = "btn btn--sm btn--outline";
      document.getElementById("btn-view-kanban").className = "btn btn--sm btn--primary";
      carregarKanban();
    });
  }

  async function carregar() {
    const p = new URLSearchParams({ orcamento: EH_ORC });
    if (filtroStatus) p.set("status", filtroStatus);
    if (busca) p.set("q", busca);
    const alvo = document.getElementById("os-tabela");
    alvo.innerHTML = `<div class="loading"><i class="fa-solid fa-spinner spin"></i></div>`;
    try {
      const r = await API.get(`/api/os?${p}`);
      const lista = r.dados || [];
      if (!lista.length) { alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-inbox"></i>Nenhum registro</div>`; return; }
      // No orçamento o cabeçalho é "ID" e mostra só o número (sem o prefixo "OS-"/"ORC-").
      const semPrefixo = (n) => (n && n.includes("-")) ? n.slice(n.indexOf("-") + 1) : (n || "-");
      alvo.innerHTML = `<div class="table-wrap"><table class="data">
        <thead><tr><th>ID</th><th>Cliente</th><th>Veículo</th><th>Status</th><th>Mecânico</th><th></th></tr></thead>
        <tbody>${lista.map((o) => `<tr>
          <td><b>${EH_ORC ? semPrefixo(o.numero) : (o.numero || "-")}</b></td>
          <td>${o.cliente_nome || "-"}</td>
          <td>${o.veiculo_placa || o.veiculo_modelo || "-"}</td>
          <td>
            <span class="badge badge--${STATUS_TOM[o.status] || ""}">${STATUS_LABEL[o.status] || o.status}</span>
            ${o.os_origem_id ? `<span class="badge" style="background:#f59e0b20;color:#f59e0b;margin-left:4px;font-size:.7rem">retorno</span>` : ""}
          </td>
          <td>${o.mecanico_nome || "-"}</td>
          <td class="text-right">
            <button class="icon-btn btn--sm" title="Abrir" onclick="window.__os.abrir(${o.id})"><i class="fa-solid fa-eye"></i></button>
            ${soLeitura ? "" : `<button class="icon-btn btn--sm" title="Excluir" onclick="window.__os.excluir(${o.id})"><i class="fa-solid fa-trash"></i></button>`}
          </td></tr>`).join("")}
        </tbody></table></div>`;
    } catch (e) {
      alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
    }
  }

  function selectHtml(nome, lista, rotulo, valorSel, campoValor = "id") {
    const ops = lista.map((x) => `<option value="${x[campoValor]}" ${String(x[campoValor]) === String(valorSel) ? "selected" : ""}>${rotulo(x)}</option>`).join("");
    return `<select name="${nome}"><option value="">— selecione —</option>${ops}</select>`;
  }

  function linhaItemHtml(it = {}) {
    const idx = Math.random().toString(36).slice(2, 8);
    return `<tr data-item="${idx}">
      <td><select onchange="window.__os.tipoItem('${idx}', this.value)">
        <option value="produto" ${it.tipo === "produto" ? "selected" : ""}>Produto</option>
        <option value="servico" ${it.tipo === "servico" ? "selected" : ""}>Serviço</option></select></td>
      <td><input class="it-desc" value="${(it.descricao || "").replace(/"/g, "&quot;")}" placeholder="descrição"></td>
      <td style="width:80px"><input class="it-qtd" type="number" step="0.01" min="0" value="${it.quantidade ?? 1}" oninput="window.__os.calc()"></td>
      <td style="width:110px"><input class="it-val" type="number" step="0.01" min="0" value="${it.valor_unitario ?? 0}" oninput="window.__os.calc()"></td>
      <td class="it-sub text-right">${fmt.moeda((it.quantidade ?? 1) * (it.valor_unitario ?? 0))}</td>
      <td><button class="icon-btn btn--sm" onclick="window.__os.remItem('${idx}')"><i class="fa-solid fa-xmark"></i></button></td>
    </tr>`;
  }

  // Linha da tabela de "Peças trocadas" (modo OS). Sempre do tipo produto.
  function linhaPecaHtml(it = {}) {
    const idx = Math.random().toString(36).slice(2, 8);
    const nome = (it.descricao || it.nome || "").replace(/"/g, "&quot;");
    return `<tr data-peca="${idx}">
      <td>${nome}<input type="hidden" class="pc-desc" value="${nome}"></td>
      <td style="width:44px"><button class="icon-btn btn--sm" onclick="window.__os.remPeca('${idx}')"><i class="fa-solid fa-xmark"></i></button></td>
    </tr>`;
  }

  // Janela de consulta de produtos, aberta com F1 no campo de peças.
  // Navegação por teclado: ↑ ↓ move · Enter seleciona · Esc fecha.
  function abrirBuscaProdutos(onPick) {
    document.getElementById("os-busca-prod")?.remove();
    const wrap = document.createElement("div");
    wrap.id = "os-busca-prod";
    wrap.className = "peca-search";
    wrap.innerHTML = `
      <div class="peca-search__box">
        <div class="peca-search__head">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input id="peca-search-input" placeholder="Buscar peça no cadastro de produtos…" autocomplete="off">
          <button class="icon-btn" id="peca-search-close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="peca-search__list" id="peca-search-list"></div>
        <div class="peca-search__foot">↑ ↓ navegar · Enter selecionar · Esc fechar</div>
      </div>`;
    document.body.appendChild(wrap);

    const input = wrap.querySelector("#peca-search-input");
    const lista = wrap.querySelector("#peca-search-list");
    let filtrados = produtos.slice();
    let sel = 0;

    const cardHtml = (p, i) => {
      const cod = p.codigo || p.sku || p.referencia || "";
      const est = p.estoque ?? p.estoque_atual ?? p.quantidade;
      return `<div class="peca-item" data-i="${i}">
        <div class="peca-item__nome">${p.nome || "-"}</div>
        <div class="peca-item__meta">
          ${cod ? `<span>Cód: ${cod}</span>` : ""}
          ${est != null ? `<span>Estoque: ${est}</span>` : ""}
          <span>${fmt.moeda(p.preco_venda ?? 0)}</span>
        </div></div>`;
    };
    function marcar() {
      lista.querySelectorAll(".peca-item").forEach((el, i) => el.classList.toggle("ativo", i === sel));
      lista.querySelector(".peca-item.ativo")?.scrollIntoView({ block: "nearest" });
    }
    function render() {
      lista.innerHTML = filtrados.length
        ? filtrados.map((p, i) => cardHtml(p, i)).join("")
        : `<div class="peca-search__vazio">Nenhum produto encontrado</div>`;
      lista.querySelectorAll(".peca-item").forEach((el) =>
        el.onclick = () => escolher(parseInt(el.dataset.i, 10)));
      marcar();
    }
    function filtrar() {
      const q = input.value.trim().toLowerCase();
      filtrados = !q ? produtos.slice() : produtos.filter((p) => {
        const cod = String(p.codigo || p.sku || p.referencia || "").toLowerCase();
        return (p.nome || "").toLowerCase().includes(q) || cod.includes(q);
      });
      sel = 0; render();
    }
    function escolher(i) { const p = filtrados[i]; if (p) { onPick(p); fechar(); } }
    function fechar() { wrap.remove(); document.removeEventListener("keydown", teclado, true); }
    function teclado(e) {
      if (e.key === "Escape") { e.preventDefault(); fechar(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, filtrados.length - 1); marcar(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); marcar(); }
      else if (e.key === "Enter") { e.preventDefault(); escolher(sel); }
    }
    input.oninput = filtrar;
    wrap.querySelector("#peca-search-close").onclick = fechar;
    wrap.onclick = (e) => { if (e.target === wrap) fechar(); };
    document.addEventListener("keydown", teclado, true);
    render();
    setTimeout(() => input.focus(), 30);
  }

  async function abrirEditor(registro = null) {
    itensAtuais = [];
    let o = registro;
    if (registro && registro.id) {
      try { o = await API.get(`/api/os/${registro.id}`); } catch (_) {}
    }
    const ed = o && o.id;
    const itensHtml = (ed && o.itens || []).map(linhaItemHtml).join("");

    // Modo OS: "Peças trocadas" reaproveita os itens do tipo produto já gravados.
    // Itens de serviço (ex.: OS convertida de orçamento) são preservados intactos.
    const itensExist = (ed && o.itens) || [];
    pecasPreservadas = EH_ORC ? [] : itensExist.filter((i) => i.tipo !== "produto");
    const pecasHtml = EH_ORC ? "" : itensExist.filter((i) => i.tipo === "produto").map(linhaPecaHtml).join("");

    Modal.abrir(`${ed ? (o.numero || "OS") : (EH_ORC ? "Novo orçamento" : "Nova OS")}`, `
      <div class="form-grid" id="os-form">
        <div class="field col-2"><label>Cliente *</label>${selectHtml("cliente_id", clientes, (c) => c.nome, ed ? o.cliente_id : "")}</div>
        <div class="field"><label>Veículo</label>${selectHtml("veiculo_id", veiculos, (v) => `${v.placa || ""} ${v.modelo || ""}`.trim(), ed ? o.veiculo_id : "")}</div>
        <div class="field"><label>Mecânico</label>${selectHtml("mecanico_id", mecanicos, (m) => m.nome, ed ? o.mecanico_id : "")}</div>
        <div class="field"><label>Status</label><select name="status">
          ${(Layout.usuario?.perfil === "mecanico"
            ? STATUS.filter((s) => !["finalizada", "cancelada"].includes(s))
            : STATUS
          ).map((s) => `<option value="${s}" ${ed && o.status === s ? "selected" : ""}>${STATUS_LABEL[s]}</option>`).join("")}</select></div>
        <div class="field"><label>Previsão</label><input type="date" name="previsao" value="${ed && o.previsao ? String(o.previsao).slice(0,10) : ""}"></div>
        <div class="field col-2"><label>Problema relatado</label><textarea name="problema">${ed ? (o.problema || "") : ""}</textarea></div>
        <div class="field col-2"><label>Diagnóstico</label><textarea name="diagnostico">${ed ? (o.diagnostico || "") : ""}</textarea></div>
        <div class="field"><label>Horas trabalhadas</label><input type="number" step="0.5" name="horas_trabalhadas" value="${ed ? (o.horas_trabalhadas || 0) : 0}"></div>
        ${EH_ORC ? `<div class="field"><label>Garantia</label><input name="garantia" value="${ed ? (o.garantia || "") : ""}"></div>` : ""}
      </div>

      ${!EH_ORC ? `
      <div class="os-itens os-pecas">
        <div class="os-itens__head">
          <h3>Peças trocadas</h3>
          <span class="os-pecas__hint">Digite ou pressione <kbd>F1</kbd> para buscar no cadastro de produtos</span>
        </div>
        <div class="field">
          <label>Adicionar peça</label>
          <input id="os-peca-busca" placeholder="Nome da peça… (F1 abre a busca)" autocomplete="off">
        </div>
        <div class="table-wrap"><table class="data os-itens__table">
          <thead><tr><th>Peça</th><th></th></tr></thead>
          <tbody id="os-pecas-body">${pecasHtml}</tbody>
        </table></div>
      </div>` : ""}

      ${EH_ORC ? `
      <div class="os-itens">
        <div class="os-itens__head">
          <h3>Itens</h3>
          <button class="btn btn--ghost btn--sm" onclick="window.__os.addItem()"><i class="fa-solid fa-plus"></i> Adicionar item</button>
        </div>
        <div class="table-wrap"><table class="data os-itens__table">
          <thead><tr><th>Tipo</th><th>Descrição</th><th>Qtd</th><th>Vlr unit.</th><th>Subtotal</th><th></th></tr></thead>
          <tbody id="os-itens-body">${itensHtml}</tbody>
        </table></div>
        <datalist id="dl-produtos">${produtos.map((p) => `<option data-val="${p.preco_venda}" value="${p.nome}">`).join("")}</datalist>
        <datalist id="dl-servicos">${servicos.map((s) => `<option data-val="${s.valor}" value="${s.descricao}">`).join("")}</datalist>
        <div class="os-total">
          <div class="field" style="max-width:160px"><label>Desconto (R$)</label>
            <input type="number" step="0.01" name="desconto" value="${ed ? (o.desconto || 0) : 0}" oninput="window.__os.calc()"></div>
          <div class="os-total__valor">Total: <b id="os-total-val">${fmt.moeda(ed ? o.total : 0)}</b></div>
        </div>
      </div>` : ""}
    `, `
      <button class="btn btn--ghost" onclick="Modal.fechar()">${soLeitura ? "Fechar" : "Cancelar"}</button>
      ${ed ? `<button class="btn btn--ghost" onclick="window.__os.imprimir(${o.id})"><i class="fa-solid fa-print"></i> Imprimir</button>` : ""}
      ${ed && !EH_ORC ? `<button class="btn btn--outline" onclick="window.__os.abrirChecklist(${o.id})"><i class="fa-solid fa-clipboard-check"></i> Checklist</button>` : ""}
      ${ed && !EH_ORC && o.status === "finalizada" ? `<button class="btn btn--outline" onclick="window.__nps?.abrirEnvio(${o.id},${o.cliente_id},'${(o.cliente_nome||'').replace(/'/g,"\'")}','${o.cliente_email||''}','${o.cliente_whatsapp||o.cliente_telefone||''}')"><i class="fa-solid fa-star"></i> NPS</button>` : ""}
      ${ed && !EH_ORC && ["finalizada","finalizada_mecanico"].includes(o.status) ? `<button class="btn btn--outline" onclick="window.__os.abrirRetorno(${o.id},'${(o.numero||'').replace(/'/g,"\'")}')"><i class="fa-solid fa-rotate-left"></i> OS Retorno</button>` : ""}
      ${!soLeitura && ed && EH_ORC ? `<button class="btn btn--accent" onclick="window.__os.converter(${o.id})"><i class="fa-solid fa-right-to-bracket"></i> Converter em OS</button>` : ""}
      ${!soLeitura && ed && !EH_ORC && o.status === "aguardando_aprovacao" && Layout.usuario?.perfil !== "mecanico"
        ? `<button class="btn btn--primary" onclick="window.__os.gerarOrcamento(${o.id})"><i class="fa-solid fa-file-invoice-dollar"></i> Gerar Orçamento</button>`
        : ""}
      ${!soLeitura && ed && !EH_ORC && o.status === "finalizada_mecanico" && Layout.usuario?.perfil !== "mecanico"
        ? `<button class="btn btn--success" onclick="window.__os.finalizar(${o.id})"><i class="fa-solid fa-flag-checkered"></i> Finalizar definitivo</button>`
        : ""}
      ${!soLeitura && ed && !EH_ORC && o.status !== "finalizada" && o.status !== "finalizada_mecanico" && o.status !== "aguardando_aprovacao" && Layout.usuario?.perfil !== "mecanico"
        ? `<small class="text-muted" style="align-self:center">Aguardando mecânico finalizar</small>`
        : ""}
      ${soLeitura ? "" : (() => {
        const esconderSalvar = ed && !EH_ORC && Layout.usuario?.perfil !== "mecanico"
          && (o.status === "finalizada_mecanico" || o.status === "aguardando_aprovacao");
        return esconderSalvar ? "" : `<button class="btn btn--primary" id="os-salvar"><i class="fa-solid fa-check"></i> Salvar</button>`;
      })()}
    `, true);

    window.__os = api;
    if (soLeitura) {
      // Visualização: desabilita todos os campos, sem salvar.
      document.querySelectorAll("#os-form input, #os-form select, #os-form textarea")
        .forEach((el) => { el.disabled = true; });
      return;
    }
    const btnSalvar = document.getElementById("os-salvar");
    if (btnSalvar) btnSalvar.onclick = () => salvar(ed ? o.id : null, ed ? o : null);
    api.calc();

    // Campo "Peças trocadas": F1 abre a consulta de produtos; Enter/seleção adiciona.
    const pecaBusca = document.getElementById("os-peca-busca");
    if (pecaBusca) {
      const norm = (s) => (s || "").trim().toLowerCase();

      // Busca por nome OU código OU código de barras/EAN
      const encontrarProduto = (texto) => {
        const q = norm(texto);
        return produtos.find((x) =>
          norm(x.nome) === q ||
          norm(x.codigo || "") === q ||
          norm(x.codigo_barras || "") === q ||
          norm(x.ean || "") === q
        );
      };

      const tentarAdicionar = () => {
        const p = encontrarProduto(pecaBusca.value);
        if (p) { api.addPeca(p); pecaBusca.value = ""; return true; }
        return false;
      };

      // Detecção de coletor de dados: scanners enviam os caracteres muito
      // rapidamente (< 50ms entre teclas) e terminam com Enter.
      // Se detectar leitura de scanner, tenta adicionar direto sem abrir busca.
      let _ultimaTecla = 0;
      let _bufferScanner = "";
      let _timerScanner = null;

      pecaBusca.addEventListener("keydown", (e) => {
        if (e.key === "F1") {
          e.preventDefault();
          abrirBuscaProdutos((p) => api.addPeca(p));
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          if (!tentarAdicionar()) abrirBuscaProdutos((p) => api.addPeca(p));
          return;
        }
        // Detecta velocidade de digitação — scanner digita < 50ms por tecla
        const agora = Date.now();
        const intervalo = agora - _ultimaTecla;
        _ultimaTecla = agora;
        if (intervalo < 50 && e.key.length === 1) {
          _bufferScanner += e.key;
          clearTimeout(_timerScanner);
          // Se parar de receber chars por 80ms, considera leitura completa
          _timerScanner = setTimeout(() => {
            if (_bufferScanner.length >= 4) {
              // Tenta encontrar pelo buffer (código de barras)
              const p = encontrarProduto(_bufferScanner);
              if (p) {
                api.addPeca(p);
                pecaBusca.value = "";
                toast(`✓ ${p.nome} adicionado via coletor`, "success");
              } else {
                // Não encontrou — deixa no campo para o usuário ver
                pecaBusca.value = _bufferScanner;
                toast("Código não encontrado no cadastro", "warning");
              }
            }
            _bufferScanner = "";
          }, 80);
        } else {
          // Digitação manual — limpa o buffer do scanner
          _bufferScanner = "";
        }
      });
    }
  }

  const api = {
    abrir: (id) => abrirEditor({ id }),
    async imprimir(id) {
      try {
        const o = await API.get(`/api/os/${id}`);
        imprimirRecibo(o);
      } catch (e) { toast(e.message, "error"); }
    },
    addItem() {
      document.getElementById("os-itens-body").insertAdjacentHTML("beforeend", linhaItemHtml());
      this.calc();
    },
    remItem(idx) {
      document.querySelector(`[data-item="${idx}"]`)?.remove();
      this.calc();
    },
    addPeca(prod) {
      const body = document.getElementById("os-pecas-body");
      if (!body) return;
      body.insertAdjacentHTML("beforeend", linhaPecaHtml({
        descricao: prod.nome, quantidade: 1, valor_unitario: prod.preco_venda ?? 0,
      }));
    },
    remPeca(idx) {
      document.querySelector(`[data-peca="${idx}"]`)?.remove();
    },
    _coletarPecas() {
      const itens = [];
      const norm = (s) => (s || "").trim().toLowerCase();
      document.querySelectorAll("#os-pecas-body tr").forEach((tr) => {
        const desc = tr.querySelector(".pc-desc").value.trim();
        if (!desc) return;
        const p = produtos.find((x) => norm(x.nome) === norm(desc));
        itens.push({
          tipo: "produto",
          referencia_id: p ? p.id : null,   // vincula ao cadastro p/ baixa de estoque na finalização
          codigo: p ? (p.codigo || p.sku || p.referencia || "") : null,  // já leva o código do cadastro
          descricao: desc,
          unidade: p ? (p.unidade || "UN") : "UN",
          quantidade: 1,        // peça trocada é informativa: 1 unidade, sem valor
          valor_unitario: 0,
        });
      });
      return itens;
    },
    tipoItem(idx, tipo) {
      const linha = document.querySelector(`[data-item="${idx}"]`);
      const desc = linha.querySelector(".it-desc");
      desc.setAttribute("list", tipo === "produto" ? "dl-produtos" : "dl-servicos");
    },
    calc() {
      const body = document.getElementById("os-itens-body");
      const totalEl = document.getElementById("os-total-val");
      // No modo OS não há seção de itens/desconto/total — nada a calcular.
      if (!body || !totalEl) return;
      let total = 0;
      body.querySelectorAll("tr").forEach((tr) => {
        const q = parseFloat(tr.querySelector(".it-qtd").value) || 0;
        const v = parseFloat(tr.querySelector(".it-val").value) || 0;
        tr.querySelector(".it-sub").textContent = fmt.moeda(q * v);
        total += q * v;
      });
      const descEl = document.querySelector('[name="desconto"]');
      const desc = descEl ? (parseFloat(descEl.value) || 0) : 0;
      totalEl.textContent = fmt.moeda(Math.max(0, total - desc));
    },
    _coletarItens() {
      const itens = [];
      document.querySelectorAll("#os-itens-body tr").forEach((tr) => {
        const desc = tr.querySelector(".it-desc").value.trim();
        if (!desc) return;
        const tipo = tr.querySelector("select").value;
        // Vincula o item ao cadastro (produto/serviço) pelo nome, para que a
        // finalização da OS consiga dar baixa no estoque do produto correto.
        const norm = (s) => (s || "").trim().toLowerCase();
        let referencia_id = null;
        if (tipo === "produto") {
          const p = produtos.find((x) => norm(x.nome) === norm(desc));
          if (p) referencia_id = p.id;
        } else {
          const s = servicos.find((x) => norm(x.descricao) === norm(desc));
          if (s) referencia_id = s.id;
        }
        itens.push({
          tipo,
          referencia_id,
          descricao: desc,
          quantidade: parseFloat(tr.querySelector(".it-qtd").value) || 0,
          valor_unitario: parseFloat(tr.querySelector(".it-val").value) || 0,
        });
      });
      return itens;
    },
    async gerarOrcamento(id) {
      if (!confirm("Gerar um Orçamento a partir desta OS?\n\nA OS continua em aberto (aguardando aprovação) — o orçamento é só para o cliente aprovar.")) return;
      try {
        const r = await API.post(`/api/os/${id}/para-orcamento`);
        toast("Orçamento gerado — a OS permanece em aberto");
        // Abre o ORÇAMENTO recém-criado (registro novo) e vincula o número da
        // OS de origem como OS relacionada na nota.
        if (r.orcamento_id) {
          sessionStorage.setItem("orc_os_origem", JSON.stringify({
            id: r.orcamento_id, numero: r.os_numero,
          }));
        }
        Modal.fechar();
        location.href = "/orcamentos";
      } catch (e) { toast(e.message, "error"); }
    },
    async converter(id) {
      if (!confirm("Converter este orçamento em Ordem de Serviço?")) return;
      try { await API.post(`/api/os/${id}/converter`); toast("Convertido em OS"); Modal.fechar(); carregar(); }
      catch (e) { toast(e.message, "error"); }
    },
    async finalizar(id) {
      const gerar = confirm("Finalizar a OS?\n\nOK = finalizar e gerar conta a receber.\nCancelar = apenas finalizar.");
      try {
        await API.post(`/api/os/${id}/finalizar`, gerar ? { gerar_financeiro: true, forma_pagamento: "dinheiro" } : {});
        toast("OS finalizada"); Modal.fechar(); carregar();
      } catch (e) { toast(e.message, "error"); }
    },
    async excluir(id) {
      if (!confirm(`⚠️ Excluir OS\n\nTem certeza que deseja excluir este registro?\n\nEsta ação não pode ser desfeita.`)) return;
      try { await API.del(`/api/os/${id}`); toast("Excluído"); carregar(); }
      catch (e) { toast(e.message, "error"); }
    },
  };

  async function salvar(id, original) {
    const f = document.getElementById("os-form");
    // O container é uma <div>, então lemos cada campo por [name="..."].
    const g = (n) => f.querySelector(`[name="${n}"]`);
    const val = (n) => { const el = g(n); return el ? el.value : ""; };

    if (!val("cliente_id")) { toast("Selecione o cliente", "warning"); return; }
    const dados = {
      cliente_id: val("cliente_id"),
      veiculo_id: val("veiculo_id") || null,
      mecanico_id: val("mecanico_id") || null,
      status: val("status"),
      previsao: val("previsao") || null,
      problema: val("problema"),
      diagnostico: val("diagnostico"),
      horas_trabalhadas: parseFloat(val("horas_trabalhadas")) || 0,
      eh_orcamento: EH_ORC,
    };

    // Garantia, desconto e itens só existem no orçamento. Na OS (uso do
    // mecânico) esses campos não aparecem — então preservamos os valores que
    // já estavam gravados (importante quando a OS veio de um orçamento).
    const garEl = g("garantia");
    const descEl = g("desconto");
    if (garEl) dados.garantia = garEl.value;
    else if (original) dados.garantia = original.garantia;

    if (descEl) {
      // Modo orçamento: envia desconto e itens editados.
      dados.desconto = parseFloat(descEl.value) || 0;
      dados.itens = api._coletarItens();
    } else {
      // Modo OS: mantém o desconto atual e envia as PEÇAS TROCADAS como itens
      // (tipo produto), preservando itens não-produto já gravados (ex.: serviços
      // de uma OS convertida de orçamento).
      if (original) dados.desconto = original.desconto || 0;
      const preservados = pecasPreservadas.map((p) => ({
        tipo: p.tipo,
        referencia_id: p.referencia_id ?? null,
        descricao: p.descricao,
        quantidade: p.quantidade,
        valor_unitario: p.valor_unitario,
      }));
      dados.itens = [...api._coletarPecas(), ...preservados];
    }

    try {
      if (id) await API.put(`/api/os/${id}`, dados);
      else await API.post("/api/os", dados);
      toast("Registro salvo");
      Modal.fechar();
      carregar();
    } catch (e) { toast(e.message, "error"); }
  }

  // ---------------------------------------------------------------------
  // Dados da oficina (cabeçalho do recibo) — guardados no navegador.
  // Simples e imediato; se quiser compartilhar entre computadores/usuários,
  // dá para migrar para uma tabela de configurações no banco depois.
  // ---------------------------------------------------------------------
  // Dados da empresa vêm das Configurações (banco), carregados em Layout.config.
  function _dadosOficina() {
    const c = Layout.config || {};
    return {
      nome: c.empresa_nome || "",
      endereco: Layout.enderecoLinhas().join("<br>"),
      telefone: c.empresa_telefone || "",
      cnpj: c.empresa_cnpj || "",
      logo: c.empresa_logo || "",
    };
  }

  // Gera o recibo em A4 numa nova janela e chama a impressão do navegador
  // (o próprio "Imprimir" permite salvar em PDF).
  function imprimirRecibo(o) {
    const ofc = _dadosOficina();
    if (!ofc.nome) {
      toast("Configure os dados da empresa em Configurações (administrador).", "warning");
      return;
    }

    const ehOrc = Number(o.eh_orcamento) === 1;
    const titulo = ehOrc ? "Orçamento" : "Ordem de Serviço";
    const itens = o.itens || [];
    const bruto = itens.reduce((s, i) => s + (i.subtotal || (i.quantidade * i.valor_unitario) || 0), 0);
    const desc = Number(o.desconto || 0);

    const linhas = itens.map((i) => `
      <tr>
        <td>${i.tipo === "produto" ? "Peça" : "Serviço"}</td>
        <td>${i.descricao || "-"}</td>
        <td class="c">${i.quantidade}</td>
        <td class="r">${fmt.moeda(i.valor_unitario)}</td>
        <td class="r">${fmt.moeda(i.subtotal || i.quantidade * i.valor_unitario)}</td>
      </tr>`).join("") || `<tr><td colspan="5" class="c">Sem itens lançados</td></tr>`;

    const bloco = (rot, val) => val ? `<div><span>${rot}:</span> ${val}</div>` : "";
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
      <title>${titulo} ${o.numero || ""}</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; padding: 24px; font-size: 13px; }
        .topo { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 12px; }
        .of-nome { font-size: 20px; font-weight: 800; }
        .of-dados { font-size: 12px; color: #444; margin-top: 4px; line-height: 1.5; }
        .doc { text-align: right; }
        .doc h2 { margin: 0; font-size: 16px; }
        .doc .num { font-size: 18px; font-weight: 800; }
        .doc .data { font-size: 12px; color: #444; }
        .secao { display: flex; gap: 40px; margin: 16px 0; }
        .secao .col { flex: 1; }
        .secao h3 { font-size: 12px; text-transform: uppercase; color: #666; margin: 0 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 3px; }
        .secao div { margin: 2px 0; }
        .secao span { color: #666; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        th, td { padding: 7px 8px; border-bottom: 1px solid #ddd; text-align: left; }
        th { background: #f2f2f2; font-size: 11px; text-transform: uppercase; }
        td.c, th.c { text-align: center; }
        td.r, th.r { text-align: right; }
        .totais { margin-top: 12px; margin-left: auto; width: 260px; }
        .totais div { display: flex; justify-content: space-between; padding: 3px 0; }
        .totais .grande { font-size: 18px; font-weight: 800; border-top: 2px solid #111; margin-top: 4px; padding-top: 8px; }
        .obs { margin-top: 16px; font-size: 12px; }
        .obs h3 { font-size: 12px; text-transform: uppercase; color: #666; margin: 0 0 4px; }
        .assinaturas { display: flex; gap: 40px; margin-top: 60px; }
        .assinaturas .ass { flex: 1; text-align: center; border-top: 1px solid #111; padding-top: 6px; font-size: 12px; }
        .rodape { margin-top: 30px; text-align: center; font-size: 11px; color: #888; }
        @media print { body { padding: 0; } @page { margin: 16mm; } }
      </style></head><body>
      <div class="topo">
        <div style="display:flex;gap:14px;align-items:flex-start">
          ${ofc.logo ? `<img src="${ofc.logo}" alt="logo" style="max-height:64px;max-width:120px;object-fit:contain">` : ""}
          <div>
            <div class="of-nome">${ofc.nome}</div>
            <div class="of-dados">
              ${ofc.endereco ? ofc.endereco + "<br>" : ""}
              ${ofc.telefone ? "Tel: " + ofc.telefone + " &nbsp; " : ""}
              ${ofc.cnpj ? "CNPJ: " + ofc.cnpj : ""}
            </div>
          </div>
        </div>
        <div class="doc">
          <h2>${titulo}</h2>
          <div class="num">${o.numero || ""}</div>
          <div class="data">${fmt.data(o.data || o.criado_em)}</div>
        </div>
      </div>

      <div class="secao">
        <div class="col">
          <h3>Cliente</h3>
          <div>${o.cliente_nome || "-"}</div>
        </div>
        <div class="col">
          <h3>Veículo</h3>
          ${bloco("Modelo", o.veiculo_modelo)}
          ${bloco("Placa", o.veiculo_placa)}
          ${o.mecanico_nome ? bloco("Mecânico", o.mecanico_nome) : ""}
        </div>
      </div>

      ${(o.problema || o.diagnostico) ? `<div class="obs">
        ${o.problema ? `<h3>Problema relatado</h3><div>${o.problema}</div>` : ""}
        ${o.diagnostico ? `<h3 style="margin-top:8px">Diagnóstico</h3><div>${o.diagnostico}</div>` : ""}
      </div>` : ""}

      <table>
        <thead><tr><th>Tipo</th><th>Descrição</th><th class="c">Qtd</th><th class="r">Vlr unit.</th><th class="r">Subtotal</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>

      <div class="totais">
        <div><span>Subtotal</span><span>${fmt.moeda(bruto)}</span></div>
        ${desc ? `<div><span>Desconto</span><span>- ${fmt.moeda(desc)}</span></div>` : ""}
        <div class="grande"><span>TOTAL</span><span>${fmt.moeda(o.total != null ? o.total : bruto - desc)}</span></div>
      </div>

      ${o.garantia ? `<div class="obs"><h3>Garantia</h3><div>${o.garantia}</div></div>` : ""}

      <div class="assinaturas">
        <div class="ass">Cliente</div>
        <div class="ass">Responsável — ${ofc.nome}</div>
      </div>

      <div class="rodape">Emitido em ${fmt.dataHora(new Date().toISOString())} — ${ofc.nome}</div>

      <script>window.onload = function(){ window.print(); }<\/script>
      </body></html>`;

    const win = window.open("", "_blank", "width=800,height=900");
    if (!win) { toast("Permita pop-ups para imprimir o recibo", "warning"); return; }
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  // -----------------------------------------------------------------------
  // Kanban de OS
  // -----------------------------------------------------------------------

  // Colunas do Kanban — apenas os status ativos (sem finalizada/cancelada)
  const KANBAN_COLUNAS = [
    { status: "aberta",               label: "Abertas",            cor: "#3b82f6" },
    { status: "em_analise",           label: "Em Análise",         cor: "#8b5cf6" },
    { status: "aguardando_aprovacao", label: "Aguard. Aprovação",  cor: "#f59e0b" },
    { status: "aguardando_pecas",     label: "Aguard. Peças",      cor: "#ef4444" },
    { status: "em_execucao",          label: "Em Execução",        cor: "#0d9488" },
    { status: "finalizada_mecanico",  label: "Finaliz. Mecânico",  cor: "#10b981" },
  ];

  async function carregarKanban() {
    const alvo = document.getElementById("os-tabela");
    alvo.innerHTML = `<div class="loading"><i class="fa-solid fa-spinner spin"></i></div>`;
    try {
      // Carrega todas as OS abertas (sem filtro de status para preencher todas as colunas)
      const params = new URLSearchParams({ orcamento: "0", por_pagina: "500" });
      if (busca) params.set("q", busca);
      const r = await API.get(`/api/os?${params}`);
      const lista = (r.dados || []).filter((o) =>
        !["finalizada","cancelada"].includes(o.status));

      // Agrupa por status
      const grupos = {};
      KANBAN_COLUNAS.forEach((c) => { grupos[c.status] = []; });
      lista.forEach((o) => { if (grupos[o.status]) grupos[o.status].push(o); });

      // Monta o HTML do Kanban
      alvo.innerHTML = `
        <style>
          .kanban-board{display:flex;gap:.75rem;overflow-x:auto;padding-bottom:.5rem;align-items:flex-start}
          .kanban-col{flex:0 0 230px;background:var(--bg-alt,#f3f4f6);border-radius:10px;padding:.6rem}
          .kanban-col__head{display:flex;justify-content:space-between;align-items:center;
            padding:.4rem .5rem .6rem;font-weight:700;font-size:.82rem;text-transform:uppercase;letter-spacing:.4px}
          .kanban-col__count{background:rgba(0,0,0,.12);color:inherit;border-radius:99px;
            padding:1px 8px;font-size:.75rem;font-weight:700}
          .kanban-cards{display:flex;flex-direction:column;gap:.45rem;min-height:60px}
          .kanban-card{background:#fff;border-radius:8px;padding:.65rem .75rem;
            cursor:grab;box-shadow:0 1px 3px rgba(0,0,0,.08);border:1px solid #e5e7eb;
            transition:box-shadow .15s,transform .15s;user-select:none}
          .kanban-card:hover{box-shadow:0 4px 12px rgba(0,0,0,.12);transform:translateY(-1px)}
          .kanban-card.dragging{opacity:.45;transform:scale(.97)}
          .kanban-col.drag-over .kanban-cards{background:rgba(13,148,136,.08);
            border-radius:6px;outline:2px dashed #0d9488}
          .kanban-card__num{font-size:.72rem;color:var(--text-muted);margin-bottom:2px}
          .kanban-card__cliente{font-weight:700;font-size:.85rem;margin-bottom:2px;
            white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
          .kanban-card__veiculo{font-size:.78rem;color:var(--text-muted);
            white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
          .kanban-card__footer{display:flex;justify-content:space-between;
            align-items:center;margin-top:.45rem;padding-top:.4rem;border-top:1px solid #f0f0f0}
          .kanban-card__mec{font-size:.72rem;color:var(--text-muted)}
          .kanban-card__edit{opacity:0;transition:opacity .15s;background:none;border:none;
            cursor:pointer;color:var(--primary);padding:2px 5px;border-radius:4px}
          .kanban-card:hover .kanban-card__edit{opacity:1}
        </style>
        <div class="kanban-board" id="kanban-board">
          ${KANBAN_COLUNAS.map((col) => `
            <div class="kanban-col" data-status="${col.status}" id="kcol-${col.status}">
              <div class="kanban-col__head" style="color:${col.cor}">
                <span>${col.label}</span>
                <span class="kanban-col__count">${grupos[col.status].length}</span>
              </div>
              <div class="kanban-cards" id="kcards-${col.status}">
                ${grupos[col.status].map((o) => _kanbanCard(o)).join("")}
              </div>
            </div>`).join("")}
        </div>`;

      _ligarDragDrop();
    } catch(e) {
      alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
    }
  }

  function _kanbanCard(o) {
    const dias = o.previsao ? (() => {
      const d = Math.ceil((new Date(o.previsao+"T00:00") - new Date()) / 86400000);
      return d < 0
        ? `<span style="color:#ef4444;font-size:.7rem">⚠ ${Math.abs(d)}d atrasado</span>`
        : d === 0
        ? `<span style="color:#f59e0b;font-size:.7rem">⏰ Vence hoje</span>`
        : `<span style="color:var(--text-muted);font-size:.7rem">📅 ${d}d</span>`;
    })() : "";
    return `<div class="kanban-card" draggable="true" data-id="${o.id}" data-status="${o.status}">
      <div class="kanban-card__num">${o.numero || "—"}</div>
      <div class="kanban-card__cliente">${o.cliente_nome || "—"}</div>
      <div class="kanban-card__veiculo">${[o.veiculo_placa, o.veiculo_modelo].filter(Boolean).join(" · ") || "—"}</div>
      <div class="kanban-card__footer">
        <div class="kanban-card__mec">${o.mecanico_nome ? "🔧 "+o.mecanico_nome : ""}</div>
        ${dias}
        <button class="kanban-card__edit" onclick="event.stopPropagation();window.__os.abrir(${o.id})"
          title="Abrir OS"><i class="fa-solid fa-pen" style="font-size:.75rem"></i></button>
      </div>
    </div>`;
  }

  function _ligarDragDrop() {
    let cardArrastando = null;
    let statusOrigem = null;

    document.querySelectorAll(".kanban-card").forEach((card) => {
      card.addEventListener("dragstart", (e) => {
        cardArrastando = card;
        statusOrigem = card.dataset.status;
        setTimeout(() => card.classList.add("dragging"), 0);
        e.dataTransfer.effectAllowed = "move";
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("dragging");
        document.querySelectorAll(".kanban-col").forEach((c) => c.classList.remove("drag-over"));
        cardArrastando = null;
      });
    });

    document.querySelectorAll(".kanban-col").forEach((col) => {
      col.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        col.classList.add("drag-over");
      });
      col.addEventListener("dragleave", (e) => {
        if (!col.contains(e.relatedTarget)) col.classList.remove("drag-over");
      });
      col.addEventListener("drop", async (e) => {
        e.preventDefault();
        col.classList.remove("drag-over");
        if (!cardArrastando) return;
        const novoStatus = col.dataset.status;
        if (novoStatus === statusOrigem) return;
        const osId = cardArrastando.dataset.id;

        // Move card visualmente imediatamente
        const cardsDiv = col.querySelector(".kanban-cards");
        cardsDiv.appendChild(cardArrastando);
        cardArrastando.dataset.status = novoStatus;

        // Atualiza contador
        const countOrig = document.querySelector(`#kcol-${statusOrigem} .kanban-col__count`);
        const countDest = document.querySelector(`#kcol-${novoStatus} .kanban-col__count`);
        if (countOrig) countOrig.textContent = parseInt(countOrig.textContent) - 1;
        if (countDest) countDest.textContent = parseInt(countDest.textContent) + 1;

        statusOrigem = novoStatus;

        // Persiste no backend
        try {
          await API.put(`/api/os/${osId}`, { status: novoStatus });
          toast(`OS movida para ${STATUS_LABEL[novoStatus]}`, "success");
        } catch(err) {
          toast(err.message, "error");
          // Reverte visualmente em caso de erro
          carregarKanban();
        }
      });
    });
  }

  window.__os = api;

  // -----------------------------------------------------------------------
  // Checklist de Inspeção Veicular
  // -----------------------------------------------------------------------
  // -----------------------------------------------------------------------
  // OS de Retorno por Garantia
  // -----------------------------------------------------------------------
  api.abrirRetorno = async function(osId, osNumero) {
    // Busca garantias vigentes/acionadas desta OS
    let garantias = [];
    try {
      const r = await API.get(`/api/garantias?status=vigente`);
      garantias = (r.dados || []).filter((g) => g.os_id === osId || String(g.os_numero) === String(osNumero));
    } catch(_) {}

    const optsGar = garantias.length
      ? garantias.map((g) => `<option value="${g.id}">${g.descricao} — vence ${fmt.data(g.data_fim)}</option>`).join("")
      : `<option value="">Sem garantia vinculada</option>`;

    Modal.abrir(
      `<i class="fa-solid fa-rotate-left"></i> OS de Retorno — ${osNumero}`,
      `<p style="color:var(--text-muted);font-size:.85rem;margin-bottom:1rem">
        Será criada uma nova OS vinculada à OS <strong>${osNumero}</strong> como retorno de garantia.
        Cliente, veículo e mecânico serão copiados automaticamente.
      </p>
      <div class="form-grid" id="retorno-form">
        <div class="field col-2"><label>Garantia acionada</label>
          <select id="ret-garantia">${optsGar}</select>
        </div>
        <div class="field col-2"><label>Problema relatado *</label>
          <input id="ret-problema" placeholder="Descreva o motivo do retorno…"
            value="Retorno de garantia — OS ${osNumero}">
        </div>
      </div>`,
      `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
       <button class="btn btn--primary" id="ret-confirmar">
         <i class="fa-solid fa-check"></i> Criar OS de Retorno
       </button>`
    );

    document.getElementById("ret-confirmar").onclick = async () => {
      const problema = document.getElementById("ret-problema")?.value.trim();
      if (!problema) { toast("Descreva o problema", "warning"); return; }
      const garantia_id = document.getElementById("ret-garantia")?.value || null;
      const btn = document.getElementById("ret-confirmar");
      btn.disabled = true;
      btn.innerHTML = `<i class="fa-solid fa-spinner spin"></i> Criando…`;
      try {
        const r = await API.post(`/api/os/${osId}/retorno`, {
          problema,
          garantia_id: garantia_id ? parseInt(garantia_id) : null,
        });
        toast(`OS de retorno ${r.os_numero} criada com sucesso`);
        Modal.fechar();
        carregar();
      } catch(e) {
        toast(e.message, "error");
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-check"></i> Criar OS de Retorno`;
      }
    };
  };

  api.abrirChecklist = async function(osId) {
    Modal.abrir(
      `<i class="fa-solid fa-clipboard-check"></i> Checklist de Inspeção — OS ${osId}`,
      `<div id="chk-body"><div class="loading"><i class="fa-solid fa-spinner spin"></i> Carregando…</div></div>`,
      `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
       <button class="btn btn--outline" id="chk-imprimir"><i class="fa-solid fa-print"></i> Imprimir laudo</button>
       <button class="btn btn--primary" id="chk-salvar"><i class="fa-solid fa-check"></i> Salvar checklist</button>`,
      true
    );

    let _itens = [];

    try {
      const r = await API.get(`/api/os/${osId}/checklist`);
      _itens = r.itens || [];
      renderChecklist(_itens);
    } catch(e) {
      document.getElementById("chk-body").innerHTML =
        `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
      return;
    }

    function renderChecklist(itens) {
      const grupos = {};
      itens.forEach((it, idx) => {
        const g = it.grupo || "Outros";
        if (!grupos[g]) grupos[g] = [];
        grupos[g].push({ ...it, _idx: idx });
      });

      const cores = { ok: "#27ae60", avariado: "#e74c3c", nao_verificado: "#95a5a6" };
      const labels = { ok: "OK", avariado: "Avariado", nao_verificado: "Não verificado" };

      const html = Object.entries(grupos).map(([grupo, gItens]) => `
        <div style="margin-bottom:1.25rem">
          <div style="font-weight:700;font-size:.85rem;text-transform:uppercase;
            color:var(--primary);border-bottom:2px solid var(--primary);
            padding-bottom:4px;margin-bottom:.6rem;letter-spacing:.5px">${grupo}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:.4rem">
            ${gItens.map((it) => `
              <div style="display:flex;align-items:center;gap:.5rem;padding:.5rem .6rem;
                border-radius:6px;background:var(--bg-alt,#f8f9fa);
                border:1px solid ${it.status==="avariado"?"#fad7d7":it.status==="ok"?"#d4edda":"#e9ecef"};
                flex-direction:column;align-items:stretch">
                <div style="display:flex;align-items:center;gap:.5rem">
                  <select data-idx="${it._idx}" class="chk-status"
                    style="border:none;background:transparent;font-size:.8rem;
                    color:${cores[it.status]};font-weight:600;cursor:pointer;padding:0;flex:0 0 auto">
                    ${["ok","avariado","nao_verificado"].map((s) =>
                      `<option value="${s}" ${it.status===s?"selected":""}>${labels[s]}</option>`
                    ).join("")}
                  </select>
                  <span style="flex:1;font-size:.82rem;color:#333">${it.item}</span>
                </div>
                ${it.status==="avariado" ? `
                  <input class="chk-obs" data-idx="${it._idx}"
                    placeholder="Descreva o dano…" value="${(it.obs||"").replace(/"/g,"&quot;")}"
                    style="font-size:.75rem;padding:3px 6px;border:1px solid #ddd;
                    border-radius:4px;background:#fff">` : ""}
              </div>`).join("")}
          </div>
        </div>`).join("");

      const avariados = itens.filter((i) => i.status === "avariado").length;
      const verificados = itens.filter((i) => i.status !== "nao_verificado").length;

      document.getElementById("chk-body").innerHTML = `
        <div style="display:flex;gap:1rem;margin-bottom:1rem;flex-wrap:wrap;align-items:center">
          <div class="stat-mini"><span style="color:#27ae60">${itens.filter(i=>i.status==="ok").length}</span><label>OK</label></div>
          <div class="stat-mini"><span style="color:#e74c3c">${avariados}</span><label>Avariados</label></div>
          <div class="stat-mini"><span style="color:#888">${itens.filter(i=>i.status==="nao_verificado").length}</span><label>Não verificados</label></div>
          <div class="stat-mini"><span>${verificados}/${itens.length}</span><label>Verificados</label></div>
          <button class="btn btn--ghost btn--sm" style="margin-left:auto"
            onclick="window.__os._chkMarcarTodos('ok')">✓ Marcar todos OK</button>
        </div>
        <div id="chk-grupos">${html}</div>`;

      document.querySelectorAll(".chk-status").forEach((sel) => {
        sel.onchange = () => {
          _itens[parseInt(sel.dataset.idx)].status = sel.value;
          renderChecklist(_itens);
        };
      });
      document.querySelectorAll(".chk-obs").forEach((inp) => {
        inp.oninput = () => { _itens[parseInt(inp.dataset.idx)].obs = inp.value; };
      });
    }

    api._chkMarcarTodos = (status) => {
      _itens.forEach((it) => { it.status = status; });
      renderChecklist(_itens);
    };

    document.getElementById("chk-salvar").onclick = async () => {
      const btn = document.getElementById("chk-salvar");
      btn.disabled = true;
      btn.innerHTML = `<i class="fa-solid fa-spinner spin"></i> Salvando…`;
      try {
        const r = await API.post(`/api/os/${osId}/checklist`, { itens: _itens });
        toast(`Checklist salvo — ${r.avariados} item(s) avariado(s)`);
        Modal.fechar();
      } catch(e) {
        toast(e.message, "error");
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-check"></i> Salvar checklist`;
      }
    };

    document.getElementById("chk-imprimir").onclick = () => {
      const cfg = Layout.config || {};
      const empresa = cfg.empresa_nome || "Oficina";
      const hoje = new Date().toLocaleDateString("pt-BR");
      const avariados = _itens.filter((i) => i.status === "avariado");
      const ok = _itens.filter((i) => i.status === "ok");
      const nv = _itens.filter((i) => i.status === "nao_verificado");
      const grupos = {};
      _itens.forEach((it) => {
        const g = it.grupo || "Outros";
        if (!grupos[g]) grupos[g] = [];
        grupos[g].push(it);
      });
      const tabelaGrupos = Object.entries(grupos).map(([grupo, itens]) => `
        <tr style="background:#f0f0f0">
          <td colspan="3" style="padding:6px 8px;font-weight:700;font-size:11px;
            text-transform:uppercase;letter-spacing:.5px">${grupo}</td>
        </tr>
        ${itens.map((it) => `<tr>
          <td style="padding:5px 8px;font-size:11px">${it.item}</td>
          <td style="padding:5px 8px;text-align:center;font-size:11px;font-weight:700;
            color:${it.status==="ok"?"#27ae60":it.status==="avariado"?"#e74c3c":"#888"}">
            ${it.status==="ok"?"✓ OK":it.status==="avariado"?"✗ Avariado":"— N/V"}
          </td>
          <td style="padding:5px 8px;font-size:10px;color:#555">${it.obs||""}</td>
        </tr>`).join("")}`).join("");

      const w = window.open("", "_blank");
      w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
        <title>Checklist — OS ${osId}</title>
        <style>
          body{font-family:Arial,sans-serif;font-size:12px;padding:20px;color:#222}
          h1{font-size:16px;margin:0} h2{font-size:12px;color:#555;margin:2px 0 16px;font-weight:normal}
          table{width:100%;border-collapse:collapse;margin-top:12px}
          th{background:#1a6b6b;color:#fff;padding:7px 8px;text-align:left;font-size:11px}
          td{border-bottom:1px solid #eee}
          .resumo{display:flex;gap:24px;margin:12px 0;padding:10px;background:#f9f9f9;border-radius:6px}
          .resumo div{text-align:center} .resumo strong{display:block;font-size:18px}
          .resumo small{font-size:10px;color:#888}
          .assinatura{margin-top:48px;display:flex;justify-content:space-between;gap:40px}
          .assinatura div{text-align:center;flex:1}
          .assinatura hr{border:none;border-top:1px solid #333;margin-bottom:4px}
          @media print{body{padding:0}}
        </style>
      </head><body>
        <h1>Laudo de Inspeção Veicular</h1>
        <h2>${empresa} — OS ${osId} — ${hoje}</h2>
        <div class="resumo">
          <div><strong style="color:#27ae60">${ok.length}</strong><small>OK</small></div>
          <div><strong style="color:#e74c3c">${avariados.length}</strong><small>Avariados</small></div>
          <div><strong style="color:#888">${nv.length}</strong><small>Não verificados</small></div>
          <div><strong>${_itens.length}</strong><small>Total</small></div>
        </div>
        ${avariados.length ? `
          <div style="background:#fde8e8;border:1px solid #f5c6cb;border-radius:6px;padding:10px;margin-bottom:12px">
            <strong style="color:#c0392b">⚠ Avarias encontradas:</strong>
            <ul style="margin:6px 0 0 16px;padding:0">
              ${avariados.map((it) => `<li style="font-size:11px">${it.item}${it.obs?` — ${it.obs}`:""}</li>`).join("")}
            </ul>
          </div>` : `
          <div style="background:#d4edda;border:1px solid #c3e6cb;border-radius:6px;padding:10px;margin-bottom:12px">
            <strong style="color:#155724">✓ Nenhuma avaria encontrada</strong>
          </div>`}
        <table>
          <thead><tr><th>Item</th><th style="width:100px;text-align:center">Status</th><th>Observação</th></tr></thead>
          <tbody>${tabelaGrupos}</tbody>
        </table>
        <div class="assinatura">
          <div><hr>Responsável técnico / Mecânico</div>
          <div><hr>Cliente — Ciente das condições do veículo</div>
        </div>
        <p style="font-size:9px;color:#aaa;margin-top:20px;text-align:center">
          DevSystem PRIME — ${hoje} — OS ${osId}
        </p>
      </body></html>`);
      w.document.close();
      w.onload = () => w.print();
    };
  };

  carregar();
})();
