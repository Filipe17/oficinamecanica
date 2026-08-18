/* =======================================================================
   fornecedores.js — Cadastro completo de Fornecedores
   ======================================================================= */
(async () => {
  await Layout.iniciar("fornecedores", "Fornecedores");

  const crud = new Crud({
    endpoint: "/api/fornecedores",
    titulo: "Fornecedores",
    singular: "Fornecedor",
    subtitulo: "Cadastro de fornecedores de peças e materiais",
    paginado: false,
    ordemPadrao: "nome",
    modalGrande: true,
    colunas: [
      { chave: "nome", titulo: "Razão Social" },
      { chave: "nome_fantasia", titulo: "Fantasia", render: (v) => v || "—" },
      { chave: "cnpj", titulo: "CNPJ", render: (v) => v || "—" },
      { chave: "cidade", titulo: "Cidade", render: (v, row) =>
          v ? `${v}${row.estado ? "/" + row.estado : ""}` : "—" },
      { chave: "telefone", titulo: "Telefone", render: (v) => v || "—" },
      { chave: "contato", titulo: "Contato", render: (v) => v || "—" },
      { chave: "qtd_produtos", titulo: "Produtos", render: (v) =>
          `<span class="badge badge--success">${v ?? 0}</span>` },
    ],
    campos: [
      // Identificação
      { nome: "nome",          label: "Razão Social *", obrigatorio: true, larguraTotal: true },
      { nome: "nome_fantasia", label: "Nome Fantasia" },
      { nome: "cnpj",          label: "CNPJ", mascara: "cpf_cnpj" },
      { nome: "ie",            label: "Inscrição Estadual" },
      // Contato
      { nome: "contato",       label: "Nome do Contato/Vendedor" },
      { nome: "telefone",      label: "Telefone", mascara: "telefone" },
      { nome: "telefone2",     label: "Telefone 2", mascara: "telefone" },
      { nome: "email",         label: "E-mail", tipo: "email" },
      { nome: "site",          label: "Site" },
      // Endereço
      { nome: "cep",           label: "CEP", mascara: "cep", cep: true },
      { nome: "endereco",      label: "Endereço" },
      { nome: "numero",        label: "Número" },
      { nome: "bairro",        label: "Bairro" },
      { nome: "cidade",        label: "Cidade" },
      { nome: "estado",        label: "Estado" },
      // Comercial
      { nome: "prazo_pagamento", label: "Prazo de Pagamento", placeholder: "ex: 30/60/90 dias" },
      { nome: "observacoes",   label: "Observações", tipo: "textarea", larguraTotal: true },
    ],
  });
  window.__recarregar = () => crud.carregar();
  crud.montar();
})();
