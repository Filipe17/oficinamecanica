/* =======================================================================
   produtos.js — Página de Produtos (Crud genérico)
   ======================================================================= */
(async () => {
  await Layout.iniciar("produtos", "Produtos");

  // Fornecedores para o <select>
  let opcoesForn = [];
  try {
    const r = await API.get("/api/fornecedores");
    opcoesForn = (r.dados || r || []).map((f) => [f.id, f.nome]);
  } catch (_) {}

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
      { chave: "nome", titulo: "Nome" },
      { chave: "categoria", titulo: "Categoria" },
      { chave: "preco_venda", titulo: "Venda", render: (v) => fmt.moeda(v) },
      { chave: "estoque_atual", titulo: "Estoque", render: (v, row) => {
          const critico = Number(v) <= Number(row.estoque_minimo || 0);
          return `<span class="badge ${critico ? "badge--danger" : "badge--success"}">${v ?? 0}</span>`;
        } },
      { chave: "_margem", titulo: "Margem", render: (v) => (v != null ? `${v}%` : "-") },
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
      { nome: "estoque_atual", label: "Estoque atual", tipo: "number" },
      { nome: "estoque_minimo", label: "Estoque mínimo", tipo: "number" },
      { nome: "estoque_maximo", label: "Estoque máximo", tipo: "number" },
      { nome: "ncm", label: "NCM" },
      { nome: "cfop", label: "CFOP" },
      { nome: "cest", label: "CEST" },
      { nome: "ean", label: "EAN" },
    ],
  });
  crud.montar();
})();
