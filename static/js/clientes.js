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
      { chave: "_comunicacoes", titulo: "Histórico", render: (v, row) =>
          `<button class="icon-btn btn--sm" title="Histórico de comunicações"
            onclick="event.stopPropagation();window.__com.abrir(${row.id},'${(row.nome||'').replace(/'/g,"\'")}')">
            <i class="fa-solid fa-comments"></i>
          </button>` },
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
  // -----------------------------------------------------------------------
  // Histórico de Comunicações
  // -----------------------------------------------------------------------
  const CANAL_ICONE = {
    ligacao:  { icon: "fa-phone",        cor: "#3b82f6", label: "Ligação" },
    whatsapp: { icon: "fa-brands fa-whatsapp", cor: "#25d366", label: "WhatsApp" },
    email:    { icon: "fa-envelope",     cor: "#0d9488", label: "Email" },
    visita:   { icon: "fa-person-walking", cor: "#8b5cf6", label: "Visita" },
    outro:    { icon: "fa-note-sticky",  cor: "#94a3b8", label: "Outro" },
  };

  window.__com = {
    async abrir(clienteId, clienteNome) {
      Modal.abrir(
        `<i class="fa-solid fa-comments"></i> Comunicações — ${clienteNome}`,
        `<div id="com-body"><div class="loading"><i class="fa-solid fa-spinner spin"></i></div></div>`,
        `<button class="btn btn--ghost" onclick="Modal.fechar()">Fechar</button>
         <button class="btn btn--primary" id="com-add-btn">
           <i class="fa-solid fa-plus"></i> Registrar contato
         </button>`,
        true
      );
      await this._carregar(clienteId);

      document.getElementById("com-add-btn").onclick = () =>
        this._abrirForm(clienteId);
    },

    async _carregar(clienteId) {
      const alvo = document.getElementById("com-body");
      if (!alvo) return;
      try {
        const r = await API.get(`/api/clientes/${clienteId}/comunicacoes`);
        const lista = r.dados || [];
        if (!lista.length) {
          alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-comments"></i>
            Nenhuma comunicação registrada ainda</div>`;
          return;
        }
        alvo.innerHTML = `
          <p style="font-size:.82rem;color:var(--text-muted);margin-bottom:.75rem">
            ${lista.length} registro(s) de comunicação
          </p>
          <div style="display:flex;flex-direction:column;gap:.6rem">
            ${lista.map((c) => {
              const cfg = CANAL_ICONE[c.canal] || CANAL_ICONE.outro;
              return `<div style="display:flex;gap:.75rem;align-items:flex-start;
                padding:.75rem;background:var(--bg-alt,#f8f9fa);border-radius:8px;
                border-left:3px solid ${cfg.cor}">
                <i class="fa-solid ${cfg.icon}" style="color:${cfg.cor};margin-top:2px;font-size:1rem;flex-shrink:0"></i>
                <div style="flex:1">
                  <div style="display:flex;justify-content:space-between;align-items:flex-start">
                    <strong style="font-size:.85rem">${cfg.label}${c.assunto ? ` — ${c.assunto}` : ""}</strong>
                    <button class="icon-btn btn--sm" onclick="window.__com._excluir(${c.id},${clienteId})"
                      style="flex-shrink:0">
                      <i class="fa-solid fa-trash" style="font-size:.7rem"></i>
                    </button>
                  </div>
                  <div style="font-size:.82rem;color:#555;margin:.2rem 0">${c.descricao}</div>
                  <div style="font-size:.75rem;color:var(--text-muted)">
                    ${fmt.dataHora(c.criado_em)} · ${c.usuario_nome || "sistema"}
                  </div>
                </div>
              </div>`;
            }).join("")}
          </div>`;
      } catch(e) {
        if (alvo) alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
      }
    },

    _abrirForm(clienteId) {
      Modal.abrir(`<i class="fa-solid fa-plus"></i> Registrar Contato`,
        `<div class="form-grid" id="com-form">
          <div class="field col-2"><label>Canal *</label>
            <select id="com-canal">
              <option value="ligacao">📞 Ligação telefônica</option>
              <option value="whatsapp">💬 WhatsApp</option>
              <option value="email">✉️ Email</option>
              <option value="visita">🚶 Visita presencial</option>
              <option value="outro">📝 Outro</option>
            </select>
          </div>
          <div class="field col-2"><label>Assunto</label>
            <input id="com-assunto" placeholder="Ex: Orçamento aprovado, Reclamação…">
          </div>
          <div class="field col-2"><label>Descrição *</label>
            <textarea id="com-desc" rows="3" style="width:100%;font-family:inherit;
              padding:.5rem;border:1px solid var(--border,#ddd);border-radius:6px"
              placeholder="Descreva o conteúdo da conversa…"></textarea>
          </div>
        </div>`,
        `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
         <button class="btn btn--primary" id="com-salvar-btn">
           <i class="fa-solid fa-check"></i> Salvar
         </button>`);

      document.getElementById("com-salvar-btn").onclick = async () => {
        const desc = document.getElementById("com-desc")?.value.trim();
        if (!desc) { toast("Informe a descrição", "warning"); return; }
        const btn = document.getElementById("com-salvar-btn");
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner spin"></i> Salvando…`;
        try {
          await API.post(`/api/clientes/${clienteId}/comunicacoes`, {
            canal: document.getElementById("com-canal")?.value,
            assunto: document.getElementById("com-assunto")?.value.trim() || "",
            descricao: desc,
          });
          toast("Contato registrado");
          Modal.fechar();
          // Reabre o modal de histórico
          setTimeout(() => {
            const nome = document.title || "";
            window.__com.abrir(clienteId, "");
          }, 300);
        } catch(e) {
          toast(e.message, "error");
          btn.disabled = false;
          btn.innerHTML = `<i class="fa-solid fa-check"></i> Salvar`;
        }
      };
    },

    async _excluir(mid, clienteId) {
      if (!confirm("⚠️ Excluir registro\n\nEsta ação não pode ser desfeita.")) return;
      try {
        await API.delete(`/api/clientes/comunicacoes/${mid}`);
        toast("Registro excluído");
        this._carregar(clienteId);
      } catch(e) { toast(e.message, "error"); }
    },
  };

  window.__recarregar = () => crud.carregar();
  crud.montar();
})();
