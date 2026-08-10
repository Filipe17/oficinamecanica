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

  // Só-leitura quando o nível do perfil no módulo "veiculos" for < 2 (completo).
  const somenteLeitura = (Layout.permissoes?.veiculos ?? 2) < 2;

  const crud = new Crud({
    endpoint: "/api/veiculos",
    titulo: "Veículos",
    singular: "Veículo",
    subtitulo: "Frota dos clientes e histórico de manutenções",
    somenteLeitura,
    paginado: true,
    ordemPadrao: "modelo",
    modalGrande: true,
    colunas: [
      { chave: "placa", titulo: "Placa", render: (v) => `<b>${v || "-"}</b>` },
      { chave: "marca", titulo: "Marca" },
      { chave: "modelo", titulo: "Modelo" },
      { chave: "ano", titulo: "Ano" },
      { chave: "cliente_nome", titulo: "Cliente" },
      { chave: "_historico", titulo: "Histórico", render: (v, row) =>
          `<button class="btn btn--sm btn--outline" title="Ver histórico completo"
            onclick="event.stopPropagation();window.__veicHist.abrir(${row.id},'${(row.marca||'')} ${(row.modelo||'')} ${(row.placa||'')}')">
            <i class="fa-solid fa-timeline"></i> Histórico
          </button>` },
    ],
    campos: [
      { nome: "cliente_id", label: "Cliente", tipo: "select", opcoes: [["", "— selecione —"], ...opcoesClientes], obrigatorio: true, larguraTotal: true },
      { nome: "marca", label: "Marca", datalist: true, placeholder: "Selecione ou digite" },
      { nome: "modelo", label: "Modelo", datalist: true, placeholder: "Selecione a marca primeiro" },
      { nome: "ano", label: "Ano" },
      { nome: "placa", label: "Placa" },
      { nome: "cor", label: "Cor" },
      { nome: "motor", label: "Motor" },
      { nome: "combustivel", label: "Combustível", tipo: "select", opcoes: ["", "Gasolina", "Etanol", "Etanol/Gasolina", "Flex", "Diesel", "GNV", "Elétrico", "Híbrido"] },
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
  // -----------------------------------------------------------------------
  // Histórico completo do veículo
  // -----------------------------------------------------------------------
  window.__veicHist = {
    async abrir(vid, nome) {
      Modal.abrir(
        `<i class="fa-solid fa-timeline"></i> Histórico — ${nome.trim()}`,
        `<div id="hist-body"><div class="loading"><i class="fa-solid fa-spinner spin"></i> Carregando…</div></div>`,
        `<button class="btn btn--ghost" onclick="Modal.fechar()">Fechar</button>
         <button class="btn btn--outline" onclick="window.__veicHist.imprimir()">
           <i class="fa-solid fa-print"></i> Imprimir
         </button>`,
        true
      );

      try {
        const r = await API.get(`/api/veiculos/${vid}/historico`);
        window.__veicHist._dados = r;
        this._renderizar(r);
      } catch(e) {
        document.getElementById("hist-body").innerHTML =
          `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
      }
    },

    _renderizar(r) {
      const { veiculo, os_list, stats, evolucao_km } = r;
      const STATUS_COR = {
        aberta: "#3b82f6", em_analise: "#8b5cf6", aguardando_aprovacao: "#f59e0b",
        aguardando_pecas: "#ef4444", em_execucao: "#0d9488",
        finalizada_mecanico: "#10b981", finalizada: "#22c55e", cancelada: "#94a3b8",
      };
      const STATUS_LABEL = {
        aberta: "Aberta", em_analise: "Em Análise", aguardando_aprovacao: "Aguard. Aprovação",
        aguardando_pecas: "Aguard. Peças", em_execucao: "Em Execução",
        finalizada_mecanico: "Finaliz. Mecânico", finalizada: "Finalizada", cancelada: "Cancelada",
      };

      // Cards de resumo
      const resumo = `
        <div style="display:flex;gap:.75rem;flex-wrap:wrap;margin-bottom:1.5rem">
          <div class="stat-mini"><span>${stats.total_os}</span><label>OS realizadas</label></div>
          <div class="stat-mini"><span>${fmt.moeda(stats.total_gasto)}</span><label>Total gasto</label></div>
          <div class="stat-mini"><span>${stats.total_pecas}</span><label>Peças trocadas</label></div>
          <div class="stat-mini"><span>${stats.total_servicos}</span><label>Serviços</label></div>
          ${veiculo.quilometragem ? `<div class="stat-mini"><span>${Number(veiculo.quilometragem).toLocaleString("pt-BR")} km</span><label>KM atual</label></div>` : ""}
        </div>`;

      if (!os_list.length) {
        document.getElementById("hist-body").innerHTML = resumo +
          `<div class="empty"><i class="fa-solid fa-inbox"></i>Nenhuma OS registrada para este veículo</div>`;
        return;
      }

      // Timeline
      const timeline = os_list.map((os) => {
        const cor = STATUS_COR[os.status] || "#888";
        const label = STATUS_LABEL[os.status] || os.status;
        const pecas = os.pecas?.map((p) =>
          `<li style="font-size:.8rem"><i class="fa-solid fa-wrench" style="color:#888;margin-right:4px"></i>${p.descricao}${p.quantidade > 1 ? ` (${p.quantidade}x)` : ""}</li>`
        ).join("") || "";
        const servs = os.servicos_realizados?.map((s) =>
          `<li style="font-size:.8rem"><i class="fa-solid fa-screwdriver-wrench" style="color:#0d9488;margin-right:4px"></i>${s.descricao}</li>`
        ).join("") || "";

        return `
          <div style="display:flex;gap:1rem;margin-bottom:1.5rem">
            <!-- Linha do tempo -->
            <div style="display:flex;flex-direction:column;align-items:center;flex:0 0 auto">
              <div style="width:14px;height:14px;border-radius:50%;background:${cor};border:2px solid #fff;
                box-shadow:0 0 0 2px ${cor};margin-top:4px;flex-shrink:0"></div>
              <div style="width:2px;background:#e5e7eb;flex:1;margin-top:4px"></div>
            </div>
            <!-- Card da OS -->
            <div style="flex:1;background:#fff;border:1px solid #e5e7eb;border-radius:10px;
              padding:.85rem 1rem;margin-bottom:.25rem;box-shadow:0 1px 3px rgba(0,0,0,.06)">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:.4rem;margin-bottom:.5rem">
                <div>
                  <strong style="font-size:.9rem">OS ${os.numero || os.id}</strong>
                  <span style="font-size:.75rem;padding:2px 8px;border-radius:99px;
                    background:${cor}20;color:${cor};font-weight:600;margin-left:6px">${label}</span>
                </div>
                <div style="text-align:right;font-size:.8rem;color:var(--text-muted)">
                  <div>${fmt.data(os.data)}</div>
                  ${os.quilometragem ? `<div><i class="fa-solid fa-gauge-high"></i> ${Number(os.quilometragem).toLocaleString("pt-BR")} km</div>` : ""}
                  ${os.mecanico_nome ? `<div><i class="fa-solid fa-user-gear"></i> ${os.mecanico_nome}</div>` : ""}
                </div>
              </div>
              ${os.problema ? `<p style="font-size:.82rem;color:#555;margin-bottom:.4rem"><strong>Problema:</strong> ${os.problema}</p>` : ""}
              ${os.diagnostico ? `<p style="font-size:.82rem;color:#555;margin-bottom:.4rem"><strong>Diagnóstico:</strong> ${os.diagnostico}</p>` : ""}
              ${pecas || servs ? `
                <div style="display:flex;gap:1.5rem;flex-wrap:wrap;margin-top:.5rem">
                  ${pecas ? `<div><div style="font-size:.75rem;font-weight:700;color:var(--text-muted);margin-bottom:2px">PEÇAS</div><ul style="margin:0;padding-left:16px">${pecas}</ul></div>` : ""}
                  ${servs ? `<div><div style="font-size:.75rem;font-weight:700;color:var(--text-muted);margin-bottom:2px">SERVIÇOS</div><ul style="margin:0;padding-left:16px">${servs}</ul></div>` : ""}
                </div>` : ""}
              ${os.total ? `<div style="text-align:right;margin-top:.5rem;font-weight:700;color:var(--primary)">${fmt.moeda(os.total)}</div>` : ""}
            </div>
          </div>`;
      }).join("");

      document.getElementById("hist-body").innerHTML = resumo +
        `<div style="background:var(--bg-alt,#f8f9fa);border-radius:10px;padding:1rem">${timeline}</div>`;
    },

    imprimir() {
      const r = this._dados;
      if (!r) return;
      const { veiculo, os_list, stats } = r;
      const hoje = new Date().toLocaleDateString("pt-BR");
      const cfg = Layout.config || {};
      const empresa = cfg.empresa_nome || "Oficina";

      const linhas = os_list.map((os) => {
        const pecas = os.pecas?.map((p) => `${p.descricao}${p.quantidade>1?` (${p.quantidade}x)`:""}`).join(", ") || "—";
        const servs = os.servicos_realizados?.map((s) => s.descricao).join(", ") || "—";
        return `<tr>
          <td style="padding:6px 8px">${os.numero || os.id}</td>
          <td style="padding:6px 8px">${os.data ? new Date(os.data+"T00:00").toLocaleDateString("pt-BR") : "—"}</td>
          <td style="padding:6px 8px">${os.status}</td>
          <td style="padding:6px 8px">${os.quilometragem ? Number(os.quilometragem).toLocaleString("pt-BR")+" km" : "—"}</td>
          <td style="padding:6px 8px;font-size:11px">${servs}</td>
          <td style="padding:6px 8px;font-size:11px">${pecas}</td>
          <td style="padding:6px 8px;text-align:right">R$ ${Number(os.total||0).toFixed(2)}</td>
        </tr>`;
      }).join("");

      const w = window.open("", "_blank");
      w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
        <title>Histórico — ${veiculo.placa}</title>
        <style>
          body{font-family:Arial,sans-serif;font-size:12px;padding:20px;color:#222}
          h1{font-size:16px;margin:0} h2{font-size:12px;color:#555;font-weight:normal;margin:2px 0 16px}
          table{width:100%;border-collapse:collapse;margin-top:12px}
          th{background:#0d9488;color:#fff;padding:7px 8px;text-align:left;font-size:11px}
          td{border-bottom:1px solid #eee}
          tr:nth-child(even) td{background:#f9f9f9}
          .resumo{display:flex;gap:24px;margin:12px 0;padding:10px;background:#f9f9f9;border-radius:6px}
          .resumo div{text-align:center} .resumo strong{display:block;font-size:16px}
          .resumo small{font-size:10px;color:#888}
          @media print{body{padding:0}}
        </style>
      </head><body>
        <h1>Histórico do Veículo</h1>
        <h2>${empresa} — ${veiculo.marca} ${veiculo.modelo} ${veiculo.ano} — Placa: ${veiculo.placa} — ${hoje}</h2>
        <div class="resumo">
          <div><strong>${stats.total_os}</strong><small>OS realizadas</small></div>
          <div><strong>R$ ${Number(stats.total_gasto).toFixed(2)}</strong><small>Total gasto</small></div>
          <div><strong>${stats.total_pecas}</strong><small>Peças trocadas</small></div>
          <div><strong>${stats.total_servicos}</strong><small>Serviços</small></div>
          ${veiculo.quilometragem ? `<div><strong>${Number(veiculo.quilometragem).toLocaleString("pt-BR")} km</strong><small>KM atual</small></div>` : ""}
        </div>
        <table>
          <thead><tr>
            <th>OS</th><th>Data</th><th>Status</th><th>KM</th>
            <th>Serviços</th><th>Peças</th><th style="text-align:right">Valor</th>
          </tr></thead>
          <tbody>${linhas}</tbody>
          <tfoot><tr style="font-weight:700;border-top:2px solid #0d9488">
            <td colspan="6" style="padding:6px 8px">Total</td>
            <td style="padding:6px 8px;text-align:right">R$ ${Number(stats.total_gasto).toFixed(2)}</td>
          </tr></tfoot>
        </table>
        <p style="font-size:9px;color:#aaa;margin-top:16px;text-align:center">DevSystem PRIME — ${hoje}</p>
      </body></html>`);
      w.document.close();
      w.onload = () => w.print();
    },
  };

  crud.montar();
})();
