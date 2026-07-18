/* =======================================================================
   veiculos.js — Página de Veículos (Crud genérico)
   -----------------------------------------------------------------------
   - Campo Cliente: <select> preenchido com os clientes cadastrados.
   - Campos Marca e Modelo: listas suspensas alimentadas pela Tabela FIPE
     (API pública Parallelum v1). Ao escolher a marca, os modelos daquela
     marca são carregados no campo Modelo. Os campos também aceitam digitação
     livre — assim, veículos antigos/raros fora da FIPE ainda podem ser
     cadastrados normalmente.
   ======================================================================= */
(async () => {
  await Layout.iniciar("veiculos", "Veículos");

  // Clientes para o <select> de dono do veículo
  let opcoesClientes = [];
  try {
    const r = await API.get("/api/clientes?por_pagina=1000&ordem=nome");
    opcoesClientes = (r.dados || []).map((c) => [c.id, c.nome]);
  } catch (_) {}

  // ---- FIPE (marcas/modelos de carros) --------------------------------
  const FIPE = "https://parallelum.com.br/fipe/api/v1/carros";
  let marcasFipe = [];   // cache: [{ codigo, nome }]

  async function carregarMarcas() {
    if (marcasFipe.length) return marcasFipe;
    const r = await fetch(`${FIPE}/marcas`);
    marcasFipe = await r.json();
    return marcasFipe;
  }
  async function carregarModelos(codigoMarca) {
    const r = await fetch(`${FIPE}/marcas/${codigoMarca}/modelos`);
    const d = await r.json();
    return d.modelos || [];
  }
  function preencherDatalist(id, itens) {
    const dl = document.getElementById(id);
    if (dl) dl.innerHTML = itens.map((i) => `<option value="${i.nome}">`).join("");
  }

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
      { nome: "marca", label: "Marca", datalist: true, placeholder: "Selecione ou digite" },
      { nome: "modelo", label: "Modelo", datalist: true, placeholder: "Selecione a marca primeiro" },
      { nome: "ano", label: "Ano" },
      { nome: "placa", label: "Placa" },
      { nome: "cor", label: "Cor" },
      { nome: "motor", label: "Motor" },
      { nome: "combustivel", label: "Combustível", tipo: "select", opcoes: ["", "Gasolina", "Etanol", "Flex", "Diesel", "GNV", "Elétrico", "Híbrido"] },
      { nome: "renavam", label: "RENAVAM" },
      { nome: "chassi", label: "Chassi" },
      { nome: "quilometragem", label: "Quilometragem", tipo: "number" },
    ],

    // Liga marca/modelo à FIPE quando o formulário abre.
    aoAbrirForm: async (registro) => {
      const form = document.getElementById("crud-form");
      const marcaInput = form.querySelector('[name="marca"]');
      const modeloInput = form.querySelector('[name="modelo"]');

      let lista;
      try {
        lista = await carregarMarcas();
      } catch (_) {
        // Sem internet / FIPE fora do ar: campos seguem como texto livre.
        return;
      }
      preencherDatalist("dl-marca", lista);

      const carregarModelosDaMarca = async (nomeMarca) => {
        const m = lista.find((x) => x.nome.toLowerCase() === (nomeMarca || "").toLowerCase());
        if (!m) { preencherDatalist("dl-modelo", []); return; }
        try { preencherDatalist("dl-modelo", await carregarModelos(m.codigo)); }
        catch (_) { preencherDatalist("dl-modelo", []); }
      };

      // Edição: se já houver marca salva, carrega os modelos dela.
      if (marcaInput.value) carregarModelosDaMarca(marcaInput.value);

      // Ao trocar a marca, recarrega os modelos e limpa o modelo anterior.
      marcaInput.addEventListener("change", () => {
        modeloInput.value = "";
        carregarModelosDaMarca(marcaInput.value);
      });
    },
  });
  crud.montar();
})();
