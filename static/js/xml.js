/* =======================================================================
   xml.js — Importação de NF-e (XML)
   Envia o arquivo para /api/xml/importar (multipart) e mostra o resultado.
   Lista o histórico de importações.
   ======================================================================= */
(async () => {
  await Layout.iniciar("xml", "Importação XML");

  Layout.set(`
    <div class="page-head">
      <div><h1>Importação XML</h1><p>Importe a NF-e de compra e atualize o estoque automaticamente</p></div>
    </div>
    <div class="card"><div class="card__body">
      <label class="xml-drop" id="xml-drop">
        <input type="file" id="xml-file" accept=".xml" hidden>
        <i class="fa-solid fa-file-code"></i>
        <b>Clique para selecionar</b> ou arraste o arquivo XML aqui
        <small>Fornecedor, produtos, NCM, CFOP, EAN e quantidades são lidos automaticamente</small>
      </label>
      <div id="xml-resultado"></div>
    </div></div>
    <div class="card"><div class="card__body">
      <h3>Histórico de importações</h3>
      <div id="xml-historico"><div class="loading"><i class="fa-solid fa-spinner spin"></i></div></div>
    </div></div>
  `);

  const drop = document.getElementById("xml-drop");
  const input = document.getElementById("xml-file");
  input.onchange = () => { if (input.files[0]) enviar(input.files[0]); };
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("drag"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault(); drop.classList.remove("drag");
    if (e.dataTransfer.files[0]) enviar(e.dataTransfer.files[0]);
  });

  async function enviar(arquivo) {
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

  async function carregarHistorico() {
    const alvo = document.getElementById("xml-historico");
    try {
      const r = await API.get("/api/xml/historico");
      const lista = r.dados || [];
      if (!lista.length) { alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-inbox"></i>Nenhuma importação ainda</div>`; return; }
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
