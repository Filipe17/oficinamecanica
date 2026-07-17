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
    const [rc, rv, ru, rp, rs] = await Promise.all([
      API.get("/api/clientes?por_pagina=1000&ordem=nome"),
      API.get("/api/veiculos?por_pagina=1000"),
      API.get("/api/usuarios"),
      API.get("/api/produtos?por_pagina=1000&ordem=nome"),
      API.get("/api/servicos"),
    ]);
    clientes = rc.dados || [];
    veiculos = rv.dados || [];
    mecanicos = (ru.dados || ru || []).filter((u) => ["mecanico", "gerente", "administrador"].includes(u.perfil));
    produtos = rp.dados || [];
    servicos = rs.dados || rs || [];
  } catch (_) {}

  let filtroStatus = "", busca = "";
  let itensAtuais = [];   // itens do editor aberto

  Layout.set(`
    <div class="page-head">
      <div><h1>${TITULO}</h1><p>${EH_ORC ? "Propostas para aprovação do cliente" : "Ordens de serviço e acompanhamento"}</p></div>
      <button class="btn btn--primary" id="os-novo"><i class="fa-solid fa-plus"></i> ${EH_ORC ? "Novo orçamento" : "Nova OS"}</button>
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

  document.getElementById("os-novo").onclick = () => abrirEditor();
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
        <thead><tr><th>Número</th><th>Cliente</th><th>Veículo</th><th>Status</th><th>Total</th><th></th></tr></thead>
        <tbody>${lista.map((o) => `<tr>
          <td><b>${o.numero || "-"}</b></td>
          <td>${o.cliente_nome || "-"}</td>
          <td>${o.veiculo_placa || o.veiculo_modelo || "-"}</td>
          <td><span class="badge badge--${STATUS_TOM[o.status] || ""}">${STATUS_LABEL[o.status] || o.status}</span></td>
          <td>${fmt.moeda(o.total)}</td>
          <td class="text-right">
            <button class="icon-btn btn--sm" title="Abrir" onclick="window.__os.abrir(${o.id})"><i class="fa-solid fa-eye"></i></button>
            <button class="icon-btn btn--sm" title="Excluir" onclick="window.__os.excluir(${o.id})"><i class="fa-solid fa-trash"></i></button>
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
        <div class="field"><label>Garantia</label><input name="garantia" value="${ed ? (o.garantia || "") : ""}"></div>
      </div>

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
      </div>
    `, `
      <button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
      ${ed && EH_ORC ? `<button class="btn btn--accent" onclick="window.__os.converter(${o.id})"><i class="fa-solid fa-right-to-bracket"></i> Converter em OS</button>` : ""}
      ${ed && !EH_ORC && o.status !== "finalizada" ? `<button class="btn btn--success" onclick="window.__os.finalizar(${o.id})"><i class="fa-solid fa-flag-checkered"></i> Finalizar</button>` : ""}
      <button class="btn btn--primary" id="os-salvar"><i class="fa-solid fa-check"></i> Salvar</button>
    `, true);

    document.getElementById("os-salvar").onclick = () => salvar(ed ? o.id : null);
    window.__os = api;
    api.calc();
  }

  const api = {
    abrir: (id) => abrirEditor({ id }),
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
      let total = 0;
      document.querySelectorAll("#os-itens-body tr").forEach((tr) => {
        const q = parseFloat(tr.querySelector(".it-qtd").value) || 0;
        const v = parseFloat(tr.querySelector(".it-val").value) || 0;
        tr.querySelector(".it-sub").textContent = fmt.moeda(q * v);
        total += q * v;
      });
      const desc = parseFloat(document.querySelector('[name="desconto"]').value) || 0;
      document.getElementById("os-total-val").textContent = fmt.moeda(Math.max(0, total - desc));
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

  async function salvar(id) {
    const f = document.getElementById("os-form");
    if (!f.cliente_id.value) { toast("Selecione o cliente", "warning"); return; }
    const dados = {
      cliente_id: f.cliente_id.value,
      veiculo_id: f.veiculo_id.value || null,
      mecanico_id: f.mecanico_id.value || null,
      status: f.status.value,
      previsao: f.previsao.value || null,
      problema: f.problema.value,
      diagnostico: f.diagnostico.value,
      horas_trabalhadas: parseFloat(f.horas_trabalhadas.value) || 0,
      garantia: f.garantia.value,
      desconto: parseFloat(f.desconto.value) || 0,
      eh_orcamento: EH_ORC,
      itens: api._coletarItens(),
    };
    try {
      if (id) await API.put(`/api/os/${id}`, dados);
      else await API.post("/api/os", dados);
      toast("Registro salvo");
      Modal.fechar();
      carregar();
    } catch (e) { toast(e.message, "error"); }
  }

  window.__os = api;
  carregar();
})();
