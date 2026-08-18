/* =======================================================================
   etiquetas.js — Impressão de etiquetas em lote
   - Lista todos os produtos com checkbox
   - Produtos sem etiqueta impressa = "novos" (marcados automaticamente)
   - Ao imprimir, registra data/hora e marca como impressos
   ======================================================================= */
(async () => {
  await Layout.iniciar("etiquetas", "Etiquetas");

  const cfg = Layout.config || {};
  const empresa = cfg.empresa_nome || "";

  Layout.set(`
    <div class="page-head">
      <div><h1>Impressão de Etiquetas</h1>
        <p>Selecione os produtos e imprima as etiquetas em lote</p></div>
    </div>

    <!-- Configurações de impressão -->
    <div class="card" style="margin-bottom:1rem"><div class="card__body">
      <div class="form-grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:.75rem;align-items:flex-end">
        <div class="field" style="margin:0"><label>Tipo de etiqueta</label>
          <select id="etq-tipo">
            <option value="pimaco_a4" ${(cfg.etiqueta_tipo||"pimaco_a4")==="pimaco_a4"?"selected":""}>Pimaco A4 (3 colunas)</option>
            <option value="termica_10x5" ${(cfg.etiqueta_tipo||"")==="termica_10x5"?"selected":""}>Térmica 10×5 cm</option>
            <option value="termica_10x3" ${(cfg.etiqueta_tipo||"")==="termica_10x3"?"selected":""}>Térmica 10×3 cm</option>
          </select>
        </div>
        <div class="field" style="margin:0"><label>Mostrar preço?</label>
          <select id="etq-preco">
            <option value="1" ${(cfg.etiqueta_mostrar_preco||"1")==="1"?"selected":""}>Sim</option>
            <option value="0" ${(cfg.etiqueta_mostrar_preco||"")==="0"?"selected":""}>Não</option>
          </select>
        </div>
        <div class="field" style="margin:0"><label>Código de barras?</label>
          <select id="etq-barras">
            <option value="1" ${(cfg.etiqueta_mostrar_barras||"1")==="1"?"selected":""}>Sim</option>
            <option value="0" ${(cfg.etiqueta_mostrar_barras||"")==="0"?"selected":""}>Não</option>
          </select>
        </div>
        <div class="field" style="margin:0"><label>Localização?</label>
          <select id="etq-local">
            <option value="1" ${(cfg.etiqueta_mostrar_local||"1")==="1"?"selected":""}>Sim</option>
            <option value="0" ${(cfg.etiqueta_mostrar_local||"")==="0"?"selected":""}>Não</option>
          </select>
        </div>
        <div class="field" style="margin:0"><label>Qtd. por produto</label>
          <input type="number" id="etq-qtd-padrao" value="1" min="1" max="100" style="width:80px">
        </div>
      </div>
    </div></div>

    <!-- Toolbar de seleção -->
    <div class="card"><div class="card__body">
      <div class="toolbar" style="margin-bottom:1rem;flex-wrap:wrap;gap:.5rem">
        <div class="toolbar__search">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input id="etq-busca" placeholder="Buscar produto…">
        </div>
        <button class="btn btn--outline btn--sm" id="etq-sel-novos">
          <i class="fa-solid fa-star" style="color:#f59e0b"></i> Selecionar novos
        </button>
        <button class="btn btn--outline btn--sm" id="etq-sel-todos">
          <i class="fa-solid fa-check-double"></i> Selecionar todos
        </button>
        <button class="btn btn--ghost btn--sm" id="etq-des-todos">
          <i class="fa-solid fa-xmark"></i> Desmarcar todos
        </button>
        <div class="toolbar__spacer"></div>
        <span id="etq-contador" style="font-size:.85rem;color:var(--text-muted);align-self:center">
          0 selecionado(s)
        </span>
        <button class="btn btn--primary" id="etq-imprimir-btn" disabled>
          <i class="fa-solid fa-print"></i> Imprimir etiquetas
        </button>
      </div>

      <div id="etq-lista">
        <div class="loading"><i class="fa-solid fa-spinner spin"></i></div>
      </div>
    </div></div>
  `);

  let _produtos = [];
  let _selecionados = new Set();

  // Carrega produtos
  async function carregar() {
    try {
      const r = await API.get("/api/produtos?por_pagina=1000");
      _produtos = (r.dados || []).filter((p) => !p.produto_pai_id); // exclui variações
      renderLista(_produtos);
    } catch(e) {
      document.getElementById("etq-lista").innerHTML =
        `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
    }
  }

  function renderLista(lista) {
    if (!lista.length) {
      document.getElementById("etq-lista").innerHTML =
        `<div class="empty"><i class="fa-solid fa-inbox"></i>Nenhum produto encontrado</div>`;
      return;
    }

    document.getElementById("etq-lista").innerHTML = `
      <div class="table-wrap"><table class="data">
        <thead><tr>
          <th style="width:36px"><input type="checkbox" id="etq-chk-all"
            onchange="window.__etqLote.toggleAll(this.checked)"></th>
          <th>Produto</th>
          <th>Código</th>
          <th>Categoria</th>
          <th>Preço</th>
          <th>Qtd. etiquetas</th>
          <th>Situação</th>
        </tr></thead>
        <tbody>${lista.map((p) => {
          const novo = !p.etiqueta_impressa_em;
          const sel = _selecionados.has(p.id);
          return `<tr class="${novo ? "tr-novo" : ""}" style="${novo ? "background:#fffbeb" : ""}">
            <td><input type="checkbox" class="etq-chk" data-id="${p.id}"
              ${sel ? "checked" : ""} onchange="window.__etqLote.toggle(${p.id}, this.checked)"></td>
            <td>
              <strong>${p.nome}</strong>
              ${p.variacao_atributo ? `<span class="badge" style="margin-left:4px;font-size:.7rem">${p.variacao_atributo}</span>` : ""}
            </td>
            <td style="font-size:.82rem;color:var(--text-muted)">${p.codigo||"—"}</td>
            <td style="font-size:.82rem">${p.categoria||"—"}</td>
            <td>${fmt.moeda(p.preco_venda)}</td>
            <td>
              <input type="number" class="etq-qtd" data-id="${p.id}"
                value="1" min="1" max="100"
                style="width:60px;text-align:center;padding:2px 4px">
            </td>
            <td>
              ${novo
                ? `<span class="badge badge--warning" style="font-size:.72rem">
                    <i class="fa-solid fa-star"></i> Novo — nunca impresso
                  </span>`
                : `<span style="font-size:.75rem;color:var(--text-muted)">
                    <i class="fa-solid fa-check" style="color:#22c55e"></i>
                    Impresso ${fmt.data(p.etiqueta_impressa_em)}
                  </span>`}
            </td>
          </tr>`;
        }).join("")}
        </tbody>
      </table></div>`;

    atualizarContador();
  }

  function atualizarContador() {
    const n = _selecionados.size;
    document.getElementById("etq-contador").textContent = `${n} selecionado(s)`;
    document.getElementById("etq-imprimir-btn").disabled = n === 0;
    const all = document.getElementById("etq-chk-all");
    if (all) all.checked = n > 0 && n === _produtos.length;
  }

  // Busca
  document.getElementById("etq-busca").oninput = debounce((e) => {
    const q = e.target.value.trim().toLowerCase();
    const filtrado = q
      ? _produtos.filter((p) =>
          (p.nome||"").toLowerCase().includes(q) ||
          (p.codigo||"").toLowerCase().includes(q) ||
          (p.categoria||"").toLowerCase().includes(q))
      : _produtos;
    renderLista(filtrado);
  });

  // Botões de seleção
  document.getElementById("etq-sel-novos").onclick = () => {
    _selecionados.clear();
    _produtos.filter((p) => !p.etiqueta_impressa_em).forEach((p) => _selecionados.add(p.id));
    renderLista(_produtos);
  };
  document.getElementById("etq-sel-todos").onclick = () => {
    _produtos.forEach((p) => _selecionados.add(p.id));
    renderLista(_produtos);
  };
  document.getElementById("etq-des-todos").onclick = () => {
    _selecionados.clear();
    renderLista(_produtos);
  };

  // Imprimir
  document.getElementById("etq-imprimir-btn").onclick = async () => {
    if (!_selecionados.size) return;
    const tipo = document.getElementById("etq-tipo").value;
    const mostrarPreco = document.getElementById("etq-preco").value === "1";
    const mostrarBarras = document.getElementById("etq-barras").value === "1";
    const mostrarLocal = document.getElementById("etq-local").value === "1";
    const qtdPadrao = parseInt(document.getElementById("etq-qtd-padrao").value) || 1;

    // Monta lista de produtos selecionados com quantidades individuais
    const selecionados = _produtos
      .filter((p) => _selecionados.has(p.id))
      .map((p) => {
        const qtdInput = document.querySelector(`.etq-qtd[data-id="${p.id}"]`);
        const qtd = qtdInput ? (parseInt(qtdInput.value) || 1) : qtdPadrao;
        return { ...p, qtd_etiqueta: qtd };
      });

    // Gera HTML das etiquetas
    const etiquetasHtml = selecionados.flatMap((p) =>
      Array(p.qtd_etiqueta).fill(null).map(() => _gerarEtiqueta(p, {
        tipo, mostrarPreco, mostrarBarras, mostrarLocal
      }))
    ).join("");

    let pageStyle, wrapStyle;
    if (tipo === "termica_10x5") {
      pageStyle = "@page{size:100mm 50mm;margin:0}";
      wrapStyle = "display:flex;flex-direction:column;gap:2mm;padding:2mm";
    } else if (tipo === "termica_10x3") {
      pageStyle = "@page{size:100mm 30mm;margin:0}";
      wrapStyle = "display:flex;flex-direction:column;gap:1mm;padding:1mm";
    } else {
      pageStyle = "@page{size:A4;margin:0}";
      wrapStyle = "display:grid;grid-template-columns:repeat(3,1fr);gap:3mm;padding:10mm;width:210mm;box-sizing:border-box";
    }

    const w = window.open("", "_blank");
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
      <title>Etiquetas</title>
      <style>${pageStyle} body{margin:0;padding:0;font-family:Arial,sans-serif;background:#fff}
      @media print{body{margin:0}}</style>
    </head><body>
      <div style="${wrapStyle}">${etiquetasHtml}</div>
    </body></html>`);
    w.document.close();
    w.onload = () => { w.focus(); w.print(); };

    // Marca como impressos
    try {
      await API.post("/api/produtos/etiquetas/marcar", { ids: [..._selecionados] });
      // Atualiza data de impressão nos dados locais
      const agora = new Date().toISOString();
      _produtos.forEach((p) => {
        if (_selecionados.has(p.id)) p.etiqueta_impressa_em = agora;
      });
      renderLista(_produtos);
      toast(`${selecionados.length} produto(s) marcado(s) como impresso(s)`);
    } catch(_) {}
  };

  function _gerarEtiqueta(p, opts) {
    const { tipo, mostrarPreco, mostrarBarras, mostrarLocal } = opts;
    const preco = Number(p.preco_venda || 0).toLocaleString("pt-BR", {style:"currency",currency:"BRL"});
    const cod = p.codigo_barras || p.ean || p.codigo || "";
    const tamNome = (p.nome||"").length > 35 ? "8px" : (p.nome||"").length > 25 ? "9px" : "11px";

    // Barcode simples
    const barcodeHtml = (codigo) => {
      if (!codigo) return "";
      const bars = codigo.split("").map((c) => c.charCodeAt(0)).join("");
      let svg = `<svg width="120" height="28" xmlns="http://www.w3.org/2000/svg">`;
      let x = 2;
      for (let i = 0; i < Math.min(bars.length, 60); i++) {
        const bw = (parseInt(bars[i]) % 3) + 1;
        if (i % 2 === 0) svg += `<rect x="${x}" y="0" width="${bw}" height="24" fill="#000"/>`;
        x += bw + 1;
      }
      svg += `<text x="60" y="27" text-anchor="middle" font-size="7" font-family="monospace">${codigo}</text></svg>`;
      return svg;
    };

    if (tipo === "termica_10x5") {
      return `<div style="width:264px;height:132px;padding:7px 8px;font-family:Arial,sans-serif;
        background:#fff;box-sizing:border-box;display:flex;flex-direction:column;gap:3px">
        ${empresa ? `<div style="font-size:7px;color:#aaa;text-align:center;text-transform:uppercase">${empresa}</div>` : ""}
        <div style="font-weight:700;font-size:${tamNome};line-height:1.3;text-align:center;flex:1;
          display:flex;align-items:center;justify-content:center;word-break:break-word">${p.nome}</div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-size:7.5px;color:#555">
            ${p.codigo ? `Cód: <strong>${p.codigo}</strong>` : ""}
            ${mostrarLocal && p.localizacao ? ` | ${p.localizacao}` : ""}
          </div>
          ${mostrarPreco ? `<div style="font-size:15px;font-weight:900;color:#0d9488">${preco}</div>` : ""}
        </div>
        ${mostrarBarras && cod ? `<div style="text-align:center;margin-top:2px">${barcodeHtml(cod)}</div>` : ""}
      </div>`;
    }

    if (tipo === "termica_10x3") {
      return `<div style="width:264px;height:79px;padding:5px 8px;font-family:Arial,sans-serif;
        background:#fff;box-sizing:border-box;display:flex;flex-direction:column;gap:2px">
        ${empresa ? `<div style="font-size:6px;color:#aaa;text-align:center;text-transform:uppercase">${empresa}</div>` : ""}
        <div style="font-weight:700;font-size:${tamNome};line-height:1.2;text-align:center;
          overflow:hidden;max-height:28px;word-break:break-word">${p.nome}</div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-size:7px;color:#555">${p.codigo ? `Cód: <strong>${p.codigo}</strong>` : ""}</div>
          ${mostrarPreco ? `<div style="font-size:13px;font-weight:900;color:#0d9488">${preco}</div>` : ""}
        </div>
        ${mostrarBarras && cod ? `<div style="text-align:center">${barcodeHtml(cod)}</div>` : ""}
      </div>`;
    }

    // Pimaco A4
    return `<div style="width:186px;height:107px;padding:6px 7px;font-family:Arial,sans-serif;
      background:#fff;box-sizing:border-box;display:flex;flex-direction:column;gap:2px">
      ${empresa ? `<div style="font-size:6px;color:#aaa;text-align:center;text-transform:uppercase">${empresa}</div>` : ""}
      <div style="font-weight:700;font-size:${tamNome};line-height:1.3;text-align:center;flex:1;
        display:flex;align-items:center;justify-content:center;word-break:break-word">${p.nome}</div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end">
        <div style="font-size:7px;color:#555;line-height:1.5">
          ${p.codigo ? `<div>Cód: <strong>${p.codigo}</strong></div>` : ""}
          ${mostrarLocal && p.localizacao ? `<div style="color:#888">${p.localizacao}</div>` : ""}
        </div>
        ${mostrarPreco ? `<div style="font-size:14px;font-weight:900;color:#0d9488">${preco}</div>` : ""}
      </div>
      ${mostrarBarras && cod ? `<div style="text-align:center;margin-top:1px">${barcodeHtml(cod)}</div>` : ""}
    </div>`;
  }

  window.__etqLote = {
    toggle(id, checked) {
      if (checked) _selecionados.add(id);
      else _selecionados.delete(id);
      atualizarContador();
    },
    toggleAll(checked) {
      if (checked) _produtos.forEach((p) => _selecionados.add(p.id));
      else _selecionados.clear();
      document.querySelectorAll(".etq-chk").forEach((c) => c.checked = checked);
      atualizarContador();
    },
  };

  window.__recarregar = carregar;
  carregar();
})();
