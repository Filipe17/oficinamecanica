/* =======================================================================
   logs.js — Registro de operações importantes do sistema
   ======================================================================= */
(async () => {
  await Layout.iniciar("logs", "Logs");

  Layout.set(`
    <div class="page-head">
      <div><h1>Logs</h1><p>Auditoria das operações realizadas no sistema</p></div>
      <button class="btn btn--ghost" onclick="location.reload()"><i class="fa-solid fa-rotate"></i> Atualizar</button>
    </div>
    <div class="card"><div class="card__body" id="logs-tabela">
      <div class="loading"><i class="fa-solid fa-spinner spin"></i></div>
    </div></div>
  `);

  try {
    const r = await API.get("/api/logs");
    const lista = r.dados || [];
    const alvo = document.getElementById("logs-tabela");
    if (!lista.length) { alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-inbox"></i>Nenhum log registrado</div>`; return; }
    alvo.innerHTML = `<div class="table-wrap"><table class="data">
      <thead><tr><th>Data</th><th>Usuário</th><th>Ação</th><th>Detalhe</th></tr></thead>
      <tbody>${lista.map((l) => `<tr>
        <td>${fmt.dataHora(l.criado_em)}</td>
        <td>${l.usuario_nome || "-"}</td>
        <td><span class="badge">${l.acao || "-"}</span></td>
        <td>${l.detalhe || "-"}</td></tr>`).join("")}
      </tbody></table></div>`;
  } catch (e) {
    document.getElementById("logs-tabela").innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
  }
})();
