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

  let clientes = [], veiculos = [], produtos = [], servicos = [], ordens = [];
  let itens = [];         // itens do orçamento em edição
  let osRefs = [];        // OS relacionadas escolhidas para a nota A5 (não persistidas)
  let editando = null;    // registro em edição (null = novo)

  const FORMAS = ["Dinheiro", "Pix", "Cartão de Crédito", "Cartão de Débito", "Boleto"];

  const money = (v) => "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = (s) => (s == null ? "" : String(s).replace(/"/g, "&quot;"));

  await carregarRefs();
  renderLista();

  async function carregarRefs() {
    const [rc, rv, rp, rs, ro] = await Promise.allSettled([
      API.get("/api/clientes?por_pagina=1000&ordem=nome"),
      API.get("/api/veiculos?por_pagina=1000"),
      API.get("/api/produtos?por_pagina=1000&ordem=nome"),
      API.get("/api/servicos"),
      API.get("/api/os"),   // Ordens de Serviço (eh_orcamento=0) para referenciar
    ]);
    const ok = (r) => (r.status === "fulfilled" ? r.value : {});
    clientes = ok(rc).dados || [];
    veiculos = ok(rv).dados || [];
    produtos = ok(rp).dados || [];
    servicos = ok(rs).dados || [];
    ordens = ok(ro).dados || [];
  }

  /* ------------------------------------------------------------------ LISTA */
  // Agrupa o status da OS/orçamento em 3 grupos com badge colorido.
  function badgeStatus(status) {
    if (status === "finalizada") return `<span class="badge badge--success">Finalizado</span>`;
    if (status === "cancelada") return `<span class="badge badge--danger">Cancelado</span>`;
    return `<span class="badge badge--warning">Em andamento</span>`;
  }

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
          <thead><tr><th>ID</th><th>Cliente</th><th>Veículo</th><th>Data</th><th>Total</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${lista.length ? lista.map((o) => `<tr>
              <td><b>${(o.numero && o.numero.includes("-")) ? o.numero.slice(o.numero.indexOf("-") + 1) : (o.numero || "-")}</b></td>
              <td>${o.cliente_nome || "-"}</td>
              <td>${o.veiculo_placa || o.veiculo_modelo || "-"}</td>
              <td>${fmt.data(o.data || o.criado_em)}</td>
              <td>${money(o.total)}</td>
              <td>${badgeStatus(o.status)}</td>
              <td class="text-right">
                <button class="icon-btn btn--sm" title="Abrir" onclick="window.__orc.abrir(${o.id})"><i class="fa-solid fa-eye"></i></button>
                ${soLeitura ? "" : `<button class="icon-btn btn--sm" title="Excluir" onclick="window.__orc.excluir(${o.id})"><i class="fa-solid fa-trash"></i></button>`}
              </td></tr>`).join("") : `<tr><td colspan="7" class="text-center text-muted" style="padding:30px">Nenhum orçamento ainda.</td></tr>`}
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
    // Orçamento já finalizado não pode ser finalizado de novo: a tela abre
    // apenas para visualização (sem botões de ação).
    const jaFinalizado = orc?.status === "finalizada";
    itens = (orc?.itens || []).map((it) => ({
      tipo: it.tipo || "produto", referencia_id: it.referencia_id || null,
      codigo: it.codigo || "", descricao: it.descricao || "",
      unidade: it.unidade || "UN", quantidade: Number(it.quantidade) || 1,
      valor_unitario: Number(it.valor_unitario) || 0, desconto: Number(it.desconto) || 0,
    }));

    const cli = orc ? clientes.find((c) => c.id === orc.cliente_id) : null;

    // OS relacionadas (só para a nota A5; não são gravadas). Começa vazio; se
    // houver uma referência antiga salva em texto, semeia a lista com ela.
    osRefs = orc?.os_referencia
      ? String(orc.os_referencia).split(/[,;]+/).map((s) => ({ numero: s.trim() })).filter((x) => x.numero)
      : [];

    Layout.set(`
      <div class="orc">
        <div class="orc-topbar">
          <button class="orc-voltar" id="orc-voltar"><i class="fa-solid fa-arrow-left"></i></button>
          <h1>Orçamento</h1>
          <div class="orc-topbar__acoes">
            ${editando && !jaFinalizado ? `<button class="btn btn--ghost" id="orc-imprimir"><i class="fa-solid fa-print"></i> Imprimir</button>
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
            <div class="orc-doc-info"><i class="fa-solid fa-screwdriver-wrench"></i> OS relacionadas:
              ${soLeitura ? "" : `<button type="button" class="btn btn--ghost btn--sm" id="orc-os-add"><i class="fa-solid fa-plus"></i> Adicionar OS</button>`}</div>
            <div id="orc-os-lista" class="orc-os-lista"></div>
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
              <span class="orc-dica-f2">Na coluna <b>Código</b>, pressione <kbd>F2</kbd> para buscar o produto (nome, código ou código de barras)</span>
            </div>`}
          </div>
          <div class="table-wrap"><table class="orc-itens">
            <thead><tr>
              <th>ID</th><th>Código</th><th>Descrição</th><th>Qtd</th><th>Un</th>
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
              <div id="orc-cond-wrap"></div></label>
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
          ${jaFinalizado
            ? `<span class="orc-finalizado-tag"><i class="fa-solid fa-circle-check"></i> Orçamento finalizado</span>
               <button class="btn btn--primary" id="orc-ver-nota"><i class="fa-solid fa-file-invoice"></i> Ver / Imprimir nota</button>`
            : (soLeitura ? "" : (editando
              ? `<button class="btn btn--success" id="orc-salvar"><i class="fa-solid fa-flag-checkered"></i> Finalizar orçamento</button>
                 <button class="btn btn--ghost" id="orc-limpar"><i class="fa-solid fa-broom"></i> Limpar</button>`
              : `<button class="btn btn--success" id="orc-salvar"><i class="fa-solid fa-floppy-disk"></i> Salvar orçamento</button>`))}
          <button class="btn btn--danger-ghost" id="orc-cancelar"><i class="fa-solid fa-xmark"></i> ${(jaFinalizado || soLeitura) ? "Voltar" : "Cancelar"}</button>
        </div>
      </div>
    `);

    window.__orc = api;
    wireEditor();
    renderCondicoes(orc?.forma_pagamento, orc?.condicoes);
    preencherVeiculos(orc?.veiculo_id);
    preencherCliente();
    renderItens();
    recalc();
    renderOSRefs();
    if (soLeitura || jaFinalizado) document.querySelectorAll(".orc input, .orc select, .orc textarea").forEach((el) => el.disabled = true);
    else focarNovoCodigo();
  }

  // Opções de parcelamento no cartão de crédito.
  const PARCELAS_CARTAO = ["À vista", "2x", "3x", "4x", "5x", "6x"];

  // Desenha o campo "Condições": vira um seletor de parcelas quando a forma
  // é "Cartão de Crédito"; nas demais formas, é um campo de texto livre.
  // Mantém sempre o id="orc-cond" (o coletar() lê o .value desse id).
  function renderCondicoes(forma, valorAtual) {
    const wrap = document.getElementById("orc-cond-wrap");
    if (!wrap) return;
    const disabled = (soLeitura || (editando?.status === "finalizada")) ? "disabled" : "";
    if (forma === "Cartão de Crédito") {
      const val = PARCELAS_CARTAO.includes(valorAtual) ? valorAtual : "À vista";
      wrap.innerHTML = `<select id="orc-cond" ${disabled}>${PARCELAS_CARTAO
        .map((p) => `<option ${p === val ? "selected" : ""}>${p}</option>`).join("")}</select>`;
    } else {
      // Campo de texto livre (Pix, Dinheiro, etc.). Se por acaso chegar um valor
      // de parcela do cartão (ex.: "2x"), não faz sentido aqui: usa "À vista".
      const val = (!valorAtual || PARCELAS_CARTAO.includes(valorAtual)) ? "À vista" : valorAtual;
      wrap.innerHTML = `<input id="orc-cond" value="${esc(val)}" ${disabled}>`;
    }
  }

  /* ------------------------------------------------- OS relacionadas (A5) */
  // Desenha as OS escolhidas como "chips" removíveis abaixo do botão.
  function renderOSRefs() {
    const wrap = document.getElementById("orc-os-lista");
    if (!wrap) return;
    if (!osRefs.length) {
      wrap.innerHTML = `<span class="orc-os-vazio">Nenhuma OS relacionada.</span>`;
      return;
    }
    const podeRemover = !(soLeitura || editando?.status === "finalizada");
    wrap.innerHTML = osRefs.map((o, i) => `<span class="orc-os-chip">
      <b>${esc(o.numero)}</b>${o.cliente ? " · " + esc(o.cliente) : ""}
      ${podeRemover ? `<button type="button" class="orc-os-x" title="Remover" onclick="window.__orc.remOS(${i})">&times;</button>` : ""}
    </span>`).join("");
  }

  // Abre a busca de OS existentes e adiciona a escolhida à lista (sem duplicar).
  function buscarOS() {
    if (!ordens.length) { Toast?.("Nenhuma OS cadastrada para referenciar."); return; }
    const linhas = ordens.map((o) => ({
      id: o.id, numero: o.numero || "",
      cliente: o.cliente_nome || "", placa: o.veiculo_placa || "",
    }));
    Modal.abrir("Adicionar OS ao orçamento", `
      <input id="os-q" class="input" placeholder="Nº da OS, cliente ou placa…" style="width:100%;margin-bottom:10px">
      <div class="table-wrap" style="max-height:50vh;overflow:auto"><table class="data"><tbody id="os-lista">
        ${linhas.map((l, i) => linhaOS(l, i)).join("")}
      </tbody></table></div>`,
      `<button class="btn btn--ghost" onclick="Modal.fechar()">Fechar</button>`);
    window.__osBuscaLinhas = linhas;
    const q = document.getElementById("os-q");
    const lista = document.getElementById("os-lista");
    let sel = 0;
    const visiveis = () => [...lista.querySelectorAll("tr")].filter((tr) => tr.style.display !== "none");
    const marcar = () => {
      const vis = visiveis();
      lista.querySelectorAll("tr").forEach((tr) => tr.style.background = "");
      if (vis[sel]) { vis[sel].style.background = "rgba(13,148,136,.12)"; vis[sel].scrollIntoView({ block: "nearest" }); }
    };
    const filtrar = () => {
      const t = q.value.toLowerCase().trim();
      lista.querySelectorAll("tr").forEach((tr, i) => {
        const l = linhas[i];
        tr.style.display = `${l.numero} ${l.cliente} ${l.placa}`.toLowerCase().includes(t) ? "" : "none";
      });
      sel = 0; marcar();
    };
    q.oninput = filtrar;
    q.onkeydown = (e) => {
      const vis = visiveis();
      if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, vis.length - 1); marcar(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); marcar(); }
      else if (e.key === "Enter") { e.preventDefault(); if (vis[sel]) escolherOS([...lista.querySelectorAll("tr")].indexOf(vis[sel])); }
      else if (e.key === "Escape") { Modal.fechar(); }
    };
    marcar(); q.focus();
  }
  function linhaOS(l, i) {
    return `<tr style="cursor:pointer" onclick="window.__orc.pickOS(${i})">
      <td><b>${l.numero}</b></td>
      <td>${l.cliente || "—"}${l.placa ? " · " + l.placa : ""}</td></tr>`;
  }
  function escolherOS(i) {
    const l = window.__osBuscaLinhas?.[i];
    if (!l) return;
    if (!osRefs.some((o) => o.id === l.id || o.numero === l.numero)) {
      osRefs.push({ id: l.id, numero: l.numero, cliente: l.cliente });
    }
    Modal.fechar();
    renderOSRefs();
  }

  function wireEditor() {
    const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
    on("orc-voltar", "click", renderLista);
    on("orc-cancelar", "click", renderLista);
    on("orc-cliente", "change", () => { preencherVeiculos(); preencherCliente(); });
    on("orc-veiculo", "change", preencherVeiculoDados);
    on("orc-forma", "change", (e) => {
      // Ao trocar a forma, redesenha Condições do zero. Não reaproveita o valor
      // anterior: assim, sair do cartão (ex.: "2x") para Pix/Dinheiro/etc. volta
      // ao padrão "À vista", em vez de manter "2x" no campo de texto.
      renderCondicoes(e.target.value);
    });
    on("orc-os-add", "click", buscarOS);
    on("orc-desc", "input", recalc);
    on("orc-salvar", "click", editando ? finalizarOrcamento : salvar);
    on("orc-limpar", "click", () => abrirEditor(null));
    on("orc-imprimir", "click", imprimir);
    on("orc-pdf", "click", gerarPDF);
    on("orc-whats", "click", enviarWhats);
    on("orc-ver-nota", "click", async () => {
      // Reabre a folha A5 (nota) de um orçamento já finalizado, para
      // imprimir/entregar de novo caso o cliente tenha perdido a via.
      try {
        const o = editando?.id ? await API.get(`/api/os/${editando.id}`) : editando;
        telaA5(o, true);
      } catch (_) { if (editando) telaA5(editando, true); }
    });
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
    const doCliente = veiculos.filter((v) => Number(v.cliente_id) === cid);
    // Qual veículo deixar selecionado:
    //  - se veio um informado (edição), usa ele (comparando por número, para
    //    não falhar quando o id vem como texto);
    //  - se não veio (orçamento novo) e o cliente só tem um veículo, seleciona
    //    esse único, para os dados já virem preenchidos.
    let alvo = (selecionado !== undefined && selecionado !== null && selecionado !== "")
      ? Number(selecionado) : null;
    if (alvo === null && doCliente.length === 1) alvo = Number(doCliente[0].id);
    sel.innerHTML = `<option value="">— selecione —</option>` +
      doCliente.map((v) => `<option value="${v.id}" ${Number(v.id) === alvo ? "selected" : ""}>${[v.marca, v.modelo, v.placa].filter(Boolean).join(" ")}</option>`).join("");
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
    const dis = soLeitura ? "disabled" : "";

    const linhasItens = itens.map((it, i) => {
      const total = (it.quantidade * it.valor_unitario) - it.desconto;
      return `<tr>
        <td class="orc-item-num">${String(i + 1).padStart(3, "0")}</td>
        <td><input class="orc-cel orc-cel--cod" data-i="${i}" data-f="codigo" value="${esc(it.codigo)}" title="F2 para buscar" ${dis}></td>
        <td><input class="orc-cel orc-cel--desc" data-i="${i}" data-f="descricao" value="${esc(it.descricao)}" ${dis}></td>
        <td><input class="orc-cel orc-cel--num" data-i="${i}" data-f="quantidade" type="number" step="0.01" value="${it.quantidade}" ${dis}></td>
        <td><input class="orc-cel orc-cel--un" data-i="${i}" data-f="unidade" value="${esc(it.unidade)}" ${dis}></td>
        <td><input class="orc-cel orc-cel--num" data-i="${i}" data-f="valor_unitario" type="number" step="0.01" value="${it.valor_unitario}" ${dis}></td>
        <td><input class="orc-cel orc-cel--num" data-i="${i}" data-f="desconto" type="number" step="0.01" value="${it.desconto}" ${dis}></td>
        <td class="orc-item-total">${money(total)}</td>
        <td class="text-right">${soLeitura ? "" : `<button class="icon-btn btn--sm" title="Remover" onclick="window.__orc.remItem(${i})"><i class="fa-solid fa-trash"></i></button>`}</td>
      </tr>`;
    }).join("");

    // Linha em branco sempre presente (grade estilo PDV). Sem número na coluna
    // ID: ele só aparece quando a linha é preenchida (vira item).
    const linhaNova = soLeitura ? "" : `<tr class="orc-linha-nova">
      <td class="orc-item-num"></td>
      <td><input class="orc-cel orc-cel--cod orc-novo" data-f="codigo" value="" title="F2 para buscar produto"></td>
      <td><input class="orc-cel orc-cel--desc orc-novo" data-f="descricao" value=""></td>
      <td><input class="orc-cel orc-cel--num orc-novo" data-f="quantidade" type="number" step="0.01" value=""></td>
      <td><input class="orc-cel orc-cel--un orc-novo" data-f="unidade" value=""></td>
      <td><input class="orc-cel orc-cel--num orc-novo" data-f="valor_unitario" type="number" step="0.01" value=""></td>
      <td><input class="orc-cel orc-cel--num orc-novo" data-f="desconto" type="number" step="0.01" value=""></td>
      <td class="orc-item-total"></td>
      <td></td>
    </tr>`;

    // Linhas em branco extras (só visuais). Começa com no mínimo 3 linhas no
    // total (itens + a linha de digitação + visuais); ao preencher, sempre
    // sobra uma linha vazia, então a grade cresce de uma em uma.
    const MIN_LINHAS = 1;
    const vazias = Math.max(0, MIN_LINHAS - itens.length - 1);
    const linhaVaziaVisual = () => `<tr class="orc-linha-vazia">
      <td class="orc-item-num"></td>
      <td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>
    </tr>`;
    let visuais = "";
    for (let k = 0; k < vazias; k++) visuais += linhaVaziaVisual();

    tb.innerHTML = linhasItens + linhaNova + visuais;

    // Edição das linhas já existentes (atualiza itens[i] sem re-renderizar).
    tb.querySelectorAll(".orc-cel:not(.orc-novo)").forEach((inp) => {
      inp.addEventListener("input", () => {
        const i = +inp.dataset.i, f = inp.dataset.f;
        itens[i][f] = (inp.type === "number") ? (parseFloat(inp.value) || 0) : inp.value;
        const linha = inp.closest("tr");
        const it = itens[i];
        linha.querySelector(".orc-item-total").textContent = money((it.quantidade * it.valor_unitario) - it.desconto);
        recalc();
      });
    });

    // F2 nas células de código das linhas existentes: busca e substitui o produto.
    tb.querySelectorAll(".orc-cel--cod:not(.orc-novo)").forEach((inp) => {
      inp.addEventListener("keydown", (e) => {
        if (e.key === "F2") { e.preventDefault(); abrirBusca((l) => aplicarProdutoNaLinha(+inp.dataset.i, l), inp.value); }
      });
    });

    // Linha nova: F2 abre busca; Enter tenta casar código/código de barras exato.
    const novoCod = tb.querySelector(".orc-linha-nova .orc-cel--cod");
    if (novoCod) {
      novoCod.addEventListener("keydown", (e) => {
        if (e.key === "F2") {
          e.preventDefault();
          abrirBusca((l) => aplicarProdutoNaLinha(itens.length, l), novoCod.value);
        } else if (e.key === "Enter") {
          e.preventDefault();
          const l = acharPorCodigo(novoCod.value);
          if (l) aplicarProdutoNaLinha(itens.length, l);
          else materializarNovo(novoCod.closest("tr"));
        }
      });
    }
    // Ao sair da linha nova (clicar/tabular pra fora) com conteúdo, materializa.
    const trNova = tb.querySelector(".orc-linha-nova");
    if (trNova) {
      trNova.addEventListener("focusout", () => {
        setTimeout(() => {
          if (trNova.contains(document.activeElement)) return;   // ainda editando a linha
          if (document.getElementById("busca-q")) return;        // busca (F2) aberta
          materializarNovo(trNova);
        }, 0);
      });
    }
  }

  function focarNovoCodigo() {
    document.querySelector(".orc-linha-nova .orc-cel--cod")?.focus();
  }

  // Preenche uma linha (índice em itens; se >= tamanho, adiciona nova) a partir
  // de um resultado da busca, e deixa o cursor pronto na próxima linha em branco.
  function aplicarProdutoNaLinha(i, l) {
    const item = {
      tipo: l.tipo, referencia_id: l.id,
      codigo: l.codigo || l.barras || "", descricao: l.nome,
      unidade: l.un, quantidade: 1, valor_unitario: l.valor, desconto: 0,
    };
    if (i >= itens.length) itens.push(item);
    else itens[i] = { ...itens[i], ...item };
    renderItens(); recalc(); focarNovoCodigo();
  }

  // Transforma a linha em branco num item usando o que foi digitado à mão.
  function materializarNovo(tr) {
    if (!tr) return false;
    const get = (f) => tr.querySelector(`[data-f="${f}"]`)?.value ?? "";
    const codigo = get("codigo").trim();
    const descricao = get("descricao").trim();
    if (!codigo && !descricao) return false;   // nada digitado: ignora
    itens.push({
      tipo: "produto", referencia_id: null, codigo,
      descricao: descricao || codigo, unidade: get("unidade").trim() || "UN",
      quantidade: parseFloat(get("quantidade")) || 1,
      valor_unitario: parseFloat(get("valor_unitario")) || 0,
      desconto: parseFloat(get("desconto")) || 0,
    });
    renderItens(); recalc();
    return true;
  }

  // Casa um código digitado com o código OU código de barras de um produto.
  function acharPorCodigo(cod) {
    const c = (cod || "").trim().toLowerCase();
    if (!c) return null;
    const campos = (p) => [p.codigo, p.codigo_barras, p.ean, p.cod_barras, p.barcode, p.gtin];
    const p = produtos.find((p) => campos(p).some((x) => x && String(x).toLowerCase() === c));
    if (!p) return null;
    return {
      tipo: "produto", id: p.id, codigo: p.codigo || "",
      barras: p.codigo_barras || p.ean || p.cod_barras || p.barcode || p.gtin || "",
      nome: p.nome, valor: p.preco_venda || 0, un: "UN",
    };
  }

  function recalc() {
    const sub = itens.reduce((s, it) => s + ((it.quantidade * it.valor_unitario) - it.desconto), 0);
    const desc = parseFloat(document.getElementById("orc-desc")?.value) || 0;
    const ts = document.getElementById("t-sub"), tt = document.getElementById("t-total");
    if (ts) ts.textContent = money(sub);
    if (tt) tt.textContent = money(sub - desc);
  }

  /* ------------------------------------------------------- buscar produto */
  let buscaPick = null;   // callback ativo do resultado da busca (F2)

  function abrirBusca(onPick = null, queryInicial = "") {
    const linhas = [
      ...produtos.map((p) => ({
        tipo: "produto", id: p.id, codigo: p.codigo || "",
        barras: p.codigo_barras || p.ean || p.cod_barras || p.barcode || p.gtin || "",
        nome: p.nome, valor: p.preco_venda || 0, un: "UN",
      })),
      ...servicos.map((s) => ({ tipo: "servico", id: s.id, codigo: "", barras: "", nome: s.descricao, valor: s.valor || 0, un: "SV" })),
    ];
    window.__buscaLinhas = linhas;
    buscaPick = onPick;
    Modal.abrir("Buscar produto ou serviço", `
      <input id="busca-q" class="input" placeholder="Nome, código ou código de barras…" style="width:100%;margin-bottom:10px">
      <div class="table-wrap" style="max-height:50vh;overflow:auto"><table class="data"><tbody id="busca-lista">
        ${linhas.map((l, i) => linhaBusca(l, i)).join("")}
      </tbody></table></div>`,
      `<button class="btn btn--ghost" onclick="Modal.fechar()">Fechar</button>`);
    const q = document.getElementById("busca-q");
    const lista = document.getElementById("busca-lista");
    let sel = 0;
    const visiveis = () => [...lista.querySelectorAll("tr")].filter((tr) => tr.style.display !== "none");
    const marcar = () => {
      const vis = visiveis();
      lista.querySelectorAll("tr").forEach((tr) => tr.style.background = "");
      if (vis[sel]) { vis[sel].style.background = "rgba(13,148,136,.12)"; vis[sel].scrollIntoView({ block: "nearest" }); }
    };
    const filtrar = () => {
      const t = q.value.toLowerCase().trim();
      lista.querySelectorAll("tr").forEach((tr, i) => {
        const l = linhas[i];
        const alvo = `${l.nome} ${l.codigo} ${l.barras}`.toLowerCase();
        tr.style.display = alvo.includes(t) ? "" : "none";
      });
      sel = 0; marcar();
    };
    q.oninput = filtrar;
    q.onkeydown = (e) => {
      const vis = visiveis();
      if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, vis.length - 1); marcar(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); marcar(); }
      else if (e.key === "Enter") {
        e.preventDefault();
        if (vis[sel]) escolherBusca([...lista.querySelectorAll("tr")].indexOf(vis[sel]));
      } else if (e.key === "Escape") { Modal.fechar(); }
    };
    if (queryInicial) { q.value = queryInicial; filtrar(); }
    q.focus();
  }
  function linhaBusca(l, i) {
    const cod = l.codigo || l.barras || "";
    return `<tr style="cursor:pointer" onclick="window.__orc.pickBusca(${i})">
      <td><span class="pill ${l.tipo === "servico" ? "pill--accent" : ""}">${l.un}</span></td>
      <td>${cod ? "<b>" + cod + "</b> · " : ""}${l.nome}</td>
      <td class="text-right">${money(l.valor)}</td></tr>`;
  }
  // Resultado escolhido: usa o callback (F2 na linha) ou, sem callback, adiciona um item novo.
  function escolherBusca(i) {
    const l = window.__buscaLinhas?.[i];
    if (!l) return;
    Modal.fechar();
    if (buscaPick) { const cb = buscaPick; buscaPick = null; cb(l); }
    else {
      itens.push({ tipo: l.tipo, referencia_id: l.id, codigo: l.codigo || l.barras || "", descricao: l.nome, unidade: l.un, quantidade: 1, valor_unitario: l.valor, desconto: 0 });
      renderItens(); recalc(); focarNovoCodigo();
    }
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

  /* ------------------------------------------- FINALIZAR (baixa + caixa + A5) */
  async function finalizarOrcamento() {
    if (!editando) return;
    const d = coletar();
    if (!d.cliente_id) { toast("Selecione um cliente", "warning"); return; }
    if (!confirm("Finalizar o orçamento?\n\nIsso dá baixa no estoque dos produtos e gera a cobrança em aberto no caixa (o pagamento é acertado depois).")) return;
    try {
      await API.put(`/api/os/${editando.id}`, d);                              // salva edições
      await API.post(`/api/os/${editando.id}/finalizar`, { gerar_financeiro: true }); // baixa estoque + cobrança
      toast("Orçamento finalizado — estoque baixado e cobrança gerada");
      const o = await API.get(`/api/os/${editando.id}`);
      telaA5(o);                                                               // vai para a folha A5
    } catch (e) {
      if (e && /finalizado/i.test(e.message || "")) {                          // já finalizado: só mostra a folha
        try { telaA5(await API.get(`/api/os/${editando.id}`)); return; } catch (_) {}
      }
      toast(e.message || "Erro ao finalizar", "error");
    }
  }

  /* --------------------------------------------- TELA A5 (documento + canhoto) */
  function a5Conteudo(o, semCanhoto) {
    const cli = clientes.find((c) => c.id === o.cliente_id) || {};
    const vei = veiculos.find((v) => v.id === o.veiculo_id) || {};
    const its = o.itens || [];
    const sub = its.reduce((s, it) => s + (Number(it.subtotal) || 0), 0);
    const total = Number(o.total) || (sub - (Number(o.desconto) || 0));
    const dataStr = fmt.data(o.data || o.criado_em);
    const linhas = its.map((it, i) => `<tr>
      <td>${String(i + 1).padStart(2, "0")}</td>
      <td>${it.descricao || ""}</td>
      <td class="c">${it.quantidade}</td>
      <td class="r">${money(it.valor_unitario)}</td>
      <td class="r">${money(it.subtotal)}</td></tr>`).join("");

    // Na reimpressão (2ª via) o canhoto da oficina não é necessário.
    const canhoto = semCanhoto ? "" : `
      <!-- CANHOTO (fica na oficina) -->
      <div class="a5-canhoto">
        <div class="a5-canhoto__tit">CANHOTO — via da oficina</div>
        <div class="a5-canhoto__linhas">
          <span><b>Orçamento:</b> ${o.numero || "—"}</span>
          ${osRefs.length ? `<span><b>OS Ref.:</b> ${osRefs.map((r) => r.numero).join(", ")}</span>` : ""}
          <span><b>Data:</b> ${dataStr}</span>
          <span><b>Cliente:</b> ${cli.nome || "—"}</span>
          <span><b>Placa:</b> ${vei.placa || "—"}</span>
          <span><b>Total:</b> ${money(total)}</span>
          <span><b>Forma pagto:</b> _____________</span>
        </div>
        <div class="a5-assinaturas">
          <span>Recebido por: __________________</span>
          <span>Cliente: __________________</span>
        </div>
      </div>
      <div class="a5-corte"><span>✂</span></div>`;

    return `${canhoto}
      <div class="a5-doc">
        <div class="a5-topo">
          <div class="a5-emp">
            ${cfg.empresa_logo ? `<img src="${cfg.empresa_logo}">` : ""}
            <div>
              <div class="a5-emp__nome">${cfg.empresa_nome || ""}</div>
              <div class="a5-emp__l">${cfg.empresa_cnpj ? "CNPJ: " + cfg.empresa_cnpj : ""}</div>
              <div class="a5-emp__l">${cfg.empresa_telefone || ""}</div>
              ${Layout.enderecoLinhas().map((l) => `<div class="a5-emp__l">${l}</div>`).join("")}
            </div>
          </div>
          <div class="a5-meta">
            <div class="a5-meta__tit">ORÇAMENTO</div>
            <div class="a5-meta__num">Nº ${o.numero || "—"}</div>
            <div class="a5-emp__l">Data: ${dataStr}</div>
            <div class="a5-emp__l">Validade: ${o.validade || "—"}</div>
            ${osRefs.length ? `<div class="a5-emp__l">OS Ref.: ${osRefs.map((r) => r.numero).join(", ")}</div>` : ""}
          </div>
        </div>
        <div class="a5-cv">
          <span><b>Cliente:</b> ${cli.nome || "—"}</span>
          <span><b>Telefone:</b> ${cli.telefone || "—"}</span>
          <span><b>Veículo:</b> ${[vei.marca, vei.modelo, vei.ano].filter(Boolean).join(" ") || "—"}</span>
          <span><b>Placa:</b> ${vei.placa || "—"}</span>
        </div>
        <table class="a5-itens">
          <thead><tr><th>#</th><th>Descrição</th><th class="c">Qtd</th><th class="r">Valor</th><th class="r">Total</th></tr></thead>
          <tbody>${linhas}</tbody>
        </table>
        <div class="a5-totais">
          <div><span>Subtotal</span><b>${money(sub)}</b></div>
          <div><span>Desconto</span><b>${money(o.desconto)}</b></div>
          <div class="a5-totais__g"><span>TOTAL</span><b>${money(total)}</b></div>
        </div>
        ${o.obs_finais ? `<div class="a5-obs">${o.obs_finais}</div>` : ""}
        <div class="a5-rodape">Pagamento a acertar no caixa • Documento sem valor fiscal</div>
      </div>`;
  }

  function telaA5(o, semCanhoto) {
    const conteudo = a5Conteudo(o, semCanhoto);
    Layout.set(`
      <div class="a5-tela">
        <div class="a5-barra">
          <button class="btn btn--primary" id="a5-imprimir"><i class="fa-solid fa-print"></i> Imprimir A5</button>
          <button class="btn btn--ghost" id="a5-voltar"><i class="fa-solid fa-list"></i> Voltar aos orçamentos</button>
        </div>
        <div class="a5-folha">${conteudo}</div>
      </div>
    `);
    document.getElementById("a5-voltar").onclick = renderLista;
    document.getElementById("a5-imprimir").onclick = () => {
      const w = window.open("", "_blank");
      w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Orçamento ${o.numero || ""}</title>
        <style>
          @page { size: A5; margin: 8mm; }
          * { box-sizing: border-box; }
          body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; font-size: 10px; margin: 0; }
          .a5-canhoto { border: 1px solid #999; border-radius: 4px; padding: 6px 8px; }
          .a5-canhoto__tit { font-weight: bold; font-size: 9px; color: #0d9488; letter-spacing: .5px; margin-bottom: 4px; }
          .a5-canhoto__linhas { display: flex; flex-wrap: wrap; gap: 2px 14px; }
          .a5-canhoto__linhas span { font-size: 9px; }
          .a5-assinaturas { display: flex; justify-content: space-between; margin-top: 8px; font-size: 9px; color: #444; }
          .a5-corte { text-align: center; border-top: 1px dashed #999; margin: 6px 0; position: relative; height: 0; }
          .a5-corte span { position: relative; top: -8px; background: #fff; padding: 0 6px; color: #999; }
          .a5-topo { display: flex; justify-content: space-between; gap: 8px; border-bottom: 2px solid #0d9488; padding-bottom: 6px; margin-bottom: 6px; }
          .a5-emp { display: flex; gap: 8px; }
          .a5-emp img { max-height: 42px; max-width: 70px; object-fit: contain; }
          .a5-emp__nome { font-weight: bold; font-size: 13px; }
          .a5-emp__l { color: #555; font-size: 9px; }
          .a5-meta { text-align: right; }
          .a5-meta__tit { font-weight: bold; color: #0d9488; font-size: 14px; }
          .a5-meta__num { font-weight: bold; font-size: 11px; }
          .a5-cv { display: flex; flex-wrap: wrap; gap: 2px 14px; background: #f4f4f4; padding: 5px 7px; border-radius: 4px; margin-bottom: 6px; font-size: 9px; }
          .a5-itens { width: 100%; border-collapse: collapse; }
          .a5-itens th { background: #0d9488; color: #fff; font-size: 8px; padding: 3px 5px; text-align: left; }
          .a5-itens td { border-bottom: 1px solid #ddd; padding: 3px 5px; font-size: 9px; }
          .a5-itens .c { text-align: center; } .a5-itens .r { text-align: right; }
          .a5-totais { margin-top: 6px; margin-left: auto; width: 45%; }
          .a5-totais div { display: flex; justify-content: space-between; font-size: 10px; padding: 1px 0; }
          .a5-totais__g { border-top: 1px solid #999; margin-top: 3px; padding-top: 3px; font-weight: bold; color: #0d9488; font-size: 12px; }
          .a5-obs { margin-top: 8px; font-size: 9px; color: #444; }
          .a5-rodape { margin-top: 10px; text-align: center; font-size: 8px; color: #888; }
        </style></head><body>${conteudo}</body></html>`);
      w.document.close();
      setTimeout(() => { try { w.print(); } catch (_) {} }, 500);
    };
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
    if (osRefs.length) doc.text("OS Ref.: " + osRefs.map((r) => r.numero).join(", "), 210 - M, y + 27, { align: "right" });

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
    // Orçamento enviado ao cliente (para aprovar) não mostra forma/condições
    // de pagamento — isso é acertado depois, no pagamento.
    const blob = gerarPDFBlob({ ocultarPagamento: true });
    if (!blob) { toast("PDF ainda carregando, tente novamente em 1s.", "warning"); return; }
    baixarBlob(blob, nomePDF());
  }

  // Impressão simples (abre o PDF gerado para imprimir/salvar)
  function imprimir() {
    const blob = gerarPDFBlob({ ocultarPagamento: true });
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
    pickBusca: (i) => escolherBusca(i),
    pickOS: (i) => escolherOS(i),
    remOS: (i) => { osRefs.splice(i, 1); renderOSRefs(); },
  };
})();
