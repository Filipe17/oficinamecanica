/* =======================================================================
   servicos.js — Página de Serviços (Crud genérico)
   ======================================================================= */
(async () => {
  await Layout.iniciar("servicos", "Serviços");

  const crud = new Crud({
    endpoint: "/api/servicos",
    titulo: "Serviços",
    singular: "Serviço",
    subtitulo: "Mão de obra e serviços oferecidos pela oficina",
    paginado: false,
    modalGrande: true,
    colunas: [
      { chave: "descricao", titulo: "Descrição" },
      { chave: "categoria", titulo: "Categoria" },
      { chave: "tempo_medio", titulo: "Tempo médio" },
      { chave: "valor", titulo: "Valor", render: (v) => fmt.moeda(v) },
      { chave: "garantia", titulo: "Garantia" },
    ],
    campos: [
      { nome: "descricao", label: "Descrição", obrigatorio: true, larguraTotal: true },
      { nome: "categoria", label: "Categoria" },
      { nome: "tempo_medio", label: "Tempo médio (ex: 1h30)" },
      { nome: "valor", label: "Valor", tipo: "number" },
      { nome: "garantia", label: "Garantia (ex: 90 dias)" },
    ],
  });
  crud.montar();
})();
