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
      if (!confirm("Excluir esta variação?")) return;
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

  crud.montar();
})();
