/* =======================================================================
   clientes.js — Página de Clientes (usa o componente genérico Crud)
   ======================================================================= */
(async () => {
  await Layout.iniciar("clientes", "Clientes");

  // Só-leitura quando o nível do perfil no módulo "clientes" for < 2 (completo).
  const somenteLeitura = (Layout.permissoes?.clientes ?? 2) < 2;

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
      { chave: "limite_credito", titulo: "Limite / Saldo", render: (v, row) => {
          const limite = Number(v || 0);
          if (!limite) return `<span style="color:var(--text-muted);font-size:.8rem">—</span>`;
          const saldo = Number(row.saldo_devedor || 0);
          const pct = Math.min(Math.round(saldo / limite * 100), 100);
          const cor = pct >= 100 ? "#e74c3c" : pct >= 80 ? "#e67e22" : "#27ae60";
          const label = pct >= 100
            ? `<span style="color:#e74c3c;font-weight:700">Limite atingido</span>`
            : pct >= 80
            ? `<span style="color:#e67e22">⚠ ${pct}% usado</span>`
            : `<span style="color:#27ae60">${fmt.moeda(limite - saldo)} disponível</span>`;
          return `<div style="font-size:.8rem">
            <div>${fmt.moeda(saldo)} / ${fmt.moeda(limite)}</div>
            <div style="background:#eee;border-radius:4px;height:4px;margin-top:2px;width:80px">
              <div style="background:${cor};width:${pct}%;height:4px;border-radius:4px"></div>
            </div>
            <div style="margin-top:1px">${label}</div>
          </div>`;
        }},
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
      { nome: "data_nascimento", label: "Data de Nascimento", tipo: "date" },
      { nome: "limite_credito", label: "Limite de Crédito (R$)", tipo: "number", placeholder: "0 = sem limite" },
      { nome: "observacoes", label: "Observações", tipo: "textarea", larguraTotal: true },
    ],
  });
  crud.montar();
})();
