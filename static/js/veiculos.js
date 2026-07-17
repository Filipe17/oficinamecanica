/* =======================================================================
   veiculos.js — Página de Veículos (Crud genérico)
   Carrega a lista de clientes antes, para preencher o <select> de dono.
   ======================================================================= */
(async () => {
  await Layout.iniciar("veiculos", "Veículos");

  // Busca clientes para o campo "cliente" (dono do veículo).
  let opcoesClientes = [];
  try {
    const r = await API.get("/api/clientes?por_pagina=1000&ordem=nome");
    opcoesClientes = (r.dados || []).map((c) => [c.id, c.nome]);
  } catch (_) { /* segue com lista vazia */ }

  const crud = new Crud({
    endpoint: "/api/veiculos",
    titulo: "Veículos",
    singular: "Veículo",
    subtitulo: "Frota dos clientes e histórico de manutenções",
    paginado: true,
    ordemPadrao: "modelo",
    modalGrande: true,
    colunas: [
      { chave: "placa", titulo: "Placa", render: (v) => `<b>${v || "-"}</b>` },
      { chave: "marca", titulo: "Marca" },
      { chave: "modelo", titulo: "Modelo" },
      { chave: "ano", titulo: "Ano" },
      { chave: "cliente_nome", titulo: "Cliente" },
    ],
    campos: [
      { nome: "cliente_id", label: "Cliente", tipo: "select", opcoes: [["", "— selecione —"], ...opcoesClientes], obrigatorio: true, larguraTotal: true },
      { nome: "marca", label: "Marca" },
      { nome: "modelo", label: "Modelo" },
      { nome: "ano", label: "Ano" },
      { nome: "placa", label: "Placa" },
      { nome: "cor", label: "Cor" },
      { nome: "motor", label: "Motor" },
      { nome: "combustivel", label: "Combustível", tipo: "select", opcoes: ["", "Gasolina", "Etanol", "Flex", "Diesel", "GNV", "Elétrico", "Híbrido"] },
      { nome: "renavam", label: "RENAVAM" },
      { nome: "chassi", label: "Chassi" },
      { nome: "quilometragem", label: "Quilometragem", tipo: "number" },
    ],
  });
  crud.montar();
})();
