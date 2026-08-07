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
      <button class="tab" data-aba="sugestao"><i class="fa-solid fa-cart-shopping"></i> Sugestão de Compras</button>
      <button class="tab" data-aba="inventario"><i class="fa-solid fa-barcode"></i> Inventário</button>
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
      if (aba === "sugestao") return renderSugestao();
      if (aba === "inventario") return renderInventario();
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

  async function renderSugestao() {
    const r = await API.get("/api/estoque/sugestao-compras");
    const grupos = r.grupos || [];
    if (!grupos.length) {
      alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-check"></i>Nenhum produto abaixo do estoque mínimo</div>`;
      return;
    }

    const resumoHtml = `
      <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:1.5rem">
        <div class="stat-mini"><span>${r.total_itens}</span><label>Itens a repor</label></div>
        <div class="stat-mini"><span>${grupos.length}</span><label>Fornecedores</label></div>
        <div class="stat-mini"><span>${fmt.moeda(r.total_geral)}</span><label>Valor estimado total</label></div>
        <div style="margin-left:auto;align-self:center">
          <button class="btn btn--outline btn--sm" onclick="window.__sugestao.imprimirTudo()">
            <i class="fa-solid fa-print"></i> Imprimir tudo
          </button>
        </div>
      </div>`;

    const gruposHtml = grupos.map((g, gi) => `
      <div class="card" style="margin-bottom:1rem">
        <div class="card__body">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem;margin-bottom:1rem">
            <div>
              <strong style="font-size:1rem">${g.fornecedor}</strong>
              ${g.telefone ? `<span style="color:var(--text-muted);font-size:.85rem;margin-left:.75rem"><i class="fa-solid fa-phone"></i> ${g.telefone}</span>` : ""}
              ${g.email ? `<span style="color:var(--text-muted);font-size:.85rem;margin-left:.75rem"><i class="fa-solid fa-envelope"></i> ${g.email}</span>` : ""}
            </div>
            <div style="display:flex;gap:.5rem;align-items:center">
              <span style="font-weight:600;color:var(--primary)">${fmt.moeda(g.total_estimado)}</span>
              <button class="btn btn--outline btn--sm" onclick="window.__sugestao.imprimir(${gi})">
                <i class="fa-solid fa-print"></i> Imprimir
              </button>
              <button class="btn btn--primary btn--sm" onclick="abrirCotacao(${gi})">
                <i class="fa-solid fa-paper-plane"></i> Cotar / Email
              </button>
            </div>
          </div>
          <div class="table-wrap">
            <table class="data" id="sugestao-tbl-${gi}">
              <thead><tr>
                <th>Código</th><th>Produto</th><th>Categoria</th>
                <th>Atual</th><th>Mínimo</th><th>Máximo</th>
                <th>Sugerido</th><th>Preço Compra</th><th>Total Est.</th>
              </tr></thead>
              <tbody>${g.itens.map((p) => `<tr>
                <td>${p.codigo || "—"}</td>
                <td>${p.nome}</td>
                <td>${p.categoria || "—"}</td>
                <td><span class="badge badge--danger">${p.estoque_atual ?? 0}</span></td>
                <td>${p.estoque_minimo ?? 0}</td>
                <td>${p.estoque_maximo ?? 0}</td>
                <td><strong>${p.sugerido}</strong></td>
                <td>${fmt.moeda(p.preco_compra)}</td>
                <td>${fmt.moeda(p.valor_estimado)}</td>
              </tr>`).join("")}</tbody>
            </table>
          </div>
        </div>
      </div>`).join("");

    alvo.innerHTML = resumoHtml + gruposHtml;

    // Guarda dados para impressão
    window.__sugestao = {
      _grupos: grupos,
      _total_geral: r.total_geral,
      _gerarHtmlPedido(g) {
        const hoje = new Date().toLocaleDateString("pt-BR");
        const linhas = g.itens.map((p) => `
          <tr>
            <td>${p.codigo || "—"}</td>
            <td>${p.nome}</td>
            <td style="text-align:center">${p.estoque_atual ?? 0}</td>
            <td style="text-align:center">${p.estoque_minimo ?? 0}</td>
            <td style="text-align:center"><strong>${p.sugerido}</strong></td>
            <td style="text-align:right">R$ ${Number(p.preco_compra||0).toFixed(2)}</td>
            <td style="text-align:right">R$ ${Number(p.valor_estimado||0).toFixed(2)}</td>
          </tr>`).join("");
        return `<!DOCTYPE html><html><head><meta charset="UTF-8">
          <title>Pedido de Compra — ${g.fornecedor}</title>
          <style>
            body { font-family: Arial, sans-serif; font-size: 13px; padding: 24px; color: #222; }
            h1 { font-size: 18px; margin-bottom: 4px; }
            h2 { font-size: 14px; color: #555; margin-bottom: 16px; font-weight: normal; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; }
            th { background: #1a6b6b; color: #fff; padding: 7px 8px; text-align: left; font-size: 12px; }
            td { padding: 6px 8px; border-bottom: 1px solid #eee; }
            tr:nth-child(even) td { background: #f9f9f9; }
            .total { text-align: right; margin-top: 12px; font-weight: bold; font-size: 14px; }
            .rodape { margin-top: 32px; font-size: 11px; color: #888; border-top: 1px solid #ddd; padding-top: 8px; }
            @media print { body { padding: 0; } }
          </style></head><body>
          <h1>Pedido de Compra</h1>
          <h2>Fornecedor: <strong>${g.fornecedor}</strong>
            ${g.telefone ? " | Tel: " + g.telefone : ""}
            ${g.email ? " | E-mail: " + g.email : ""}
          </h2>
          <p style="font-size:12px;color:#888">Data: ${hoje}</p>
          <table>
            <thead><tr>
              <th>Código</th><th>Produto</th><th>Atual</th>
              <th>Mínimo</th><th>Qtd. Pedido</th><th>Preço Unit.</th><th>Total Est.</th>
            </tr></thead>
            <tbody>${linhas}</tbody>
          </table>
          <div class="total">Total estimado: R$ ${Number(g.total_estimado||0).toFixed(2)}</div>
          <div class="rodape">Documento gerado automaticamente pelo DevSystem PRIME em ${hoje}.</div>
        </body></html>`;
      },
      imprimir(gi) {
        const g = this._grupos[gi];
        const w = window.open("", "_blank");
        w.document.write(this._gerarHtmlPedido(g));
        w.document.close();
        w.onload = () => w.print();
      },
      imprimirTudo() {
        const hoje = new Date().toLocaleDateString("pt-BR");
        const todosFornecedores = this._grupos.map((g) => `
          <div style="page-break-after:always">
            <h2 style="font-size:16px;margin-bottom:4px">Pedido de Compra — ${g.fornecedor}</h2>
            ${g.telefone ? `<p style="font-size:12px;color:#555;margin:0">Tel: ${g.telefone}</p>` : ""}
            ${g.email ? `<p style="font-size:12px;color:#555;margin:0">E-mail: ${g.email}</p>` : ""}
            <p style="font-size:12px;color:#888">Data: ${hoje}</p>
            <table style="width:100%;border-collapse:collapse;margin-top:12px">
              <thead><tr style="background:#1a6b6b;color:#fff">
                <th style="padding:6px 8px;text-align:left;font-size:12px">Código</th>
                <th style="padding:6px 8px;text-align:left;font-size:12px">Produto</th>
                <th style="padding:6px 8px;text-align:center;font-size:12px">Atual</th>
                <th style="padding:6px 8px;text-align:center;font-size:12px">Mínimo</th>
                <th style="padding:6px 8px;text-align:center;font-size:12px">Qtd. Pedido</th>
                <th style="padding:6px 8px;text-align:right;font-size:12px">Preço Unit.</th>
                <th style="padding:6px 8px;text-align:right;font-size:12px">Total Est.</th>
              </tr></thead>
              <tbody>${g.itens.map((p, i) => `
                <tr style="background:${i%2===0?'#fff':'#f9f9f9'}">
                  <td style="padding:5px 8px;border-bottom:1px solid #eee">${p.codigo||"—"}</td>
                  <td style="padding:5px 8px;border-bottom:1px solid #eee">${p.nome}</td>
                  <td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:center">${p.estoque_atual??0}</td>
                  <td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:center">${p.estoque_minimo??0}</td>
                  <td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:center"><strong>${p.sugerido}</strong></td>
                  <td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right">R$ ${Number(p.preco_compra||0).toFixed(2)}</td>
                  <td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right">R$ ${Number(p.valor_estimado||0).toFixed(2)}</td>
                </tr>`).join("")}
              </tbody>
            </table>
            <div style="text-align:right;margin-top:10px;font-weight:bold">
              Total estimado: R$ ${Number(g.total_estimado||0).toFixed(2)}
            </div>
          </div>`).join("");
        const w = window.open("", "_blank");
        w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
          <title>Sugestão de Compras Completa</title>
          <style>body{font-family:Arial,sans-serif;font-size:13px;padding:24px;color:#222}
          h1{font-size:20px;margin-bottom:4px} @media print{body{padding:0}}</style>
          </head><body>
          <h1>Sugestão de Compras</h1>
          <p style="color:#888;font-size:12px;margin-bottom:24px">
            Gerado em ${hoje} — ${this._grupos.length} fornecedor(es) — 
            Total geral estimado: R$ ${Number(this._total_geral||0).toFixed(2)}
          </p>
          ${todosFornecedores}
        </body></html>`);
        w.document.close();
        w.onload = () => w.print();
      },
    };
  }

  // -----------------------------------------------------------------------
  // Cotação: modal de ajuste de quantidades + histórico de preço + envio
  // -----------------------------------------------------------------------
  // -----------------------------------------------------------------------
  // Inventário por coletor de dados
  // -----------------------------------------------------------------------
  async function renderInventario() {
    alvo.innerHTML = `
      <div style="margin-bottom:1rem">
        <h3 style="margin-bottom:.5rem">Inventário por Coletor</h3>
        <p style="color:var(--text-muted);font-size:.85rem;margin-bottom:1rem">
          Leia os códigos de barras dos produtos com o coletor ou digite o código manualmente.
          O sistema acumula as contagens. Ao finalizar, aplica o ajuste de estoque em lote.
        </p>
        <div style="display:flex;gap:.75rem;align-items:center;flex-wrap:wrap">
          <div style="position:relative;flex:1;min-width:220px">
            <i class="fa-solid fa-barcode" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--text-muted)"></i>
            <input id="inv-input" placeholder="Leia o código de barras ou digite o código…"
              autocomplete="off"
              style="width:100%;padding:.55rem .75rem .55rem 2.2rem;border:2px solid var(--primary);
                border-radius:8px;font-size:1rem;box-sizing:border-box">
          </div>
          <div class="field" style="margin:0;min-width:80px">
            <label style="font-size:.8rem">Qtd.</label>
            <input type="number" id="inv-qtd" value="1" min="1" step="1"
              style="width:80px;text-align:center">
          </div>
          <button class="btn btn--outline btn--sm" id="inv-limpar">
            <i class="fa-solid fa-trash"></i> Limpar lista
          </button>
          <button class="btn btn--primary" id="inv-aplicar" style="display:none">
            <i class="fa-solid fa-check-double"></i> Aplicar inventário
          </button>
        </div>
        <div id="inv-msg" style="margin-top:.5rem;font-size:.85rem;color:var(--text-muted)">
          Aguardando leitura…
        </div>
      </div>

      <div id="inv-tabela"></div>`;

    // Carrega produtos para busca
    let produtos = [];
    try {
      const r = await API.get("/api/produtos?por_pagina=1000");
      produtos = r.dados || [];
    } catch(_) {}

    const inventario = new Map(); // produto_id -> { produto, contado }
    let _ultimaTecla = 0;
    let _bufferScanner = "";
    let _timerScanner = null;

    const input = document.getElementById("inv-input");
    const msg = document.getElementById("inv-msg");

    function encontrar(codigo) {
      const q = (codigo || "").trim().toLowerCase();
      return produtos.find((p) =>
        (p.codigo || "").toLowerCase() === q ||
        (p.codigo_barras || "").toLowerCase() === q ||
        (p.ean || "").toLowerCase() === q ||
        (p.nome || "").toLowerCase() === q
      );
    }

    function adicionarLeitura(codigo) {
      const p = encontrar(codigo);
      const qtd = Math.max(1, parseInt(document.getElementById("inv-qtd")?.value) || 1);
      if (!p) {
        msg.innerHTML = `<span style="color:#e74c3c"><i class="fa-solid fa-triangle-exclamation"></i> Código <strong>${codigo}</strong> não encontrado no cadastro</span>`;
        input.value = "";
        return;
      }
      const atual = inventario.get(p.id) || { produto: p, contado: 0 };
      atual.contado += qtd;
      inventario.set(p.id, atual);
      msg.innerHTML = `<span style="color:#27ae60"><i class="fa-solid fa-check"></i> <strong>${p.nome}</strong> — ${atual.contado} unidade(s) contada(s)</span>`;
      input.value = "";
      document.getElementById("inv-qtd").value = "1";
      renderTabela();
    }

    function renderTabela() {
      const dados = [...inventario.values()];
      document.getElementById("inv-aplicar").style.display = dados.length ? "" : "none";
      if (!dados.length) {
        document.getElementById("inv-tabela").innerHTML = `
          <div class="empty"><i class="fa-solid fa-inbox"></i>Nenhum produto contado ainda</div>`;
        return;
      }
      document.getElementById("inv-tabela").innerHTML = `
        <p style="font-size:.85rem;color:var(--text-muted);margin-bottom:.5rem">
          ${dados.length} produto(s) contado(s) — clique no ✕ para remover um item
        </p>
        <div class="table-wrap"><table class="data">
          <thead><tr>
            <th>Produto</th><th>Código</th><th>Estoque Atual</th>
            <th>Contado</th><th>Diferença</th><th></th>
          </tr></thead>
          <tbody>${dados.map((it) => {
            const atual = Number(it.produto.estoque_atual || 0);
            const diff = it.contado - atual;
            const cor = diff > 0 ? "color:#27ae60" : diff < 0 ? "color:#e74c3c" : "color:#888";
            const sinal = diff > 0 ? "+" : "";
            return `<tr>
              <td><strong>${it.produto.nome}</strong></td>
              <td>${it.produto.codigo || "—"}</td>
              <td>${atual}</td>
              <td>
                <input type="number" value="${it.contado}" min="0" step="1"
                  style="width:70px;text-align:center"
                  onchange="window.__inv.atualizar(${it.produto.id}, this.value)">
              </td>
              <td style="${cor};font-weight:700">${sinal}${diff}</td>
              <td>
                <button class="icon-btn btn--sm" onclick="window.__inv.remover(${it.produto.id})">
                  <i class="fa-solid fa-xmark"></i>
                </button>
              </td>
            </tr>`;
          }).join("")}
          </tbody>
        </table></div>`;
    }

    // Detecção de scanner (< 50ms por tecla)
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const v = input.value.trim();
        if (v) adicionarLeitura(v);
        return;
      }
      const agora = Date.now();
      const intervalo = agora - _ultimaTecla;
      _ultimaTecla = agora;
      if (intervalo < 50 && e.key.length === 1) {
        _bufferScanner += e.key;
        clearTimeout(_timerScanner);
        _timerScanner = setTimeout(() => {
          if (_bufferScanner.length >= 4) {
            adicionarLeitura(_bufferScanner);
          }
          _bufferScanner = "";
        }, 80);
      } else {
        _bufferScanner = "";
      }
    });

    document.getElementById("inv-limpar").onclick = () => {
      if (!inventario.size || confirm("Limpar toda a contagem?")) {
        inventario.clear();
        renderTabela();
        msg.textContent = "Aguardando leitura…";
        document.getElementById("inv-aplicar").style.display = "none";
      }
    };

    document.getElementById("inv-aplicar").onclick = async () => {
      const dados = [...inventario.values()];
      if (!dados.length) return;
      if (!confirm(`Aplicar ajuste de estoque para ${dados.length} produto(s)?

Esta ação atualiza o estoque atual para os valores contados.`)) return;

      const btn = document.getElementById("inv-aplicar");
      btn.disabled = true;
      btn.innerHTML = `<i class="fa-solid fa-spinner spin"></i> Aplicando…`;

      let ok = 0, erros = 0;
      for (const it of dados) {
        try {
          await API.post("/api/estoque/movimentar", {
            produto_id: it.produto.id,
            tipo: "ajuste",
            quantidade: it.contado,
            documento: "Inventário por coletor",
            origem: "inventario",
          });
          ok++;
        } catch(_) { erros++; }
      }

      toast(`Inventário aplicado — ${ok} produto(s) ajustado(s)${erros ? `, ${erros} erro(s)` : ""}`);
      inventario.clear();
      renderTabela();
      msg.textContent = "Inventário aplicado. Aguardando nova leitura…";
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-check-double"></i> Aplicar inventário`;
      btn.style.display = "none";
    };

    window.__inv = {
      atualizar(id, val) {
        const it = inventario.get(id);
        if (it) { it.contado = Math.max(0, parseInt(val) || 0); inventario.set(id, it); renderTabela(); }
      },
      remover(id) { inventario.delete(id); renderTabela(); },
    };

    renderTabela();
    setTimeout(() => input.focus(), 100);
  }

  async function abrirCotacao(gi) {
    const g = window.__sugestao?._grupos?.[gi];
    if (!g) return;

    // Carrega histórico de preço de cada item
    const itensComHistorico = await Promise.all(g.itens.map(async (it) => {
      try {
        const r = await API.get(`/api/estoque/cotacao/historico/${it.id}`);
        return { ...it, _historico: r.historico || [], _ultimo_xml: r.ultimo_xml };
      } catch (_) { return { ...it, _historico: [], _ultimo_xml: null }; }
    }));

    const linhas = itensComHistorico.map((it, idx) => {
      const ultimoPreco = it._ultimo_xml
        ? `<span style="color:var(--text-muted);font-size:.8rem">Último: R$ ${Number(it._ultimo_xml.preco_atual||0).toFixed(2)} (${it._ultimo_xml.origem})</span>`
        : `<span style="color:var(--text-muted);font-size:.8rem">Sem histórico</span>`;
      return `<tr>
        <td style="padding:6px 4px">${it.codigo || "—"}</td>
        <td style="padding:6px 4px">${it.nome}<br>${ultimoPreco}</td>
        <td style="padding:6px 4px;text-align:center">
          <input type="number" step="0.01" min="1" value="${it.sugerido}"
            id="cot-qtd-${idx}" style="width:70px;text-align:center">
        </td>
        <td style="padding:6px 4px;text-align:right">
          <input type="number" step="0.01" min="0"
            value="${Number(it.preco_compra||0).toFixed(2)}"
            id="cot-ref-${idx}" style="width:90px;text-align:right"
            placeholder="R$ ref.">
        </td>
      </tr>`;
    }).join("");

    Modal.abrir(
      `<i class="fa-solid fa-envelope"></i> Cotação — ${g.fornecedor}`,
      `<div style="margin-bottom:1rem">
        <p style="color:var(--text-muted);font-size:.85rem;margin-bottom:.5rem">
          Ajuste as quantidades e o preço de referência antes de enviar.
        </p>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="font-size:.8rem;color:var(--text-muted)">
            <th style="padding:6px 4px;text-align:left">Código</th>
            <th style="padding:6px 4px;text-align:left">Produto</th>
            <th style="padding:6px 4px;text-align:center">Qtd.</th>
            <th style="padding:6px 4px;text-align:right">Ref. Preço</th>
          </tr></thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>
      <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:.6rem;margin-top:1rem">
        <div class="field col-2">
          <label>E-mail do fornecedor *</label>
          <input id="cot-email" type="email" value="${g.email || ""}"
            placeholder="email@fornecedor.com.br">
        </div>
        <div class="field">
          <label>Prazo desejado</label>
          <input id="cot-prazo" placeholder="ex: 5 dias úteis">
        </div>
        <div class="field">
          <label>Assunto (opcional)</label>
          <input id="cot-assunto" placeholder="Pedido de Cotação — ...">
        </div>
        <div class="field col-2">
          <label>Observações</label>
          <input id="cot-obs" placeholder="Informações adicionais ao fornecedor…">
        </div>
      </div>`,
      `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
       <button class="btn btn--outline" onclick="window.__cotacao.imprimir(${gi})">
         <i class="fa-solid fa-print"></i> Só imprimir
       </button>
       <button class="btn btn--primary" id="cot-enviar-btn">
         <i class="fa-solid fa-paper-plane"></i> Enviar por email
       </button>`,
      true
    );

    document.getElementById("cot-enviar-btn").onclick = async () => {
      const email = document.getElementById("cot-email")?.value.trim();
      if (!email) { toast("Informe o e-mail do fornecedor", "warning"); return; }

      const itensCotacao = itensComHistorico.map((it, idx) => ({
        produto_id: it.id,
        nome: it.nome,
        codigo: it.codigo,
        quantidade: parseFloat(document.getElementById(`cot-qtd-${idx}`)?.value || it.sugerido),
        preco_referencia: parseFloat(document.getElementById(`cot-ref-${idx}`)?.value || 0) || null,
      }));

      const btn = document.getElementById("cot-enviar-btn");
      btn.disabled = true;
      btn.innerHTML = `<i class="fa-solid fa-spinner spin"></i> Enviando…`;

      try {
        await API.post("/api/estoque/cotacao/enviar", {
          fornecedor_id: g.fornecedor_id,
          email_destino: email,
          itens: itensCotacao,
          obs: document.getElementById("cot-obs")?.value.trim() || null,
          prazo: document.getElementById("cot-prazo")?.value.trim() || null,
          assunto_custom: document.getElementById("cot-assunto")?.value.trim() || null,
        });
        toast(`Cotação enviada para ${email}`);
        Modal.fechar();
      } catch (e) {
        toast(e.message, "error");
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Enviar por email`;
      }
    };

    window.__cotacao = {
      _gi: gi,
      imprimir(gi) { window.__sugestao?.imprimir(gi); Modal.fechar(); },
    };
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
