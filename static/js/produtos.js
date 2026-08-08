/* =======================================================================
   produtos.js — Página de Produtos (Crud genérico + Grade de variações)
   ======================================================================= */
(async () => {
  await Layout.iniciar("produtos", "Produtos");

  // Fornecedores para o <select>
  let opcoesForn = [];
  try {
    const r = await API.get("/api/fornecedores");
    opcoesForn = (r.dados || r || []).map((f) => [f.id, f.nome]);
  } catch (_) {}

  // -----------------------------------------------------------------------
  // Modal de grade (variações) — usa Modal.abrir() do sistema
  // -----------------------------------------------------------------------
  async function abrirGrade(prodId, prodNome) {
    Modal.abrir(
      `<i class="fa-solid fa-layer-group"></i> Grade — ${prodNome}`,
      `<p style="color:var(--text-muted);font-size:.85rem;margin-bottom:1rem">
        Cada variação herda categoria, marca e NCM do produto pai.
        Estoque é controlado individualmente por variação.
      </p>
      <div class="table-wrap">
        <table class="data">
          <thead><tr>
            <th>Atributo</th><th>Código</th><th>Cód. Barras</th>
            <th>Compra</th><th>Venda</th><th>Estoque</th><th>Margem</th><th></th>
          </tr></thead>
          <tbody id="tbody-var-${prodId}">
            <tr><td colspan="8" style="text-align:center">Carregando…</td></tr>
          </tbody>
        </table>
      </div>
      <hr style="margin:1.2rem 0">
      <h3 style="font-size:.9rem;font-weight:600;margin-bottom:.75rem;color:var(--text-muted)">NOVA VARIAÇÃO</h3>
      <div class="form-grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:.6rem">
        <div class="field"><label>Atributo *</label>
          <input id="var-attr-${prodId}" placeholder="ex: 1L, 175/65R14"></div>
        <div class="field"><label>Código</label>
          <input id="var-cod-${prodId}" placeholder="SKU"></div>
        <div class="field"><label>Cód. Barras</label>
          <input id="var-barras-${prodId}"></div>
        <div class="field"><label>Preço Compra</label>
          <input id="var-compra-${prodId}" type="number" step="0.01" value="0"></div>
        <div class="field"><label>Preço Venda</label>
          <input id="var-venda-${prodId}" type="number" step="0.01" value="0"></div>
        <div class="field"><label>Estoque Inicial</label>
          <input id="var-estoque-${prodId}" type="number" step="0.01" value="0"></div>
        <div class="field"><label>Estoque Mín.</label>
          <input id="var-emin-${prodId}" type="number" step="0.01" value="0"></div>
        <div class="field"><label>Comissão (%)</label>
          <input id="var-com-${prodId}" type="number" step="0.01" value="0"></div>
      </div>`,
      `<button class="btn btn--ghost" onclick="Modal.fechar()">Fechar</button>
       <button class="btn btn--primary" onclick="window.__grade.salvar(${prodId})">
         <i class="fa-solid fa-plus"></i> Adicionar Variação
       </button>`,
      true  // modalGrande
    );
    carregarVariacoes(prodId);
  }

  async function carregarVariacoes(prodId) {
    try {
      const r = await API.get(`/api/produtos/${prodId}/variacoes`);
      const tbody = document.getElementById(`tbody-var-${prodId}`);
      if (!tbody) return;
      if (!r.variacoes || r.variacoes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-muted)">Nenhuma variação cadastrada</td></tr>`;
        return;
      }
      tbody.innerHTML = r.variacoes.map((v) => `
        <tr id="var-row-${v.id}">
          <td><strong>${v.variacao_atributo || "—"}</strong></td>
          <td>${v.codigo || "—"}</td>
          <td>${v.codigo_barras || "—"}</td>
          <td>${fmt.moeda(v.preco_compra)}</td>
          <td>${fmt.moeda(v.preco_venda)}</td>
          <td>
            <span class="badge ${Number(v.estoque_atual) <= Number(v.estoque_minimo || 0) ? "badge--danger" : "badge--success"}">
              ${v.estoque_atual ?? 0}
            </span>
          </td>
          <td>${v._margem != null ? v._margem + "%" : "—"}</td>
          <td>
            <button class="icon-btn" title="Excluir" onclick="window.__grade.excluir(${v.id},${prodId})">
              <i class="fa-solid fa-trash"></i>
            </button>
          </td>
        </tr>`).join("");
    } catch (e) { console.error(e); }
  }

  window.__grade = {
    abrir: abrirGrade,
    async salvar(prodId) {
      const attr = document.getElementById(`var-attr-${prodId}`)?.value.trim();
      if (!attr) { toast("Informe o atributo da variação (ex: 1L)", "error"); return; }
      try {
        await API.post(`/api/produtos/${prodId}/variacoes`, {
          variacao_atributo: attr,
          codigo: document.getElementById(`var-cod-${prodId}`)?.value.trim() || null,
          codigo_barras: document.getElementById(`var-barras-${prodId}`)?.value.trim() || null,
          preco_compra: parseFloat(document.getElementById(`var-compra-${prodId}`)?.value || 0),
          preco_venda: parseFloat(document.getElementById(`var-venda-${prodId}`)?.value || 0),
          estoque_atual: parseFloat(document.getElementById(`var-estoque-${prodId}`)?.value || 0),
          estoque_minimo: parseFloat(document.getElementById(`var-emin-${prodId}`)?.value || 0),
          comissao_percentual: parseFloat(document.getElementById(`var-com-${prodId}`)?.value || 0),
        });
        toast("Variação adicionada");
        [`var-attr-${prodId}`,`var-cod-${prodId}`,`var-barras-${prodId}`].forEach((id) => {
          const el = document.getElementById(id); if (el) el.value = "";
        });
        [`var-compra-${prodId}`,`var-venda-${prodId}`,`var-estoque-${prodId}`,`var-emin-${prodId}`,`var-com-${prodId}`].forEach((id) => {
          const el = document.getElementById(id); if (el) el.value = "0";
        });
        carregarVariacoes(prodId);
      } catch (e) { toast(e.message, "error"); }
    },
    async excluir(vid, prodId) {
      if (!confirm(`⚠️ Excluir Variação\n\nTem certeza que deseja excluir esta variação?\n\nEsta ação não pode ser desfeita.`)) return;
      try {
        await API.delete(`/api/produtos/variacoes/${vid}`);
        toast("Variação removida");
        carregarVariacoes(prodId);
      } catch (e) { toast(e.message, "error"); }
    },
  };

  // -----------------------------------------------------------------------
  // CRUD principal
  // -----------------------------------------------------------------------
  const crud = new Crud({
    endpoint: "/api/produtos",
    titulo: "Produtos",
    singular: "Produto",
    subtitulo: "Peças e mercadorias com controle de estoque",
    paginado: true,
    ordemPadrao: "nome",
    modalGrande: true,
    colunas: [
      { chave: "codigo", titulo: "Código" },
      { chave: "nome", titulo: "Nome", render: (v, row) => {
          const tag = row.produto_pai_id
            ? `<span style="font-size:.7rem;background:var(--primary-light,#e8f4fd);color:var(--primary);padding:1px 6px;border-radius:99px;margin-left:4px">variação</span>`
            : "";
          return `${v}${tag}`;
        }},
      { chave: "categoria", titulo: "Categoria" },
      { chave: "preco_venda", titulo: "Venda", render: (v) => fmt.moeda(v) },
      { chave: "estoque_atual", titulo: "Estoque", render: (v, row) => {
          if (!row.produto_pai_id && row.tem_variacoes) return `<span style="color:var(--text-muted)">—</span>`;
          const critico = Number(v) <= Number(row.estoque_minimo || 0);
          const badge = `<span class="badge ${critico ? "badge--danger" : "badge--success"}">${v ?? 0}</span>`;
          const btn = `<button class="icon-btn btn--sm" title="Movimentar estoque"
            style="margin-left:4px;vertical-align:middle"
            onclick="event.stopPropagation();window.__movRapido(${row.id},'${(row.nome||'').replace(/'/g,"\\'").replace(/"/g,"&quot;")}',${v??0})">
            <i class="fa-solid fa-right-left" style="font-size:.7rem"></i>
          </button>`;
          return badge + btn;
        }},
      { chave: "_margem", titulo: "Margem", render: (v) => (v != null ? `${v}%` : "-") },
      { chave: "_grade", titulo: "Grade", render: (v, row) => {
          if (row.produto_pai_id) return "—";
          return `<button class="btn btn--sm btn--outline" onclick="event.stopPropagation();window.__grade.abrir(${row.id},'${(row.nome||'').replace(/'/g,"\\'")}')">
            <i class="fa-solid fa-layer-group"></i> Grade
          </button>`;
        }},
      { chave: "_etiqueta", titulo: "Etiqueta", render: (v, row) => {
          // Guarda os dados no map global e passa só o id — evita problema de aspas no onclick
          window.__etqCache = window.__etqCache || {};
          window.__etqCache[row.id] = {
            id: row.id, nome: row.nome, codigo: row.codigo,
            codigo_barras: row.codigo_barras || row.ean || "",
            preco_venda: row.preco_venda, localizacao: row.localizacao || "",
            marca: row.marca || "", categoria: row.categoria || "",
          };
          return `<button class="icon-btn btn--sm" title="Imprimir etiqueta"
            onclick="event.stopPropagation();window.__etiqueta.abrirPorId(${row.id})">
            <i class="fa-solid fa-tag"></i>
          </button>`;
        }},
    ],
    campos: [
      { nome: "nome", label: "Nome", obrigatorio: true, larguraTotal: true },
      { nome: "codigo", label: "Código" },
      { nome: "codigo_barras", label: "Código de barras" },
      { nome: "categoria", label: "Categoria" },
      { nome: "marca", label: "Marca" },
      { nome: "fornecedor_id", label: "Fornecedor", tipo: "select", opcoes: [["", "— nenhum —"], ...opcoesForn] },
      { nome: "localizacao", label: "Localização" },
      { nome: "preco_compra", label: "Preço de compra", tipo: "number" },
      { nome: "preco_venda", label: "Preço de venda", tipo: "number" },
      { nome: "comissao_percentual", label: "Comissão (%)", tipo: "number" },
      { nome: "estoque_atual", label: "Estoque atual", tipo: "number" },
      { nome: "estoque_minimo", label: "Estoque mínimo", tipo: "number" },
      { nome: "estoque_maximo", label: "Estoque máximo", tipo: "number" },
      { nome: "ncm", label: "NCM" },
      { nome: "cfop", label: "CFOP" },
      { nome: "cest", label: "CEST" },
      { nome: "ean", label: "EAN" },
    ],
  });
  // Movimentação rápida de estoque direto da lista de produtos
  window.__movRapido = function(prodId, prodNome, estoqueAtual) {
    Modal.abrir(
      `<i class="fa-solid fa-right-left"></i> Movimentar Estoque`,
      `<p style="color:var(--text-muted);font-size:.85rem;margin-bottom:1rem">
        <strong>${prodNome}</strong> — Estoque atual: <strong>${estoqueAtual}</strong>
      </p>
      <div class="form-grid" id="mov-rapido-form">
        <div class="field"><label>Tipo *</label>
          <select name="tipo">
            <option value="entrada">Entrada</option>
            <option value="saida">Saída</option>
            <option value="ajuste">Ajuste (definir valor absoluto)</option>
          </select>
        </div>
        <div class="field"><label>Quantidade *</label>
          <input type="number" name="quantidade" step="0.01" min="0" autofocus>
        </div>
        <div class="field col-2"><label>Documento / observação</label>
          <input name="documento" placeholder="ex: inventário, NF 123…">
        </div>
      </div>`,
      `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
       <button class="btn btn--primary" id="mov-rapido-salvar">
         <i class="fa-solid fa-check"></i> Confirmar
       </button>`
    );
    document.getElementById("mov-rapido-salvar").onclick = async () => {
      const f = document.getElementById("mov-rapido-form");
      const val = (name) => f.querySelector(`[name="${name}"]`)?.value;
      const dados = {
        produto_id: prodId,
        tipo: val("tipo"),
        quantidade: parseFloat(val("quantidade")),
        documento: val("documento") || null,
        origem: "manual",
      };
      if (!dados.quantidade || isNaN(dados.quantidade)) {
        toast("Informe a quantidade", "warning"); return;
      }
      try {
        const r = await API.post("/api/estoque/movimentar", dados);
        toast(`Estoque atualizado → ${r.saldo}`);
        Modal.fechar();
        window.__crud?.carregar();
      } catch (e) { toast(e.message, "error"); }
    };
  };

  // -----------------------------------------------------------------------
  // Impressão de Etiquetas
  // Suporta: Pimaco A4 (3 colunas × linhas), térmica 10×5cm, térmica 10×3cm
  // -----------------------------------------------------------------------
  window.__etiqueta = {
    abrirPorId(id) {
      const p = (window.__etqCache || {})[id];
      if (!p) { toast("Produto não encontrado", "error"); return; }
      this.abrir(p);
    },

    abrir(prodJson) {
      const p = typeof prodJson === "string" ? JSON.parse(prodJson) : prodJson;
      const empresa = Layout.config?.empresa_nome || "";
      // Carrega preferências salvas em Configurações
      const cfg = Layout.config || {};
      const defTipo = cfg.etiqueta_tipo || "pimaco_a4";
      const defPreco = cfg.etiqueta_mostrar_preco !== "0" ? "1" : "0";
      const defBarras = cfg.etiqueta_mostrar_barras !== "0" ? "1" : "0";
      const defLocal = cfg.etiqueta_mostrar_local !== "0" ? "1" : "0";

      Modal.abrir(
        `<i class="fa-solid fa-tag"></i> Imprimir Etiqueta — ${p.nome}`,
        `<div class="form-grid" style="grid-template-columns:1fr 1fr;gap:.75rem" id="etq-form">

          <div class="field col-2">
            <label>Tipo de etiqueta</label>
            <select id="etq-tipo">
              <option value="pimaco_a4" ${defTipo==="pimaco_a4"?"selected":""}>Pimaco A4 — 3 colunas (folha cheia)</option>
              <option value="termica_10x5" ${defTipo==="termica_10x5"?"selected":""}>Térmica 10×5 cm (Zebra/Argox/Elgin)</option>
              <option value="termica_10x3" ${defTipo==="termica_10x3"?"selected":""}>Térmica 10×3 cm (mini)</option>
            </select>
          </div>

          <div class="field">
            <label>Quantidade de etiquetas</label>
            <input type="number" id="etq-qtd" value="1" min="1" max="100">
          </div>
          <div class="field">
            <label>Mostrar preço?</label>
            <select id="etq-preco">
              <option value="1" ${defPreco==="1"?"selected":""}>Sim</option>
              <option value="0" ${defPreco==="0"?"selected":""}>Não</option>
            </select>
          </div>
          <div class="field">
            <label>Mostrar código de barras?</label>
            <select id="etq-barras">
              <option value="1" ${defBarras==="1"?"selected":""}>Sim (se disponível)</option>
              <option value="0" ${defBarras==="0"?"selected":""}>Não</option>
            </select>
          </div>
          <div class="field">
            <label>Mostrar localização?</label>
            <select id="etq-local">
              <option value="1" ${defLocal==="1"?"selected":""}>Sim</option>
              <option value="0" ${defLocal==="0"?"selected":""}>Não</option>
            </select>
          </div>

          <div class="field col-2">
            <label>Nome customizado (deixe vazio para usar o cadastrado)</label>
            <input id="etq-nome" placeholder="${p.nome}">
          </div>

        </div>
        <div id="etq-preview-wrap" style="margin-top:1rem">
          <p style="font-size:.8rem;color:var(--text-muted);margin-bottom:.5rem">Preview:</p>
          <div id="etq-preview"></div>
        </div>`,
        `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
         <button class="btn btn--primary" id="etq-imprimir">
           <i class="fa-solid fa-print"></i> Imprimir
         </button>`,
        true
      );

      // Atualiza preview ao mudar qualquer opção
      const atualizar = () => {
        const tipo = document.getElementById("etq-tipo").value;
        const mostrarPreco = document.getElementById("etq-preco").value === "1";
        const mostrarBarras = document.getElementById("etq-barras").value === "1";
        const mostrarLocal = document.getElementById("etq-local").value === "1";
        const nomeCustom = document.getElementById("etq-nome").value.trim() || p.nome;
        document.getElementById("etq-preview").innerHTML =
          this._gerarEtiquetaHtml(p, { tipo, mostrarPreco, mostrarBarras, mostrarLocal, nomeCustom, empresa, preview: true });
      };
      ["etq-tipo","etq-preco","etq-barras","etq-local","etq-nome"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("change", atualizar);
        if (el && el.tagName === "INPUT") el.addEventListener("input", atualizar);
      });
      atualizar();

      document.getElementById("etq-imprimir").onclick = () => this.imprimir(p, empresa);
    },

    _gerarEtiquetaHtml(p, opts) {
      const { tipo, mostrarPreco, mostrarBarras, mostrarLocal, nomeCustom, empresa, preview } = opts;

      // Gera SVG de código de barras simples (Code 128 visual — barras alternadas)
      const barcodeHtml = (codigo) => {
        if (!codigo) return "";
        // Representação visual simplificada (não é Code 128 real, apenas visual para etiqueta)
        const bars = codigo.split("").map((c) => c.charCodeAt(0)).join("");
        let svg = `<svg width="120" height="28" xmlns="http://www.w3.org/2000/svg">`;
        let x = 2;
        for (let i = 0; i < Math.min(bars.length, 60); i++) {
          const w = (parseInt(bars[i]) % 3) + 1;
          if (i % 2 === 0) svg += `<rect x="${x}" y="0" width="${w}" height="24" fill="#000"/>`;
          x += w + 1;
        }
        svg += `<text x="60" y="27" text-anchor="middle" font-size="7" font-family="monospace">${codigo}</text></svg>`;
        return svg;
      };

      const preco = Number(p.preco_venda || 0).toLocaleString("pt-BR", {style:"currency",currency:"BRL"});
      const cod = p.codigo_barras || p.codigo || "";

      // Ajusta tamanho da fonte do nome conforme comprimento
      const tamNome = nomeCustom.length > 35 ? "8px" : nomeCustom.length > 25 ? "9px" : "11px";
      const tamNomePimaco = nomeCustom.length > 30 ? "7px" : nomeCustom.length > 20 ? "8px" : "9px";

      if (tipo === "termica_10x5") {
        return `<div style="width:264px;height:132px;border:${preview?"1px dashed #bbb":"none"};
          padding:7px 8px;font-family:Arial,sans-serif;background:#fff;
          box-sizing:border-box;display:flex;flex-direction:column;gap:3px">
          ${empresa ? `<div style="font-size:7px;color:#aaa;text-align:center;letter-spacing:.5px;text-transform:uppercase">${empresa}</div>` : ""}
          <div style="font-weight:700;font-size:${tamNome};line-height:1.3;text-align:center;flex:1;
            display:flex;align-items:center;justify-content:center;word-break:break-word;
            max-height:42px;overflow:hidden">${nomeCustom}</div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div style="font-size:7.5px;color:#555">
              ${p.codigo ? `<span>Cód: <strong>${p.codigo}</strong></span>` : ""}
              ${mostrarLocal && p.localizacao ? `<span style="margin-left:6px;color:#888">| ${p.localizacao}</span>` : ""}
            </div>
            ${mostrarPreco ? `<div style="font-size:15px;font-weight:900;color:#0d9488;letter-spacing:-.5px">${preco}</div>` : ""}
          </div>
          ${mostrarBarras && cod ? `<div style="text-align:center;margin-top:2px">${barcodeHtml(cod)}</div>` : ""}
        </div>`;
      }

      if (tipo === "termica_10x3") {
        return `<div style="width:264px;height:79px;border:${preview?"1px dashed #bbb":"none"};
          padding:5px 8px;font-family:Arial,sans-serif;background:#fff;
          box-sizing:border-box;display:flex;flex-direction:column;gap:2px">
          ${empresa ? `<div style="font-size:6px;color:#aaa;text-align:center;text-transform:uppercase">${empresa}</div>` : ""}
          <div style="font-weight:700;font-size:${tamNome};line-height:1.2;text-align:center;
            overflow:hidden;max-height:28px;word-break:break-word">${nomeCustom}</div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div style="font-size:7px;color:#555">
              ${p.codigo ? `Cód: <strong>${p.codigo}</strong>` : ""}
              ${mostrarLocal && p.localizacao ? `<span style="color:#888"> | ${p.localizacao}</span>` : ""}
            </div>
            ${mostrarPreco ? `<div style="font-size:13px;font-weight:900;color:#0d9488">${preco}</div>` : ""}
          </div>
          ${mostrarBarras && cod ? `<div style="text-align:center">${barcodeHtml(cod)}</div>` : ""}
        </div>`;
      }

      // Pimaco A4 — 66×38mm por etiqueta
      return `<div style="width:186px;height:107px;border:${preview?"1px dashed #bbb":"none"};
        padding:6px 7px;font-family:Arial,sans-serif;background:#fff;
        box-sizing:border-box;display:flex;flex-direction:column;gap:2px">
        ${empresa ? `<div style="font-size:6px;color:#aaa;text-align:center;text-transform:uppercase;letter-spacing:.4px">${empresa}</div>` : ""}
        <div style="font-weight:700;font-size:${tamNomePimaco};line-height:1.3;text-align:center;
          flex:1;display:flex;align-items:center;justify-content:center;
          word-break:break-word;overflow:hidden;max-height:36px">${nomeCustom}</div>
        <div style="display:flex;justify-content:space-between;align-items:flex-end">
          <div style="font-size:7px;color:#555;line-height:1.5">
            ${p.codigo ? `<div>Cód: <strong>${p.codigo}</strong></div>` : ""}
            ${mostrarLocal && p.localizacao ? `<div style="color:#888">${p.localizacao}</div>` : ""}
          </div>
          ${mostrarPreco ? `<div style="font-size:14px;font-weight:900;color:#0d9488;letter-spacing:-.5px">${preco}</div>` : ""}
        </div>
        ${mostrarBarras && cod ? `<div style="text-align:center;margin-top:1px">${barcodeHtml(cod)}</div>` : ""}
      </div>`;
    },

    imprimir(p, empresa) {
      const tipo = document.getElementById("etq-tipo").value;
      const qtd = Math.max(1, Math.min(100, parseInt(document.getElementById("etq-qtd").value) || 1));
      const mostrarPreco = document.getElementById("etq-preco").value === "1";
      const mostrarBarras = document.getElementById("etq-barras").value === "1";
      const mostrarLocal = document.getElementById("etq-local").value === "1";
      const nomeCustom = document.getElementById("etq-nome").value.trim() || p.nome;
      const opts = { tipo, mostrarPreco, mostrarBarras, mostrarLocal, nomeCustom, empresa, preview: false };

      const etiquetaHtml = this._gerarEtiquetaHtml(p, opts);
      const etiquetas = Array(qtd).fill(etiquetaHtml).join("");

      let paginaHtml;
      if (tipo === "pimaco_a4") {
        // Grade 3 colunas × N linhas — Pimaco 6182 (66×38mm)
        paginaHtml = `<div style="display:grid;grid-template-columns:repeat(3,1fr);
          gap:3mm;padding:10mm;width:210mm;box-sizing:border-box">${etiquetas}</div>`;
      } else {
        // Térmica: cada etiqueta em página separada ou contínua
        paginaHtml = `<div style="display:flex;flex-direction:column;gap:2mm;padding:2mm">
          ${etiquetas}</div>`;
      }

      const css = tipo === "termica_10x5"
        ? "@page{size:100mm 50mm;margin:0}"
        : tipo === "termica_10x3"
        ? "@page{size:100mm 30mm;margin:0}"
        : "@page{size:A4;margin:0}";

      const w = window.open("", "_blank");
      w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
        <title>Etiquetas — ${p.nome}</title>
        <style>
          ${css}
          body{margin:0;padding:0;font-family:Arial,sans-serif;background:#fff}
          @media print{body{margin:0}}
        </style>
      </head><body>${paginaHtml}</body></html>`);
      w.document.close();
      w.onload = () => { w.focus(); w.print(); };
      Modal.fechar();
    },
  };

  crud.montar();
})();
