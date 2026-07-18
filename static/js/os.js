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

  const STATUS = ["aberta", "em_analise", "aguardando_aprovacao", "aguardando_pecas", "em_execucao", "finalizada", "cancelada"];
  const STATUS_LABEL = {
    aberta: "Aberta", em_analise: "Em análise", aguardando_aprovacao: "Aguard. aprovação",
    aguardando_pecas: "Aguard. peças", em_execucao: "Em execução", finalizada: "Finalizada", cancelada: "Cancelada",
  };
  const STATUS_TOM = {
    aberta: "info", em_analise: "", aguardando_aprovacao: "warning", aguardando_pecas: "warning",
    em_execucao: "info", finalizada: "success", cancelada: "danger",
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

  Layout.set(`
    <div class="page-head">
      <div><h1>${TITULO}</h1><p>${EH_ORC ? "Propostas para aprovação do cliente" : "Ordens de serviço e acompanhamento"}</p></div>
      <div class="page-head__acoes">
        <button class="btn btn--ghost" id="os-config" title="Dados que aparecem no recibo impresso">
          <i class="fa-solid fa-gear"></i> Dados da oficina</button>
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
      </div>
      <div id="os-tabela"><div class="loading"><i class="fa-solid fa-spinner spin"></i></div></div>
    </div></div>
  `);

  const btnNovoOS = document.getElementById("os-novo");
  if (btnNovoOS) btnNovoOS.onclick = () => abrirEditor();
  document.getElementById("os-config").onclick = () => editarDadosOficina();
  document.getElementById("os-busca").oninput = debounce((e) => { busca = e.target.value.trim(); carregar(); });
  document.getElementById("os-status").onchange = (e) => { filtroStatus = e.target.value; carregar(); };

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
      alvo.innerHTML = `<div class="table-wrap"><table class="data">
        <thead><tr><th>Número</th><th>Cliente</th><th>Veículo</th><th>Status</th><th>Mecânico</th><th></th></tr></thead>
        <tbody>${lista.map((o) => `<tr>
          <td><b>${o.numero || "-"}</b></td>
          <td>${o.cliente_nome || "-"}</td>
          <td>${o.veiculo_placa || o.veiculo_modelo || "-"}</td>
          <td><span class="badge badge--${STATUS_TOM[o.status] || ""}">${STATUS_LABEL[o.status] || o.status}</span></td>
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

  async function abrirEditor(registro = null) {
    itensAtuais = [];
    let o = registro;
    if (registro && registro.id) {
      try { o = await API.get(`/api/os/${registro.id}`); } catch (_) {}
    }
    const ed = o && o.id;
    const itensHtml = (ed && o.itens || []).map(linhaItemHtml).join("");

    Modal.abrir(`${ed ? (o.numero || "OS") : (EH_ORC ? "Novo orçamento" : "Nova OS")}`, `
      <div class="form-grid" id="os-form">
        <div class="field col-2"><label>Cliente *</label>${selectHtml("cliente_id", clientes, (c) => c.nome, ed ? o.cliente_id : "")}</div>
        <div class="field"><label>Veículo</label>${selectHtml("veiculo_id", veiculos, (v) => `${v.placa || ""} ${v.modelo || ""}`.trim(), ed ? o.veiculo_id : "")}</div>
        <div class="field"><label>Mecânico</label>${selectHtml("mecanico_id", mecanicos, (m) => m.nome, ed ? o.mecanico_id : "")}</div>
        <div class="field"><label>Status</label><select name="status">
          ${STATUS.map((s) => `<option value="${s}" ${ed && o.status === s ? "selected" : ""}>${STATUS_LABEL[s]}</option>`).join("")}</select></div>
        <div class="field"><label>Previsão</label><input type="date" name="previsao" value="${ed && o.previsao ? String(o.previsao).slice(0,10) : ""}"></div>
        <div class="field col-2"><label>Problema relatado</label><textarea name="problema">${ed ? (o.problema || "") : ""}</textarea></div>
        <div class="field col-2"><label>Diagnóstico</label><textarea name="diagnostico">${ed ? (o.diagnostico || "") : ""}</textarea></div>
        <div class="field"><label>Horas trabalhadas</label><input type="number" step="0.5" name="horas_trabalhadas" value="${ed ? (o.horas_trabalhadas || 0) : 0}"></div>
        ${EH_ORC ? `<div class="field"><label>Garantia</label><input name="garantia" value="${ed ? (o.garantia || "") : ""}"></div>` : ""}
      </div>

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
      ${!soLeitura && ed && EH_ORC ? `<button class="btn btn--accent" onclick="window.__os.converter(${o.id})"><i class="fa-solid fa-right-to-bracket"></i> Converter em OS</button>` : ""}
      ${!soLeitura && ed && !EH_ORC && o.status !== "finalizada" ? `<button class="btn btn--success" onclick="window.__os.finalizar(${o.id})"><i class="fa-solid fa-flag-checkered"></i> Finalizar</button>` : ""}
      ${soLeitura ? "" : `<button class="btn btn--primary" id="os-salvar"><i class="fa-solid fa-check"></i> Salvar</button>`}
    `, true);

    window.__os = api;
    if (soLeitura) {
      // Visualização: desabilita todos os campos, sem salvar.
      document.querySelectorAll("#os-form input, #os-form select, #os-form textarea")
        .forEach((el) => { el.disabled = true; });
      return;
    }
    document.getElementById("os-salvar").onclick = () => salvar(ed ? o.id : null, ed ? o : null);
    api.calc();
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
      if (!confirm("Excluir este registro?")) return;
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
    } else if (original) {
      // Modo OS: mantém o desconto atual e NÃO envia "itens" (backend preserva).
      dados.desconto = original.desconto || 0;
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
  function _dadosOficina() {
    try { return JSON.parse(localStorage.getItem("oficina_dados") || "{}"); }
    catch (_) { return {}; }
  }

  function editarDadosOficina(aoSalvar) {
    const d = _dadosOficina();
    Modal.abrir("Dados da oficina (recibo)", `
      <p class="text-muted" style="margin-bottom:12px">Estas informações aparecem no topo do recibo impresso.</p>
      <div class="form-grid" id="ofc-form">
        <div class="field col-2"><label>Nome da oficina</label><input name="nome" value="${d.nome || ""}"></div>
        <div class="field col-2"><label>Endereço</label><input name="endereco" value="${d.endereco || ""}"></div>
        <div class="field"><label>Telefone</label><input name="telefone" value="${d.telefone || ""}"></div>
        <div class="field"><label>CNPJ</label><input name="cnpj" value="${d.cnpj || ""}"></div>
      </div>`,
      `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
       <button class="btn btn--primary" id="ofc-salvar"><i class="fa-solid fa-check"></i> Salvar</button>`);
    document.getElementById("ofc-salvar").onclick = () => {
      const f = document.getElementById("ofc-form");
      const novo = { nome: f.nome.value.trim(), endereco: f.endereco.value.trim(),
                     telefone: f.telefone.value.trim(), cnpj: f.cnpj.value.trim() };
      localStorage.setItem("oficina_dados", JSON.stringify(novo));
      toast("Dados da oficina salvos");
      Modal.fechar();
      if (typeof aoSalvar === "function") aoSalvar();
    };
  }

  // Gera o recibo em A4 numa nova janela e chama a impressão do navegador
  // (o próprio "Imprimir" permite salvar em PDF).
  function imprimirRecibo(o) {
    const ofc = _dadosOficina();
    if (!ofc.nome) {
      // Primeira vez: pede os dados da oficina e, ao salvar, imprime.
      toast("Preencha os dados da oficina para o recibo", "warning");
      editarDadosOficina(() => imprimirRecibo(o));
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
        <div>
          <div class="of-nome">${ofc.nome}</div>
          <div class="of-dados">
            ${ofc.endereco ? ofc.endereco + "<br>" : ""}
            ${ofc.telefone ? "Tel: " + ofc.telefone + " &nbsp; " : ""}
            ${ofc.cnpj ? "CNPJ: " + ofc.cnpj : ""}
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

  window.__os = api;
  carregar();
})();
