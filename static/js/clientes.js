/* =======================================================================
   clientes.js — Página de Clientes (usa o componente genérico Crud)
   ======================================================================= */
(async () => {
  await Layout.iniciar("clientes", "Clientes");

  // Mecânico só visualiza clientes (sem criar/editar/excluir).
  const somenteLeitura = Layout.usuario?.perfil === "mecanico";

  const crud = new Crud({
    endpoint: "/api/clientes",
    titulo: "Clientes",
    singular: "Cliente",
    subtitulo: "Cadastro de pessoas físicas e jurídicas",
    somenteLeitura,
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
      { nome: "cpf_cnpj", label: "CPF / CNPJ", mascara: "cpf_cnpj", placeholder: "000.000.000-00" },
      { nome: "telefone", label: "Telefone", mascara: "telefone", placeholder: "(00) 0000-0000" },
      { nome: "whatsapp", label: "WhatsApp", mascara: "telefone", placeholder: "(00) 00000-0000" },
      { nome: "email", label: "E-mail", tipo: "email" },
      { nome: "cep", label: "CEP", cep: true, placeholder: "00000-000" },
      { nome: "endereco", label: "Endereço", larguraTotal: true },
      { nome: "numero", label: "Número" },
      { nome: "bairro", label: "Bairro" },
      { nome: "cidade", label: "Cidade" },
      { nome: "estado", label: "Estado (UF)" },
      { nome: "observacoes", label: "Observações", tipo: "textarea", larguraTotal: true },
    ],
  });
  crud.montar();
})();
