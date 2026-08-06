/* =======================================================================
   xml.js — Importação de NF-e (XML) + Importação de Produtos em Lote
   ======================================================================= */
(async () => {
  await Layout.iniciar("xml", "Importação XML");

  Layout.set(`
    <div class="page-head">
      <div><h1>Importação XML</h1><p>Importe NF-e de compra ou cadastre produtos em lote via XML</p></div>
    </div>

    <!-- NF-e -->
    <div class="card"><div class="card__body">
      <h3 style="margin-bottom:.75rem"><i class="fa-solid fa-file-invoice" style="color:var(--primary)"></i> Importar NF-e de Compra</h3>
      <p style="color:var(--text-muted);font-size:.85rem;margin-bottom:1rem">
        Atualiza estoque e preço de compra automaticamente a partir da nota fiscal eletrônica.
      </p>
      <label class="xml-drop" id="xml-drop">
        <input type="file" id="xml-file" accept=".xml" hidden>
        <i class="fa-solid fa-file-code"></i>
        <b>Clique para selecionar</b> ou arraste o arquivo XML aqui
        <small>Fornecedor, produtos, NCM, CFOP, EAN e quantidades são lidos automaticamente</small>
      </label>
      <div id="xml-resultado"></div>
    </div></div>

    <!-- Produtos em lote -->
    <div class="card"><div class="card__body">
      <h3 style="margin-bottom:.75rem"><i class="fa-solid fa-boxes-stacked" style="color:var(--primary)"></i> Importar Produtos em Lote</h3>
      <p style="color:var(--text-muted);font-size:.85rem;margin-bottom:1rem">
        Cadastre ou atualize múltiplos produtos de uma vez usando o XML próprio do DevSystem PRIME.<br>
        Suporta produtos simples e produtos com grade (variações por embalagem, medida, tamanho etc).
      </p>
      <div style="display:flex;gap:.75rem;align-items:center;flex-wrap:wrap;margin-bottom:1rem">
        <label class="xml-drop" id="prod-drop" style="flex:1;min-width:260px;padding:1.2rem 1.5rem">
          <input type="file" id="prod-file" accept=".xml" hidden>
          <i class="fa-solid fa-layer-group"></i>
          <b>Clique para selecionar</b> ou arraste o XML de produtos
          <small>Produtos novos são criados; existentes (mesmo código/EAN) são atualizados</small>
        </label>
        <a href="/static/modelos/produtos_importacao.xml" download
           style="white-space:nowrap"
           class="btn btn--ghost btn--sm">
          <i class="fa-solid fa-download"></i> Baixar modelo XML
        </a>
      </div>
      <div id="prod-resultado"></div>
    </div></div>

    <!-- Histórico NF-e -->
    <div class="card"><div class="card__body">
      <h3>Histórico de importações NF-e</h3>
      <div id="xml-historico"><div class="loading"><i class="fa-solid fa-spinner spin"></i></div></div>
    </div></div>
  `);

  // --- NF-e ---
  const drop = document.getElementById("xml-drop");
  const input = document.getElementById("xml-file");
  input.onchange = () => { if (input.files[0]) enviarNfe(input.files[0]); };
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("drag"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault(); drop.classList.remove("drag");
    if (e.dataTransfer.files[0]) enviarNfe(e.dataTransfer.files[0]);
  });

  async function enviarNfe(arquivo) {
    const box = document.getElementById("xml-resultado");
    box.innerHTML = `<div class="loading"><i class="fa-solid fa-spinner spin"></i> Processando ${arquivo.name}…</div>`;
    const fd = new FormData();
    fd.append("arquivo", arquivo);
    try {
      const r = await API.upload("/api/xml/importar", fd);
      box.innerHTML = `
        <div class="xml-ok">
          <i class="fa-solid fa-circle-check"></i>
          <div>
            <b>Importado com sucesso!</b>
            <div>Fornecedor: ${r.fornecedor || "-"}</div>
            <div>${r.total_itens} itens — ${r.produtos_novos} novos, ${r.produtos_atualizados} atualizados</div>
          </div>
        </div>`;
      toast("XML importado");
      carregarHistorico();
    } catch (e) {
      box.innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
      toast(e.message, "error");
    }
  }

  // --- Produtos em lote ---
  const prodDrop = document.getElementById("prod-drop");
  const prodInput = document.getElementById("prod-file");
  prodInput.onchange = () => { if (prodInput.files[0]) enviarProdutos(prodInput.files[0]); };
  prodDrop.addEventListener("dragover", (e) => { e.preventDefault(); prodDrop.classList.add("drag"); });
  prodDrop.addEventListener("dragleave", () => prodDrop.classList.remove("drag"));
  prodDrop.addEventListener("drop", (e) => {
    e.preventDefault(); prodDrop.classList.remove("drag");
    if (e.dataTransfer.files[0]) enviarProdutos(e.dataTransfer.files[0]);
  });

  async function enviarProdutos(arquivo) {
    const box = document.getElementById("prod-resultado");
    box.innerHTML = `<div class="loading"><i class="fa-solid fa-spinner spin"></i> Processando ${arquivo.name}…</div>`;
    const fd = new FormData();
    fd.append("arquivo", arquivo);
    try {
      const r = await API.upload("/api/xml/importar-produtos", fd);
      box.innerHTML = `
        <div class="xml-ok">
          <i class="fa-solid fa-circle-check"></i>
          <div>
            <b>Produtos importados com sucesso!</b>
            <div>${r.total_produtos} produto(s) processado(s) —
              ${r.produtos_novos} novo(s), ${r.produtos_atualizados} atualizado(s)</div>
            ${r.variacoes_criadas ? `<div>${r.variacoes_criadas} variação(ões) de grade criada(s)</div>` : ""}
          </div>
        </div>`;
      toast("Produtos importados");
    } catch (e) {
      box.innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
      toast(e.message, "error");
    }
  }

  // --- Histórico NF-e ---
  async function carregarHistorico() {
    const alvo = document.getElementById("xml-historico");
    try {
      const r = await API.get("/api/xml/historico");
      const lista = r.dados || [];
      if (!lista.length) {
        alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-inbox"></i>Nenhuma importação ainda</div>`;
        return;
      }
      alvo.innerHTML = `<div class="table-wrap"><table class="data">
        <thead><tr><th>Data</th><th>Fornecedor</th><th>Itens</th><th>Valor</th><th>Chave</th></tr></thead>
        <tbody>${lista.map((x) => `<tr>
          <td>${fmt.dataHora(x.criado_em)}</td><td>${x.fornecedor || "-"}</td>
          <td>${x.qtd_produtos ?? "-"}</td><td>${fmt.moeda(x.valor_total)}</td>
          <td><small>${(x.chave || "").slice(0, 20)}…</small></td></tr>`).join("")}
        </tbody></table></div>`;
    } catch (e) {
      alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
    }
  }

  carregarHistorico();
})();
