/* =======================================================================
   notas_fiscais.js — Emissão de NF-e (peças) e NFS-e (serviços) por OS.
   A nota nasce da OS finalizada. Cada OS pode ter uma NF-e e/ou uma NFS-e.
   ======================================================================= */
(async () => {
  await Layout.iniciar("notas_fiscais", "Notas Fiscais");

  const soLeitura = (Layout.permissoes?.notas_fiscais || 0) < 2
    && Layout.usuario?.perfil !== "administrador";

  const STATUS = {
    autorizada: { tom: "success", txt: "Autorizada" },
    processando: { tom: "info", txt: "Processando" },
    pendente: { tom: "warning", txt: "Pendente" },
    rejeitada: { tom: "danger", txt: "Rejeitada" },
    cancelada: { tom: "muted", txt: "Cancelada" },
    erro: { tom: "danger", txt: "Erro" },
  };

  const hojeISO = () => new Date().toISOString().slice(0, 10);
  const primeiroDiaMes = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; };

  Layout.set(`
    <div class="page-head">
      <div><h1>Notas Fiscais</h1><p>Emita NF-e (peças) e NFS-e (serviços) a partir das OS finalizadas</p></div>
    </div>

    <div class="card" style="margin-bottom:16px"><div class="card__body">
      <div class="toolbar" style="gap:8px;flex-wrap:wrap;align-items:flex-end">
        <div><label style="display:block;font-size:12px;color:var(--muted)">Exportar XMLs — De</label>
          <input type="date" id="nf-exp-inicio" value="${primeiroDiaMes()}"></div>
        <div><label style="display:block;font-size:12px;color:var(--muted)">Até</label>
          <input type="date" id="nf-exp-fim" value="${hojeISO()}"></div>
        <div><label style="display:block;font-size:12px;color:var(--muted)">Tipo</label>
          <select id="nf-exp-tipo"><option value="">Todas</option><option value="nfe">NF-e</option><option value="nfse">NFS-e</option></select></div>
        <button class="btn btn--ghost btn--sm" id="nf-exp-baixar"><i class="fa-solid fa-file-zipper"></i> Baixar XMLs (zip)</button>
        <span id="nf-exp-info" class="text-muted" style="font-size:12px"></span>
      </div>
      <p class="text-muted" style="margin:8px 0 0;font-size:12px">Baixa os XMLs das notas autorizadas do período, para enviar ao contador (SPED).</p>
    </div></div>

    <div class="card"><div class="card__body" id="nf-tabela">
      <div class="loading"><i class="fa-solid fa-spinner spin"></i></div>
    </div></div>
  `);

  // Exportação de XMLs
  async function atualizarInfoExport() {
    try {
      const ini = document.getElementById("nf-exp-inicio").value;
      const fim = document.getElementById("nf-exp-fim").value;
      const tipo = document.getElementById("nf-exp-tipo").value;
      const r = await API.get(`/api/notas/exportar?inicio=${ini}&fim=${fim}&tipo=${tipo}`);
      const info = document.getElementById("nf-exp-info");
      info.textContent = r.total
        ? `${r.com_xml} de ${r.total} nota(s) com XML — total ${fmt.moeda(r.valor_total)}`
        : "Nenhuma nota autorizada no período";
    } catch (_) {}
  }
  ["nf-exp-inicio", "nf-exp-fim", "nf-exp-tipo"].forEach((id) =>
    document.getElementById(id).addEventListener("change", atualizarInfoExport));
  document.getElementById("nf-exp-baixar").onclick = () => {
    const ini = document.getElementById("nf-exp-inicio").value;
    const fim = document.getElementById("nf-exp-fim").value;
    const tipo = document.getElementById("nf-exp-tipo").value;
    window.location.href = `/api/notas/exportar/zip?inicio=${ini}&fim=${fim}&tipo=${tipo}`;
  };
  atualizarInfoExport();

  function badge(nota) {
    const s = STATUS[nota.status] || { tom: "muted", txt: nota.status };
    const label = (nota.tipo === "nfe" ? "NF-e" : "NFS-e");
    const pdf = nota.pdf_url ? ` <a href="${nota.pdf_url}" target="_blank" title="Abrir PDF"><i class="fa-solid fa-file-pdf"></i></a>` : "";
    return `<span class="badge badge--${s.tom}" title="${nota.mensagem || ""}">${label}: ${s.txt}${nota.numero ? " nº " + nota.numero : ""}</span>${pdf}`;
  }

  async function carregar() {
    const alvo = document.getElementById("nf-tabela");
    alvo.innerHTML = `<div class="loading"><i class="fa-solid fa-spinner spin"></i></div>`;
    try {
      const r = await API.get("/api/notas");
      const lista = r.dados || [];
      if (!lista.length) {
        alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-inbox"></i>Nenhuma OS finalizada para emitir nota</div>`;
        return;
      }
      alvo.innerHTML = `<div class="table-wrap"><table class="data">
        <thead><tr><th>OS</th><th>Cliente</th><th>Data</th><th>Total</th><th>Notas</th><th></th></tr></thead>
        <tbody>${lista.map((o) => {
          const notas = o.notas || [];
          const temNfe = notas.some((n) => n.tipo === "nfe" && n.status === "autorizada");
          const temNfse = notas.some((n) => n.tipo === "nfse" && n.status === "autorizada");
          const notasHtml = notas.length ? notas.map(badge).join(" ") : `<small class="text-muted">—</small>`;
          const acoes = soLeitura ? "" : `
            <button class="btn btn--ghost btn--sm" onclick="window.__nf.emitir(${o.id}, 'nfe')" ${temNfe ? "disabled" : ""}>
              <i class="fa-solid fa-box"></i> NF-e</button>
            <button class="btn btn--ghost btn--sm" onclick="window.__nf.emitir(${o.id}, 'nfse')" ${temNfse ? "disabled" : ""}>
              <i class="fa-solid fa-screwdriver-wrench"></i> NFS-e</button>`;
          return `<tr>
            <td><b>${o.numero || o.id}</b></td>
            <td>${o.cliente_nome || "—"}</td>
            <td>${fmt.data(o.data)}</td>
            <td>${fmt.moeda(o.total)}</td>
            <td>${notasHtml}</td>
            <td class="text-right">${acoes}</td>
          </tr>`;
        }).join("")}</tbody></table></div>`;
    } catch (e) {
      alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
    }
  }

  window.__nf = {
    async emitir(oid, tipo) {
      const nome = tipo === "nfe" ? "NF-e (peças)" : "NFS-e (serviços)";
      if (!confirm(`Emitir ${nome} da OS?`)) return;
      try {
        const r = await API.post("/api/notas/emitir", { os_id: oid, tipo });
        if (r.status === "autorizada") toast(`${nome} autorizada`);
        else if (r.status === "nao_configurado") toast(r.mensagem || "Configure o gateway em Configurações", "warning");
        else if (r.status === "pendente") toast(r.mensagem || "Emissão pendente (gateway não configurado)", "warning");
        else toast(r.mensagem || `Status: ${r.status}`, r.ok ? "success" : "error");
        carregar();
      } catch (e) { toast(e.message, "error"); }
    },
  };

  carregar();
})();
