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
      { chave: "valor", titulo: "Valor", render: (v) => fmt.moeda(v) },
      { chave: "garantia", titulo: "Garantia" },
    ],
    campos: [
      { nome: "descricao", label: "Descrição", obrigatorio: true, larguraTotal: true },
      { nome: "valor", label: "Valor", tipo: "number" },
      { nome: "garantia", label: "Garantia (ex: 90 dias)" },
      { nome: "codigo_servico", label: "Código do serviço (NFS-e / lista municipal)" },
      { nome: "iss_percentual", label: "ISS (%)", tipo: "number" },
    ],
  });
  crud.montar();
})();
