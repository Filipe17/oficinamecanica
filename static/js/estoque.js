/* =======================================================================
   estoque.js — Controle de estoque
   Abas: Alertas | Movimentações | Curva ABC. Botão "Movimentar" abre modal
   de entrada/saída/ajuste que chama POST /api/estoque/movimentar.
   ======================================================================= */
(async () => {
  await Layout.iniciar("estoque", "Estoque");

  Layout.set(`
    <div class="page-head">
      <div><h1>Estoque</h1><p>Alertas, movimentações e curva ABC</p></div>
      <button class="btn btn--primary" id="btn-mov"><i class="fa-solid fa-right-left"></i> Movimentar</button>
    </div>
    <div class="tabs" id="tabs">
      <button class="tab active" data-aba="alertas">Alertas</button>
      <button class="tab" data-aba="mov">Movimentações</button>
      <button class="tab" data-aba="abc">Curva ABC</button>
    </div>
    <div class="card"><div class="card__body" id="aba-conteudo">
      <div class="loading"><i class="fa-solid fa-spinner spin"></i></div>
    </div></div>
  `);

  const alvo = document.getElementById("aba-conteudo");

  document.getElementById("tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tab");
    if (!b) return;
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    b.classList.add("active");
    render(b.dataset.aba);
  });

  document.getElementById("btn-mov").onclick = abrirMovimento;

  async function render(aba) {
    alvo.innerHTML = `<div class="loading"><i class="fa-solid fa-spinner spin"></i></div>`;
    try {
      if (aba === "alertas") return renderAlertas();
      if (aba === "mov") return renderMovimentacoes();
      if (aba === "abc") return renderAbc();
    } catch (e) {
      alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
    }
  }

  async function renderAlertas() {
    const r = await API.get("/api/estoque/alertas");
    const bloco = (titulo, lista, tom) => `
      <h3 class="estoque-h3">${titulo} <span class="badge badge--${tom}">${lista.length}</span></h3>
      ${lista.length ? `<div class="table-wrap"><table class="data">
        <thead><tr><th>Produto</th><th>Categoria</th><th>Atual</th><th>Mínimo</th></tr></thead>
        <tbody>${lista.map((p) => `<tr>
          <td>${p.nome}</td><td>${p.categoria || "-"}</td>
          <td>${p.estoque_atual ?? 0}</td><td>${p.estoque_minimo ?? 0}</td></tr>`).join("")}
        </tbody></table></div>`
        : `<div class="empty"><i class="fa-solid fa-check"></i>Nenhum item nesta condição</div>`}`;
    alvo.innerHTML = bloco("Sem estoque", r.sem_estoque || [], "danger")
                   + bloco("Estoque crítico", r.criticos || [], "warning");
  }

  async function renderMovimentacoes() {
    const r = await API.get("/api/estoque/movimentacoes");
    const lista = r.dados || [];
    if (!lista.length) { alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-inbox"></i>Sem movimentações</div>`; return; }
    const badge = { entrada: "success", saida: "danger", ajuste: "warning", transferencia: "info" };
    alvo.innerHTML = `<div class="table-wrap"><table class="data">
      <thead><tr><th>Data</th><th>Produto</th><th>Tipo</th><th>Qtd</th><th>Saldo</th><th>Origem</th></tr></thead>
      <tbody>${lista.map((m) => `<tr>
        <td>${fmt.dataHora(m.criado_em)}</td>
        <td>${m.produto_nome || "-"}</td>
        <td><span class="badge badge--${badge[m.tipo] || ""}">${m.tipo}</span></td>
        <td>${m.quantidade}</td><td>${m.saldo_apos ?? "-"}</td><td>${m.origem || "-"}</td></tr>`).join("")}
      </tbody></table></div>`;
  }

  async function renderAbc() {
    const r = await API.get("/api/estoque/curva-abc");
    const lista = r.dados || [];
    if (!lista.length) { alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-inbox"></i>Sem produtos</div>`; return; }
    const cor = { A: "success", B: "warning", C: "" };
    alvo.innerHTML = `<div class="table-wrap"><table class="data">
      <thead><tr><th>Produto</th><th>Estoque</th><th>Preço venda</th><th>Valor imobilizado</th><th>Classe</th></tr></thead>
      <tbody>${lista.map((p) => `<tr>
        <td>${p.nome}</td><td>${p.estoque_atual ?? 0}</td>
        <td>${fmt.moeda(p.preco_venda)}</td><td>${fmt.moeda(p.valor)}</td>
        <td><span class="badge badge--${cor[p.classe]}">${p.classe}</span></td></tr>`).join("")}
      </tbody></table></div>`;
  }

  async function abrirMovimento() {
    // Carrega produtos para o select
    let ops = [];
    try {
      const r = await API.get("/api/produtos?por_pagina=1000&ordem=nome");
      ops = (r.dados || []).map((p) => `<option value="${p.id}">${p.nome} (atual: ${p.estoque_atual ?? 0})</option>`).join("");
    } catch (_) {}
    Modal.abrir("Movimentar estoque", `
      <div class="form-grid" id="mov-form">
        <div class="field col-2"><label>Produto *</label><select name="produto_id"><option value="">— selecione —</option>${ops}</select></div>
        <div class="field"><label>Tipo *</label><select name="tipo">
          <option value="entrada">Entrada</option><option value="saida">Saída</option>
          <option value="ajuste">Ajuste</option><option value="transferencia">Transferência</option></select></div>
        <div class="field"><label>Quantidade *</label><input type="number" name="quantidade" step="0.01" min="0"></div>
        <div class="field col-2"><label>Documento / observação</label><input name="documento" placeholder="ex: NF 123, inventário…"></div>
      </div>`,
      `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
       <button class="btn btn--primary" id="mov-salvar"><i class="fa-solid fa-check"></i> Confirmar</button>`);
    document.getElementById("mov-salvar").onclick = async () => {
      const f = document.getElementById("mov-form");
      const dados = {
        produto_id: f.produto_id.value,
        tipo: f.tipo.value,
        quantidade: parseFloat(f.quantidade.value),
        documento: f.documento.value,
        origem: "manual",
      };
      if (!dados.produto_id || !dados.quantidade) { toast("Selecione produto e quantidade", "warning"); return; }
      try {
        await API.post("/api/estoque/movimentar", dados);
        toast("Movimentação registrada");
        Modal.fechar();
        document.querySelector(".tab.active")?.click();
      } catch (e) { toast(e.message, "error"); }
    };
  }

  render("alertas");
})();
