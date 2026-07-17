/* =======================================================================
   clientes.js — Página de Clientes (usa o componente genérico Crud)
   ======================================================================= */
(async () => {
  await Layout.iniciar("clientes", "Clientes");

  const crud = new Crud({
    endpoint: "/api/clientes",
    titulo: "Clientes",
    singular: "Cliente",
    subtitulo: "Cadastro de pessoas físicas e jurídicas",
    paginado: true,
    ordemPadrao: "nome",
    modalGrande: true,
    colunas: [
      { chave: "nome", titulo: "Nome" },
      { chave: "cpf_cnpj", titulo: "CPF/CNPJ" },
      { chave: "telefone", titulo: "Telefone" },
      { chave: "cidade", titulo: "Cidade" },
      { chave: "estado", titulo: "UF" },
    ],
    campos: [
      { nome: "nome", label: "Nome / Razão Social", obrigatorio: true, larguraTotal: true },
      { nome: "tipo", label: "Tipo", tipo: "select", opcoes: [["PF", "Pessoa Física"], ["PJ", "Pessoa Jurídica"]] },
      { nome: "cpf_cnpj", label: "CPF / CNPJ" },
      { nome: "telefone", label: "Telefone" },
      { nome: "whatsapp", label: "WhatsApp" },
      { nome: "email", label: "E-mail", tipo: "email" },
      { nome: "cep", label: "CEP" },
      { nome: "endereco", label: "Endereço", larguraTotal: true },
      { nome: "cidade", label: "Cidade" },
      { nome: "estado", label: "Estado (UF)" },
      { nome: "observacoes", label: "Observações", tipo: "textarea", larguraTotal: true },
    ],
  });
  crud.montar();
})();
