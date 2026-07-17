/* =======================================================================
   cobrancas.js — Gestão de cobranças (inadimplentes)
   Lista contas a receber atrasadas e oferece ações de contato (WhatsApp,
   e-mail). O envio automático (SMS/API) fica como estrutura preparada.
   ======================================================================= */
(async () => {
  await Layout.iniciar("cobrancas", "Cobranças");

  Layout.set(`
    <div class="page-head">
      <div><h1>Cobranças</h1><p>Clientes inadimplentes e histórico de contato</p></div>
    </div>
    <div class="stat-grid" id="cob-resumo"></div>
    <div class="card"><div class="card__body" id="cob-tabela">
      <div class="loading"><i class="fa-solid fa-spinner spin"></i></div>
    </div></div>
  `);

  function msgCobranca(nome, valor, venc) {
    return encodeURIComponent(
      `Olá ${nome || ""}, identificamos um débito em aberto de ${fmt.moeda(valor)} ` +
      `com vencimento em ${fmt.data(venc)}. Podemos combinar o pagamento? Obrigado! — Oficina ERP`);
  }

  try {
    const r = await API.get("/api/cobrancas");
    const lista = r.dados || [];
    document.getElementById("cob-resumo").innerHTML = `
      <div class="stat stat--danger"><div class="stat__icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <div class="stat__body"><div class="stat__value">${fmt.moeda(r.total)}</div><div class="stat__label">Total em atraso</div></div></div>
      <div class="stat stat--warning"><div class="stat__icon"><i class="fa-solid fa-users"></i></div>
        <div class="stat__body"><div class="stat__value">${lista.length}</div><div class="stat__label">Lançamentos atrasados</div></div></div>`;

    const alvo = document.getElementById("cob-tabela");
    if (!lista.length) { alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-champagne-glasses"></i>Nenhuma cobrança em atraso 🎉</div>`; return; }
    alvo.innerHTML = `<div class="table-wrap"><table class="data">
      <thead><tr><th>Cliente</th><th>Descrição</th><th>Vencimento</th><th>Valor</th><th>Contato</th></tr></thead>
      <tbody>${lista.map((f) => {
        const zap = f.whatsapp || f.telefone;
        const acoes = [];
        if (zap) acoes.push(`<a class="icon-btn btn--sm" title="WhatsApp" target="_blank"
          href="https://wa.me/55${String(zap).replace(/\D/g, "")}?text=${msgCobranca(f.cliente_nome, f.valor, f.vencimento)}"><i class="fa-brands fa-whatsapp"></i></a>`);
        if (f.email) acoes.push(`<a class="icon-btn btn--sm" title="E-mail"
          href="mailto:${f.email}?subject=Cobran%C3%A7a&body=${msgCobranca(f.cliente_nome, f.valor, f.vencimento)}"><i class="fa-solid fa-envelope"></i></a>`);
        return `<tr>
          <td>${f.cliente_nome || "-"}</td><td>${f.descricao || "-"}</td>
          <td>${fmt.data(f.vencimento)}</td><td>${fmt.moeda(f.valor)}</td>
          <td>${acoes.join(" ") || '<span class="text-muted">sem contato</span>'}</td></tr>`;
      }).join("")}
      </tbody></table></div>`;
  } catch (e) {
    document.getElementById("cob-tabela").innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
  }
})();
