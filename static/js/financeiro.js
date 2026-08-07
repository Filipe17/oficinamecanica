/* =======================================================================
   financeiro.js — Contas a receber / a pagar + fluxo de caixa
   Baixa parcial + juros/multa + edição de lançamento.
   ======================================================================= */
(async () => {
  await Layout.iniciar("financeiro", "Financeiro");

  const FORMAS = ["pix", "cartao", "dinheiro", "boleto", "cheque", "carne"];

  // Categorias para a DRE. As de "pagar" separam custo x despesa operacional;
  // as de "receber" são simples. O usuário pode deixar em "— sem categoria —".
  const CATEGORIAS = {
    pagar: [
      "Custo - Peças/Mercadorias", "Custo - Serviços de terceiros",
      "Despesa - Aluguel", "Despesa - Pessoal/Salários", "Despesa - Água/Luz/Telefone",
      "Despesa - Impostos/Taxas", "Despesa - Manutenção", "Despesa - Marketing",
      "Despesa - Financeira (juros/tarifas)", "Despesa - Outras",
    ],
    receber: [
      "Receita - Serviços", "Receita - Peças/Mercadorias", "Receita - Outras",
    ],
  };
  let tipo = "receber";
  let clientes = [], fornecedores = [];
  try {
    const [rc, rf] = await Promise.all([
      API.get("/api/clientes?por_pagina=1000&ordem=nome"),
      API.get("/api/fornecedores"),
    ]);
    clientes = rc.dados || [];
    fornecedores = rf.dados || rf || [];
  } catch (_) {}

  // Guarda os lançamentos carregados para o form de baixa/edição consultar.
  let cache = [];

  const num = (v) => (parseFloat(v) || 0);
  const totalDevido = (f) => num(f.valor) + num(f.juros) + num(f.multa);
  const restante = (f) => Math.max(totalDevido(f) - num(f.valor_pago), 0);

  Layout.set(`
    <div class="page-head">
      <div><h1>Financeiro</h1><p>Contas a receber, a pagar e fluxo de caixa</p></div>
      <button class="btn btn--primary" id="fin-novo"><i class="fa-solid fa-plus"></i> Novo lançamento</button>
    </div>
    <div class="tabs" id="fin-tabs">
      <button class="tab active" data-tipo="receber">Contas a receber</button>
      <button class="tab" data-tipo="pagar">Contas a pagar</button>
    </div>
    <div class="fin-totais stat-grid" id="fin-totais"></div>
    <div class="card"><div class="card__body" id="fin-tabela">
      <div class="loading"><i class="fa-solid fa-spinner spin"></i></div>
    </div></div>
  `);

  document.getElementById("fin-novo").onclick = () => abrirForm();
  document.getElementById("fin-tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tab"); if (!b) return;
    document.querySelectorAll("#fin-tabs .tab").forEach((t) => t.classList.remove("active"));
    b.classList.add("active"); tipo = b.dataset.tipo; carregar();
  });

  async function carregar() {
    const alvo = document.getElementById("fin-tabela");
    alvo.innerHTML = `<div class="loading"><i class="fa-solid fa-spinner spin"></i></div>`;
    try {
      const r = await API.get(`/api/financeiro?tipo=${tipo}`);
      const lista = r.dados || [], t = r.totais || {};
      cache = lista;
      document.getElementById("fin-totais").innerHTML = `
        <div class="stat stat--info"><div class="stat__icon"><i class="fa-solid fa-clock"></i></div>
          <div class="stat__body"><div class="stat__value">${fmt.moeda(t.aberto)}</div><div class="stat__label">Em aberto</div></div></div>
        <div class="stat stat--success"><div class="stat__icon"><i class="fa-solid fa-circle-check"></i></div>
          <div class="stat__body"><div class="stat__value">${fmt.moeda(t.pago)}</div><div class="stat__label">Baixado</div></div></div>
        <div class="stat stat--danger"><div class="stat__icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
          <div class="stat__body"><div class="stat__value">${fmt.moeda(t.atrasado)}</div><div class="stat__label">Atrasado</div></div></div>`;

      if (!lista.length) { alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-inbox"></i>Nenhum lançamento</div>`; return; }
      const tom = { aberto: "info", parcial: "warning", pago: "success", atrasado: "danger" };
      const rotulo = { aberto: "aberto", parcial: "parcial", pago: "pago", atrasado: "atrasado" };
      alvo.innerHTML = `<div class="table-wrap"><table class="data">
        <thead><tr><th>Descrição</th><th>${tipo === "receber" ? "Cliente" : "Fornecedor"}</th>
          <th>Categoria</th><th>Vencimento</th><th>Valor</th><th>Pago</th><th>Status</th><th></th></tr></thead>
        <tbody>${lista.map((f) => {
          const temEncargo = num(f.juros) + num(f.multa) > 0;
          const rest = restante(f);
          return `<tr>
          <td>
            ${f.descricao || "-"}
            ${f.total_parcelas > 1 ? `<span style="font-size:.7rem;background:#e0f2fe;color:#0369a1;
              padding:1px 6px;border-radius:99px;margin-left:4px;white-space:nowrap">
              ${f.num_parcela === 0 ? "Entrada" : `${f.num_parcela}/${f.total_parcelas}`}
            </span>` : ""}
          </td>
          <td>${(tipo === "receber" ? f.cliente_nome : f.fornecedor_nome) || "-"}</td>
          <td>${f.categoria ? `<span class="badge badge--info">${f.categoria}</span>` : `<small class="muted">—</small>`}</td>
          <td>${fmt.data(f.vencimento)}</td>
          <td>${fmt.moeda(f.valor)}${temEncargo ? ` <i class="fa-solid fa-plus-circle" title="+ ${fmt.moeda(num(f.juros)+num(f.multa))} juros/multa"></i>` : ""}</td>
          <td>${num(f.valor_pago) ? fmt.moeda(f.valor_pago) : "-"}${f.status === "parcial" ? ` <small class="muted">(falta ${fmt.moeda(rest)})</small>` : ""}</td>
          <td><span class="badge badge--${tom[f.status] || ""}">${rotulo[f.status] || f.status}</span></td>
          <td class="text-right">
            ${f.status !== "pago" ? `<button class="icon-btn btn--sm" title="Baixar" onclick="window.__fin.baixar(${f.id})"><i class="fa-solid fa-check-double"></i></button>` : ""}
            ${tipo === "receber" && f.status !== "pago" ? (f.boleto_url
              ? `<a class="icon-btn btn--sm" title="Ver boleto" href="${f.boleto_url}" target="_blank"><i class="fa-solid fa-barcode"></i></a>`
              : `<button class="icon-btn btn--sm" title="Gerar boleto" onclick="window.__fin.boleto(${f.id})"><i class="fa-solid fa-barcode"></i></button>`) : ""}
            ${f.status !== "pago" ? `<button class="icon-btn btn--sm" title="Editar" onclick="window.__fin.editar(${f.id})"><i class="fa-solid fa-pen"></i></button>` : ""}
            <button class="icon-btn btn--sm" title="Excluir" onclick="window.__fin.excluir(${f.id})"><i class="fa-solid fa-trash"></i></button>
          </td></tr>`;
        }).join("")}
        </tbody></table></div>`;
    } catch (e) {
      alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
    }
  }

  // Form de criar/editar. Se "reg" vier preenchido, é edição.
  function abrirForm(reg) {
    const ed = !!reg;
    const val = (k, d = "") => (ed && reg[k] != null ? reg[k] : d);
    const parceiro = tipo === "receber"
      ? `<div class="field col-2"><label>Cliente</label><select name="cliente_id"><option value="">— nenhum —</option>
          ${clientes.map((c) => `<option value="${c.id}" ${String(val("cliente_id")) === String(c.id) ? "selected" : ""}>${c.nome}</option>`).join("")}</select></div>`
      : `<div class="field col-2"><label>Fornecedor</label><select name="fornecedor_id"><option value="">— nenhum —</option>
          ${fornecedores.map((f) => `<option value="${f.id}" ${String(val("fornecedor_id")) === String(f.id) ? "selected" : ""}>${f.nome}</option>`).join("")}</select></div>`;
    Modal.abrir(`${ed ? "Editar" : "Novo"} lançamento — ${tipo === "receber" ? "a receber" : "a pagar"}`, `
      <div class="form-grid" id="fin-form">
        <div class="field col-2"><label>Descrição *</label><input name="descricao" value="${val("descricao")}"></div>
        ${parceiro}
        <div class="field"><label>Valor *</label><input type="number" step="0.01" name="valor" id="fin-valor" value="${val("valor")}" oninput="window.__fin._prevCarne()"></div>
        <div class="field"><label>Vencimento</label><input type="date" name="vencimento" value="${val("vencimento") ? String(val("vencimento")).slice(0,10) : ""}"></div>
        <div class="field"><label>Juros (R$)</label><input type="number" step="0.01" name="juros" value="${val("juros", 0)}"></div>
        <div class="field"><label>Multa (R$)</label><input type="number" step="0.01" name="multa" value="${val("multa", 0)}"></div>
        <div class="field"><label>Forma de pagamento</label><select name="forma_pagamento">
          ${FORMAS.map((f) => `<option value="${f}" ${val("forma_pagamento") === f ? "selected" : ""}>${f}</option>`).join("")}</select></div>
        <div class="field"><label>Categoria (DRE)</label><select name="categoria">
          <option value="">— sem categoria —</option>
          ${(CATEGORIAS[tipo] || []).map((c) => `<option value="${c}" ${val("categoria") === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
        ${!ed ? `
        <!-- Parcelamento / Carnê -->
        <div class="field col-2" style="border-top:1px solid var(--border,#eee);padding-top:.75rem;margin-top:.25rem">
          <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer">
            <input type="checkbox" id="fin-parcelar" onchange="window.__fin._toggleCarne(this.checked)">
            <span style="font-weight:600"><i class="fa-solid fa-receipt"></i> Parcelar / Gerar Carnê</span>
          </label>
        </div>
        <div id="fin-carne-wrap" style="display:none;grid-column:1/-1">
          <div class="form-grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:.6rem">
            <div class="field"><label>Nº de parcelas</label>
              <input type="number" id="carne-parcelas" value="3" min="2" max="60"
                oninput="window.__fin._prevCarne()"></div>
            <div class="field"><label>Entrada (R$)</label>
              <input type="number" id="carne-entrada" value="0" min="0" step="0.01"
                oninput="window.__fin._prevCarne()"></div>
            <div class="field"><label>1ª parcela em</label>
              <input type="date" id="carne-data1"></div>
          </div>
          <div id="carne-preview" style="margin-top:.75rem;background:var(--bg-alt,#f8f9fa);
            border-radius:8px;padding:.75rem;font-size:.82rem"></div>
        </div>` : ""}
      </div>`,
      `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
       <button class="btn btn--primary" id="fin-salvar"><i class="fa-solid fa-check"></i> Salvar</button>`);

    // Preview do carnê
    window.__fin._prevCarne = () => {
      const wrap = document.getElementById("carne-preview");
      if (!wrap) return;
      const total = parseFloat(document.getElementById("fin-valor")?.value) || 0;
      const n = parseInt(document.getElementById("carne-parcelas")?.value) || 1;
      const ent = parseFloat(document.getElementById("carne-entrada")?.value) || 0;
      const data1Inp = document.getElementById("carne-data1")?.value;
      if (!total || n < 1) { wrap.innerHTML = ""; return; }
      const parc = (total - ent) / n;
      const hoje = new Date();
      const linhas = [];
      if (ent > 0) {
        linhas.push(`<tr><td>Entrada</td><td>${hoje.toLocaleDateString("pt-BR")}</td>
          <td style="text-align:right"><strong>${fmt.moeda(ent)}</strong></td></tr>`);
      }
      for (let i = 0; i < n; i++) {
        let d;
        if (data1Inp) {
          d = new Date(data1Inp + "T00:00");
          d.setMonth(d.getMonth() + i);
        } else {
          d = new Date();
          d.setMonth(d.getMonth() + i + 1);
        }
        const val = i === n-1 ? Math.round((total - ent - parc*(n-1))*100)/100 : Math.round(parc*100)/100;
        linhas.push(`<tr><td>${i+1}/${n}</td><td>${d.toLocaleDateString("pt-BR")}</td>
          <td style="text-align:right">${fmt.moeda(val)}</td></tr>`);
      }
      wrap.innerHTML = `<strong>Preview do carnê:</strong>
        <table style="width:100%;border-collapse:collapse;margin-top:.4rem">
          <thead><tr style="color:var(--text-muted)"><th style="text-align:left">Parcela</th>
            <th style="text-align:left">Vencimento</th><th style="text-align:right">Valor</th></tr></thead>
          <tbody>${linhas.join("")}</tbody>
          <tfoot><tr style="border-top:1px solid #ddd;font-weight:700">
            <td colspan="2">Total</td><td style="text-align:right">${fmt.moeda(total)}</td></tr></tfoot>
        </table>`;
    };
    window.__fin._toggleCarne = (on) => {
      const w = document.getElementById("fin-carne-wrap");
      if (w) w.style.display = on ? "" : "none";
      if (on) {
        // Pré-preenche data1 com próximo mês
        const d = new Date(); d.setMonth(d.getMonth()+1);
        const inp = document.getElementById("carne-data1");
        if (inp && !inp.value) inp.value = d.toISOString().slice(0,10);
        window.__fin._prevCarne();
      }
    };

    document.getElementById("fin-salvar").onclick = async () => {
      const f = document.getElementById("fin-form");
      const usaCarne = document.getElementById("fin-parcelar")?.checked;
      const descricao = f.querySelector("[name=descricao]").value.trim();
      const valor = parseFloat(f.querySelector("[name=valor]").value) || 0;
      const vencimento = f.querySelector("[name=vencimento]")?.value || null;
      const forma = f.querySelector("[name=forma_pagamento]").value;
      const categoria = f.querySelector("[name=categoria]").value || null;
      const juros = parseFloat(f.querySelector("[name=juros]")?.value) || 0;
      const multa = parseFloat(f.querySelector("[name=multa]")?.value) || 0;
      const cli = f.querySelector("[name=cliente_id]");
      const forn = f.querySelector("[name=fornecedor_id]");
      if (!descricao || !valor) { toast("Informe descrição e valor", "warning"); return; }

      try {
        if (ed) {
          await API.put(`/api/financeiro/${reg.id}`, {
            tipo, descricao, valor, vencimento, forma_pagamento: forma,
            categoria, juros, multa,
            cliente_id: cli ? (cli.value || null) : null,
            fornecedor_id: forn ? (forn.value || null) : null,
          });
          toast("Lançamento atualizado");
        } else if (usaCarne) {
          const n = parseInt(document.getElementById("carne-parcelas")?.value) || 1;
          const ent = parseFloat(document.getElementById("carne-entrada")?.value) || 0;
          const data1 = document.getElementById("carne-data1")?.value || null;
          if (n < 2) { toast("Parcelamento requer ao menos 2 parcelas", "warning"); return; }
          await API.post("/api/financeiro/parcelar", {
            tipo, descricao, valor_total: valor, entrada: ent,
            num_parcelas: n, primeira_data: data1,
            forma_pagamento: forma, categoria,
            cliente_id: cli ? (cli.value || null) : null,
            os_id: null,
          });
          toast(`Carnê gerado — ${n} parcela(s)${ent > 0 ? " + entrada" : ""}`);
        } else {
          await API.post("/api/financeiro", {
            tipo, descricao, valor, vencimento, forma_pagamento: forma,
            categoria, juros, multa,
            cliente_id: cli ? (cli.value || null) : null,
            fornecedor_id: forn ? (forn.value || null) : null,
          });
          toast("Lançamento criado");
        }
        Modal.fechar(); carregar();
      } catch (e) { toast(e.message, "error"); }
    };
  }

  window.__fin = {
    async baixar(id) {
      const f = cache.find((x) => x.id === id);
      if (!f) return;
      const devido = totalDevido(f);
      const rest = restante(f);
      const encargo = num(f.juros) + num(f.multa);
      Modal.abrir("Baixar lançamento", `
        <div class="form-grid" id="baixa-form">
          <div class="field col-2">
            <div class="baixa-resumo">
              <div>Valor: <strong>${fmt.moeda(f.valor)}</strong></div>
              ${encargo > 0 ? `<div>Juros + multa: <strong>${fmt.moeda(encargo)}</strong></div>` : ""}
              <div>Total devido: <strong>${fmt.moeda(devido)}</strong></div>
              ${num(f.valor_pago) ? `<div>Já pago: <strong>${fmt.moeda(f.valor_pago)}</strong></div>` : ""}
              <div>Restante: <strong>${fmt.moeda(rest)}</strong></div>
            </div>
          </div>
          <div class="field"><label>Valor a pagar agora</label><input type="number" step="0.01" name="valor_pago" value="${rest.toFixed(2)}"></div>
          <div class="field"><label>Forma</label><select name="forma_pagamento">
            ${FORMAS.map((x) => `<option value="${x}" ${f.forma_pagamento === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
          <div class="field col-2"><small class="muted">Pagar menos que o restante registra baixa parcial; o saldo continua em aberto.</small></div>
        </div>`,
        `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
         <button class="btn btn--success" id="baixa-ok"><i class="fa-solid fa-check-double"></i> Confirmar baixa</button>`);
      document.getElementById("baixa-ok").onclick = async () => {
        const form = document.getElementById("baixa-form");
        const vp = parseFloat(form.valor_pago.value) || rest;
        try {
          const r = await API.post(`/api/financeiro/${id}/baixar`, {
            valor_pago: vp,
            forma_pagamento: form.forma_pagamento.value,
          });
          toast(r.status === "parcial"
            ? `Baixa parcial — restam ${fmt.moeda(r.restante)}`
            : "Lançamento quitado");
          Modal.fechar(); carregar();
        } catch (e) { toast(e.message, "error"); }
      };
    },
    editar(id) {
      const f = cache.find((x) => x.id === id);
      if (f) abrirForm(f);
    },
    async boleto(id) {
      if (!confirm("Gerar boleto para esta conta a receber?")) return;
      try {
        const r = await API.post(`/api/boletos/gerar/${id}`, {});
        if (r.status === "nao_configurado") { toast(r.mensagem || "Provedor de boleto não configurado", "warning"); return; }
        if (r.ok) {
          toast("Boleto gerado");
          if (r.boleto_url) window.open(r.boleto_url, "_blank");
          carregar();
        } else {
          toast(r.mensagem || "Não foi possível gerar o boleto", "error");
        }
      } catch (e) { toast(e.message, "error"); }
    },
    async excluir(id) {
      if (!confirm("Excluir este lançamento?")) return;
      try { await API.del(`/api/financeiro/${id}`); toast("Excluído"); carregar(); }
      catch (e) { toast(e.message, "error"); }
    },
  };

  carregar();
})();
