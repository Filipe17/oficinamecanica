/* =======================================================================
   configuracoes.js — Configurações da empresa (somente administrador)
   Nome, CNPJ, telefone, endereço (com busca por CEP) e logo.
   Máscaras de telefone/CNPJ/CEP são aplicadas ao digitar. O CEP preenche
   rua, bairro, cidade e estado automaticamente (ViaCEP); número é digitado.
   ======================================================================= */
(async () => {
  await Layout.iniciar("configuracoes", "Configurações");

  if (Layout.usuario?.perfil !== "administrador") {
    Layout.set(`<div class="empty"><i class="fa-solid fa-lock"></i>Acesso restrito ao administrador.</div>`);
    return;
  }

  const c = Layout.config || {};
  let logoAtual = c.empresa_logo || "";

  /* ---------------- máscaras (embutidas para não depender do crud.js) ------ */
  const mascara = {
    cnpj(v) {
      v = (v || "").replace(/\D/g, "").slice(0, 14);
      return v.replace(/(\d{2})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2")
              .replace(/(\d{3})(\d)/, "$1/$2").replace(/(\d{4})(\d{1,2})$/, "$1-$2");
    },
    telefone(v) {
      v = (v || "").replace(/\D/g, "").slice(0, 11);
      if (v.length <= 10) return v.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d{1,4})$/, "$1-$2");
      return v.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d{1,4})$/, "$1-$2");
    },
    cep(v) {
      v = (v || "").replace(/\D/g, "").slice(0, 8);
      return v.replace(/(\d{5})(\d{1,3})$/, "$1-$2");
    },
  };

  Layout.set(`
    <div class="page-head">
      <div><h1>Configurações</h1><p>Dados da empresa que aparecem no sistema e nos recibos</p></div>
    </div>
    <div class="card" style="max-width:760px"><div class="card__body">
      <div class="form-grid" id="cfg-form">
        <div class="field col-2"><label>Nome da empresa</label>
          <input name="empresa_nome" value="${c.empresa_nome || ""}" placeholder="Ex: Oficina do Zé Ltda"></div>
        <div class="field"><label>CNPJ</label>
          <input name="empresa_cnpj" data-mask="cnpj" value="${c.empresa_cnpj || ""}" placeholder="00.000.000/0000-00"></div>
        <div class="field"><label>Telefone</label>
          <input name="empresa_telefone" data-mask="telefone" value="${c.empresa_telefone || ""}" placeholder="(00) 00000-0000"></div>

        <div class="field"><label>CEP</label>
          <input name="empresa_cep" data-mask="cep" data-cep="1" value="${c.empresa_cep || ""}" placeholder="00000-000"></div>
        <div class="field"><label>Número</label>
          <input name="empresa_numero" value="${c.empresa_numero || ""}" placeholder="123"></div>
        <div class="field col-2"><label>Endereço (rua)</label>
          <input name="empresa_endereco" value="${c.empresa_endereco || ""}" placeholder="Preenchido pelo CEP"></div>
        <div class="field"><label>Bairro</label>
          <input name="empresa_bairro" value="${c.empresa_bairro || ""}" placeholder="Preenchido pelo CEP"></div>
        <div class="field"><label>Cidade</label>
          <input name="empresa_cidade" value="${c.empresa_cidade || ""}" placeholder="Preenchido pelo CEP"></div>
        <div class="field"><label>Estado (UF)</label>
          <input name="empresa_estado" value="${c.empresa_estado || ""}" maxlength="2" placeholder="UF" style="text-transform:uppercase"></div>

        <div class="field"><label>Regime tributário</label>
          <select name="empresa_regime_tributario">
            ${["", "Simples Nacional", "Lucro Presumido", "Lucro Real"].map((r) =>
              `<option value="${r}" ${(c.empresa_regime_tributario || "") === r ? "selected" : ""}>${r || "— selecione —"}</option>`).join("")}
          </select></div>
        <div class="field"><label>Inscrição Estadual</label>
          <input name="empresa_inscricao_estadual" value="${c.empresa_inscricao_estadual || ""}" placeholder="ISENTO ou número"></div>
      </div>

      <h3 style="margin:22px 0 4px;font-size:15px">Nota Fiscal (NF-e / NFC-e)</h3>
      <p class="text-muted" style="margin:0 0 12px;font-size:13px">
        Configure a emissão de NF-e e NFC-e. Escolha entre usar um provedor (mais simples)
        ou certificado digital próprio (direto com a SEFAZ).
      </p>
      <div class="form-grid" id="cfg-form-fiscal">
        <div class="field col-2"><label>Modo de integração</label>
          <select name="nfe_modo" onchange="window.__cfgNfeModo(this.value)">
            <option value="" ${!(c.nfe_modo||"")?"selected":""}>— não configurado —</option>
            <option value="provedor" ${(c.nfe_modo||"")==="provedor"?"selected":""}>Via provedor (Focus NFe, PlugNotas, NFe.io, eNotas…)</option>
            <option value="certificado" ${(c.nfe_modo||"")==="certificado"?"selected":""}>Certificado próprio A1 — direto com a SEFAZ</option>
          </select>
        </div>
        <div class="field"><label>Ambiente</label>
          <select name="nfe_ambiente">
            ${["homologacao", "producao"].map((a) =>
              `<option value="${a}" ${(c.nfe_ambiente||"homologacao")===a?"selected":""}>${a==="homologacao"?"Homologação (teste)":"Produção (valendo)"}</option>`).join("")}
          </select>
        </div>
        <div class="field col-2"><label>Inscrição Municipal (para NFS-e)</label>
          <input name="empresa_inscricao_municipal" value="${c.empresa_inscricao_municipal||""}" placeholder="Número da inscrição na prefeitura">
        </div>

        <!-- Seção provedor -->
        <div id="cfg-nfe-prov" style="${(c.nfe_modo||"")==="provedor"?"display:contents":"display:none"}">
          <div class="field col-2"><label>Provedor</label>
            <select name="nfe_provedor">
              ${["","focus","plugnotas","nfeio","enotas","webmania"].map((p)=>{
                const nm={"":"— selecione —",focus:"Focus NFe",plugnotas:"PlugNotas",nfeio:"NFe.io",enotas:"eNotas",webmania:"WebmaniaBR"};
                return `<option value="${p}" ${(c.nfe_provedor||"")===p?"selected":""}>${nm[p]}</option>`;
              }).join("")}
            </select>
          </div>
          <div class="field col-2"><label>Token / chave da API do provedor</label>
            <input name="nfe_token" value="${c.nfe_token||""}" placeholder="Cole aqui o token da API" autocomplete="off">
          </div>
        </div>

        <!-- Seção certificado próprio -->
        <div id="cfg-nfe-cert" style="${(c.nfe_modo||"")==="certificado"?"display:contents":"display:none"}">
          <div class="field col-2">
            <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:.75rem;font-size:.82rem">
              <strong>⚠️ Certificado Digital A1</strong> — Envie o arquivo <strong>.pfx</strong> do certificado.
              Ele é armazenado no banco e usado para assinar os XMLs direto com a SEFAZ.
              A implementação específica por UF deve ser feita em <code>api/caixa.py</code>.
            </div>
          </div>
          <div class="field col-2"><label>Certificado A1 (.pfx / .p12)</label>
            <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
              <label class="btn btn--outline btn--sm" style="cursor:pointer;margin:0">
                <i class="fa-solid fa-upload"></i> Carregar certificado
                <input type="file" id="cfg-cert-input" accept=".pfx,.p12" style="display:none">
              </label>
              <span id="cfg-cert-nome" style="font-size:.82rem;color:var(--text-muted)">
                ${c.nfe_certificado_pfx?"✅ Certificado já carregado":"Nenhum arquivo selecionado"}
              </span>
            </div>
            <input type="hidden" name="nfe_certificado_pfx" id="cfg-cert-dados" value="">
          </div>
          <div class="field"><label>Senha do certificado</label>
            <input type="password" name="nfe_certificado_senha" value="${c.nfe_certificado_senha||""}"
              placeholder="Senha do arquivo .pfx" autocomplete="new-password">
          </div>
        </div>
      </div>

      <h3 style="margin:22px 0 4px;font-size:15px">NFC-e — Cupom Fiscal Eletrônico (PDV/Caixa)</h3>
      <p class="text-muted" style="margin:0 0 12px;font-size:13px">
        Configurações para emissão de NFC-e no Caixa. Usa o mesmo provedor da NF-e configurado acima.
        O CSC (Código de Segurança do Contribuinte) é fornecido pela SEFAZ do seu estado.
      </p>
      <div class="form-grid" id="cfg-form-nfce">
        <div class="field">
          <label>NFC-e ativa?</label>
          <select name="nfce_ativo">
            <option value="0" ${(c.nfce_ativo||"0")==="0"?"selected":""}>Não (desativada)</option>
            <option value="1" ${(c.nfce_ativo||"")==="1"?"selected":""}>Sim — emitir NFC-e no caixa</option>
          </select>
        </div>
        <div class="field">
          <label>Série da NFC-e</label>
          <input name="nfce_serie" value="${c.nfce_serie||"1"}" placeholder="Geralmente 1">
        </div>
        <div class="field">
          <label>Número inicial</label>
          <input type="number" name="nfce_numero_inicial" value="${c.nfce_numero_inicial||"1"}" min="1">
        </div>
        <div class="field">
          <label>CSC ID</label>
          <input name="nfce_csc_id" value="${c.nfce_csc_id||""}" placeholder="ID do CSC (ex: 1)">
        </div>
        <div class="field col-2">
          <label>CSC (Código de Segurança do Contribuinte)</label>
          <input name="nfce_csc" value="${c.nfce_csc||""}" placeholder="Código fornecido pela SEFAZ do seu estado" autocomplete="off">
        </div>
        <div class="field col-2">
          <p style="font-size:.8rem;color:var(--text-muted);margin:0">
            <i class="fa-solid fa-circle-info"></i>
            O token/chave da API do provedor é o mesmo configurado na seção NF-e acima.
            Após configurar, o botão "Emitir NFC-e" aparecerá no Caixa.
          </p>
        </div>
      </div>

      <h3 style="margin:22px 0 4px;font-size:15px">Boleto Bancário</h3>
      <p class="text-muted" style="margin:0 0 12px;font-size:13px">Escolha como os boletos serão emitidos. Preencha após contratar/habilitar.</p>
      <div class="form-grid" id="cfg-form-boleto">
        <div class="field col-2"><label>Método de emissão</label>
          <select name="boleto_metodo" id="cfg-boleto-metodo">
            ${[["", "— nenhum —"], ["provedor", "Via provedor (Asaas/Efí/Cora)"], ["banco", "Direto pelo banco"]].map(([v, t]) =>
              `<option value="${v}" ${(c.boleto_metodo || "") === v ? "selected" : ""}>${t}</option>`).join("")}
          </select></div>

        <!-- Campos do PROVEDOR -->
        <div class="field boleto-prov"><label>Provedor</label>
          <select name="boleto_provedor">
            ${["", "asaas", "efi", "cora", "cobrefacil"].map((p) => {
              const nomes = { "": "— nenhum —", asaas: "Asaas", efi: "Efí (Gerencianet)", cora: "Cora", cobrefacil: "Cobre Fácil" };
              return `<option value="${p}" ${(c.boleto_provedor || "") === p ? "selected" : ""}>${nomes[p]}</option>`;
            }).join("")}
          </select></div>
        <div class="field boleto-prov"><label>Ambiente</label>
          <select name="boleto_ambiente">
            ${["homologacao", "producao"].map((a) =>
              `<option value="${a}" ${(c.boleto_ambiente || "homologacao") === a ? "selected" : ""}>${a === "homologacao" ? "Homologação (teste)" : "Produção (valendo)"}</option>`).join("")}
          </select></div>
        <div class="field col-2 boleto-prov"><label>Token / chave da API do provedor</label>
          <input name="boleto_token" value="${c.boleto_token || ""}" placeholder="Cole aqui a chave de API do provedor de boleto" autocomplete="off"></div>

        <!-- Campos do BANCO (genéricos por enquanto; os específicos vêm ao implementar o banco) -->
        <div class="field boleto-banco"><label>Banco</label>
          <input name="boleto_banco" value="${c.boleto_banco || ""}" placeholder="Ex: Banco do Brasil, Sicoob…"></div>
        <div class="field boleto-banco"><label>Agência</label>
          <input name="boleto_agencia" value="${c.boleto_agencia || ""}" placeholder="0000"></div>
        <div class="field boleto-banco"><label>Conta</label>
          <input name="boleto_conta" value="${c.boleto_conta || ""}" placeholder="00000-0"></div>
        <div class="field boleto-banco"><label>Convênio / Cedente</label>
          <input name="boleto_convenio" value="${c.boleto_convenio || ""}" placeholder="Código do convênio/beneficiário"></div>
        <div class="field boleto-banco"><label>Carteira</label>
          <input name="boleto_carteira" value="${c.boleto_carteira || ""}" placeholder="Ex: 17, 09, 109…"></div>
        <div class="field boleto-banco"><label>Ambiente</label>
          <select name="boleto_banco_ambiente">
            ${["homologacao", "producao"].map((a) =>
              `<option value="${a}" ${(c.boleto_banco_ambiente || "homologacao") === a ? "selected" : ""}>${a === "homologacao" ? "Homologação (teste)" : "Produção (valendo)"}</option>`).join("")}
          </select></div>
        <div class="field col-2 boleto-banco"><label>Credenciais da API (Client ID / Secret)</label>
          <input name="boleto_banco_credenciais" value="${c.boleto_banco_credenciais || ""}" placeholder="Definiremos os campos exatos ao integrar o banco escolhido" autocomplete="off"></div>
      </div>

      <h3 style="margin:22px 0 4px;font-size:15px">Email (SMTP)</h3>
      <p class="text-muted" style="margin:0 0 12px;font-size:13px">
        Configurações do servidor de email para envio de cotações e pedidos de compra aos fornecedores.
        Funciona com Gmail, Outlook, Zoho, e qualquer provedor SMTP.
      </p>
      <div class="form-grid" id="cfg-form-smtp">
        <div class="field"><label>Servidor SMTP</label>
          <input name="smtp_host" value="${c.smtp_host || ""}" placeholder="ex: smtp.gmail.com"></div>
        <div class="field"><label>Porta</label>
          <input name="smtp_porta" type="number" value="${c.smtp_porta || "587"}" placeholder="587"></div>
        <div class="field"><label>Usuário / Email</label>
          <input name="smtp_usuario" type="email" value="${c.smtp_usuario || ""}" placeholder="seu@email.com"></div>
        <div class="field"><label>Senha / App Password</label>
          <input name="smtp_senha" type="password" value="${c.smtp_senha || ""}" placeholder="Senha ou App Password" autocomplete="off"></div>
        <div class="field"><label>SSL/TLS</label>
          <select name="smtp_ssl">
            <option value="0" ${(c.smtp_ssl || "0") === "0" ? "selected" : ""}>STARTTLS (porta 587)</option>
            <option value="1" ${(c.smtp_ssl || "") === "1" ? "selected" : ""}>SSL direto (porta 465)</option>
          </select></div>
        <div class="field"><label>Email remetente</label>
          <input name="smtp_email_remetente" type="email" value="${c.smtp_email_remetente || ""}" placeholder="Deixe vazio para usar o usuário"></div>
        <div class="field col-2"><label>Nome do remetente</label>
          <input name="smtp_nome_remetente" value="${c.smtp_nome_remetente || ""}" placeholder="Ex: Oficina do Zé — Compras"></div>
      </div>

      <h3 style="margin:22px 0 4px;font-size:15px">Impressora de Etiquetas</h3>
      <p class="text-muted" style="margin:0 0 12px;font-size:13px">
        Defina o padrão de etiqueta da sua impressora. Será pré-selecionado ao imprimir etiquetas de produtos.
      </p>
      <div class="form-grid" id="cfg-form-etiqueta">
        <div class="field col-2"><label>Tipo de impressora / etiqueta padrão</label>
          <select name="etiqueta_tipo">
            <option value="pimaco_a4" ${(c.etiqueta_tipo||"pimaco_a4")==="pimaco_a4"?"selected":""}>Impressora comum — Pimaco A4 (3 colunas, 66×38mm)</option>
            <option value="termica_10x5" ${(c.etiqueta_tipo||"")==="termica_10x5"?"selected":""}>Térmica 10×5 cm — Zebra / Argox / Elgin</option>
            <option value="termica_10x3" ${(c.etiqueta_tipo||"")==="termica_10x3"?"selected":""}>Térmica 10×3 cm — Mini etiqueta</option>
          </select>
        </div>
        <div class="field"><label>Mostrar preço na etiqueta?</label>
          <select name="etiqueta_mostrar_preco">
            <option value="1" ${(c.etiqueta_mostrar_preco||"1")==="1"?"selected":""}>Sim</option>
            <option value="0" ${(c.etiqueta_mostrar_preco||"")==="0"?"selected":""}>Não</option>
          </select>
        </div>
        <div class="field"><label>Mostrar código de barras?</label>
          <select name="etiqueta_mostrar_barras">
            <option value="1" ${(c.etiqueta_mostrar_barras||"1")==="1"?"selected":""}>Sim (se disponível)</option>
            <option value="0" ${(c.etiqueta_mostrar_barras||"")==="0"?"selected":""}>Não</option>
          </select>
        </div>
        <div class="field"><label>Mostrar localização?</label>
          <select name="etiqueta_mostrar_local">
            <option value="1" ${(c.etiqueta_mostrar_local||"1")==="1"?"selected":""}>Sim</option>
            <option value="0" ${(c.etiqueta_mostrar_local||"")==="0"?"selected":""}>Não</option>
          </select>
        </div>
        <div class="field"><label>Mostrar nome da empresa?</label>
          <select name="etiqueta_mostrar_empresa">
            <option value="1" ${(c.etiqueta_mostrar_empresa||"1")==="1"?"selected":""}>Sim</option>
            <option value="0" ${(c.etiqueta_mostrar_empresa||"")==="0"?"selected":""}>Não</option>
          </select>
        </div>
      </div>

      <h3 style="margin:22px 0 4px;font-size:15px">Modo de Operação</h3>
      <p class="text-muted" style="margin:0 0 12px;font-size:13px">
        Configure como o sistema integra com o financeiro/caixa. Útil para clientes
        que ainda usam outro sistema de caixa/fiscal em paralelo.
      </p>
      <div class="form-grid" id="cfg-form-modo">
        <div class="field col-2"><label>Módulo financeiro / caixa</label>
          <select name="modo_financeiro">
            <option value="completo" ${(c.modo_financeiro||"completo")==="completo"?"selected":""}>
              Completo — gera lançamentos e usa o caixa do sistema
            </option>
            <option value="sem_caixa" ${(c.modo_financeiro||"")==="sem_caixa"?"selected":""}>
              Sem caixa — não gera lançamentos ao finalizar OS/orçamento (caixa externo)
            </option>
          </select>
        </div>
        <div class="field col-2">
          <p style="font-size:.82rem;color:var(--text-muted);margin:0">
            <i class="fa-solid fa-circle-info"></i>
            No modo <strong>Sem caixa</strong>: o menu Caixa/PDV é ocultado e ao finalizar
            uma OS ou orçamento nenhum lançamento financeiro é gerado automaticamente.
            Ideal para quem usa outro sistema de caixa/fiscal em paralelo.
          </p>
        </div>
      </div>

      <h3 style="margin:22px 0 4px;font-size:15px">Backup do Banco de Dados</h3>
      <p class="text-muted" style="margin:0 0 12px;font-size:13px">
        O sistema gera um backup automático todos os dias às 23h e mantém os últimos 7 arquivos.
        Baixe o backup e salve em um HD externo ou no Google Drive para segurança.
      </p>
      <div style="display:flex;gap:.75rem;flex-wrap:wrap;align-items:center;margin-bottom:1rem">
        <button class="btn btn--outline" id="cfg-backup-gerar">
          <i class="fa-solid fa-database"></i> Gerar backup agora
        </button>
        <button class="btn btn--ghost" id="cfg-backup-listar">
          <i class="fa-solid fa-list"></i> Ver backups disponíveis
        </button>
        <label class="btn btn--outline" style="cursor:pointer" title="Selecionar arquivo .sql do computador para restaurar">
          <i class="fa-solid fa-folder-open"></i> Restaurar de arquivo
          <input type="file" id="cfg-backup-upload" accept=".sql" style="display:none">
        </label>
        <span id="cfg-backup-status" style="font-size:.85rem;color:var(--text-muted)"></span>
      </div>
      <div id="cfg-backup-lista"></div>

      <div class="cfg-logo">
        <label>Logo da empresa</label>
        <div class="cfg-logo__box">
          <div class="cfg-logo__preview" id="cfg-preview">
            ${logoAtual ? `<img src="${logoAtual}" alt="logo">` : `<i class="fa-solid fa-image"></i><span>Sem logo</span>`}
          </div>
          <div class="cfg-logo__acoes">
            <label class="btn btn--ghost btn--sm">
              <i class="fa-solid fa-upload"></i> Escolher imagem
              <input type="file" id="cfg-file" accept="image/*" hidden>
            </label>
            <button class="btn btn--ghost btn--sm" id="cfg-remover" ${logoAtual ? "" : "style=display:none"}>
              <i class="fa-solid fa-trash"></i> Remover</button>
            <small class="text-muted">PNG ou JPG, até ~400 KB. Recomendado quadrado.</small>
          </div>
        </div>
      </div>

      <div style="margin-top:20px">
        <button class="btn btn--primary" id="cfg-salvar"><i class="fa-solid fa-check"></i> Salvar configurações</button>
      </div>
    </div></div>
  `);

  const form = document.getElementById("cfg-form");
  const campo = (nome) => form.querySelector(`[name="${nome}"]`);

  // Aplica máscaras ao digitar
  form.querySelectorAll("[data-mask]").forEach((inp) => {
    const tipo = inp.dataset.mask;
    inp.addEventListener("input", () => { inp.value = mascara[tipo](inp.value); });
  });

  // Busca de endereço pelo CEP (ViaCEP) ao sair do campo
  const cepInp = campo("empresa_cep");
  cepInp.addEventListener("blur", async () => {
    const num = cepInp.value.replace(/\D/g, "");
    if (num.length !== 8) return;
    try {
      const resp = await fetch(`https://viacep.com.br/ws/${num}/json/`);
      const d = await resp.json();
      if (d.erro) { toast("CEP não encontrado", "warning"); return; }
      const set = (nome, val) => { const el = campo(nome); if (el && val) el.value = val; };
      set("empresa_endereco", d.logradouro);
      set("empresa_bairro", d.bairro);
      set("empresa_cidade", d.localidade);
      set("empresa_estado", d.uf);
      campo("empresa_numero").focus();   // número não vem do ViaCEP
    } catch (_) { /* offline: ignora */ }
  });

  /* ---------------- logo ---------------- */
  const preview = document.getElementById("cfg-preview");
  const btnRemover = document.getElementById("cfg-remover");

  document.getElementById("cfg-file").onchange = (e) => {
    const arquivo = e.target.files[0];
    if (!arquivo) return;
    if (arquivo.size > 500 * 1024) { toast("Imagem muito grande. Escolha uma até ~400 KB.", "warning"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      logoAtual = reader.result;
      preview.innerHTML = `<img src="${logoAtual}" alt="logo">`;
      btnRemover.style.display = "";
    };
    reader.readAsDataURL(arquivo);
  };
  btnRemover.onclick = () => {
    logoAtual = "";
    preview.innerHTML = `<i class="fa-solid fa-image"></i><span>Sem logo</span>`;
    btnRemover.style.display = "none";
  };

  /* ---------------- alterna campos de boleto conforme o método ---------------- */
  const metodoSel = document.getElementById("cfg-boleto-metodo");
  function alternarBoleto() {
    const m = metodoSel ? metodoSel.value : "";
    document.querySelectorAll(".boleto-prov").forEach((el) => el.style.display = (m === "provedor") ? "" : "none");
    document.querySelectorAll(".boleto-banco").forEach((el) => el.style.display = (m === "banco") ? "" : "none");
  }
  if (metodoSel) { metodoSel.addEventListener("change", alternarBoleto); alternarBoleto(); }

  /* ---------------- salvar ---------------- */
  document.getElementById("cfg-salvar").onclick = async () => {
    const val = (n) => (document.querySelector(`#cfg-form [name="${n}"], #cfg-form-modo [name="${n}"], #cfg-form-fiscal [name="${n}"], #cfg-form-nfce [name="${n}"], #cfg-form-boleto [name="${n}"], #cfg-form-smtp [name="${n}"], #cfg-form-etiqueta [name="${n}"]`)?.value || "").trim();
    const dados = {
      empresa_nome: val("empresa_nome"),
      empresa_cnpj: val("empresa_cnpj"),
      empresa_telefone: val("empresa_telefone"),
      empresa_cep: val("empresa_cep"),
      empresa_endereco: val("empresa_endereco"),
      empresa_numero: val("empresa_numero"),
      empresa_bairro: val("empresa_bairro"),
      empresa_cidade: val("empresa_cidade"),
      empresa_estado: val("empresa_estado").toUpperCase(),
      empresa_regime_tributario: val("empresa_regime_tributario"),
      empresa_inscricao_estadual: val("empresa_inscricao_estadual"),
      empresa_inscricao_municipal: val("empresa_inscricao_municipal"),
      nfe_provedor: val("nfe_provedor"),
      nfe_ambiente: val("nfe_ambiente"),
      nfe_modo: val("nfe_modo"),
      nfe_token: val("nfe_token"),
      nfe_certificado_pfx: document.getElementById("cfg-cert-dados")?.value || undefined,
      nfe_certificado_senha: val("nfe_certificado_senha"),
      modo_financeiro: val("modo_financeiro"),
      nfce_ativo: val("nfce_ativo"),
      nfce_serie: val("nfce_serie"),
      nfce_numero_inicial: val("nfce_numero_inicial"),
      nfce_csc: val("nfce_csc"),
      nfce_csc_id: val("nfce_csc_id"),
      boleto_metodo: val("boleto_metodo"),
      boleto_provedor: val("boleto_provedor"),
      boleto_ambiente: val("boleto_ambiente"),
      boleto_token: val("boleto_token"),
      boleto_banco: val("boleto_banco"),
      boleto_agencia: val("boleto_agencia"),
      boleto_conta: val("boleto_conta"),
      boleto_convenio: val("boleto_convenio"),
      boleto_carteira: val("boleto_carteira"),
      boleto_banco_ambiente: val("boleto_banco_ambiente"),
      boleto_banco_credenciais: val("boleto_banco_credenciais"),
      smtp_host: val("smtp_host"),
      smtp_porta: val("smtp_porta"),
      smtp_usuario: val("smtp_usuario"),
      smtp_senha: val("smtp_senha"),
      smtp_ssl: val("smtp_ssl"),
      smtp_email_remetente: val("smtp_email_remetente"),
      smtp_nome_remetente: val("smtp_nome_remetente"),
      etiqueta_tipo: val("etiqueta_tipo"),
      etiqueta_mostrar_preco: val("etiqueta_mostrar_preco"),
      etiqueta_mostrar_barras: val("etiqueta_mostrar_barras"),
      etiqueta_mostrar_local: val("etiqueta_mostrar_local"),
      etiqueta_mostrar_empresa: val("etiqueta_mostrar_empresa"),
      empresa_logo: logoAtual,
    };
    try {
      await API.post("/api/configuracoes", dados);
      toast("Configurações salvas");
      setTimeout(() => location.reload(), 600);
    } catch (e) { toast(e.message, "error"); }
  };

  // -----------------------------------------------------------------------
  // Backup
  // -----------------------------------------------------------------------

  // Toggle seções NF-e conforme o modo selecionado
  window.__cfgNfeModo = function(modo) {
    const prov = document.getElementById("cfg-nfe-prov");
    const cert = document.getElementById("cfg-nfe-cert");
    if (prov) prov.style.display = modo === "provedor" ? "contents" : "none";
    if (cert) cert.style.display = modo === "certificado" ? "contents" : "none";
  };

  // Carrega certificado .pfx como base64
  document.getElementById("cfg-cert-input")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      document.getElementById("cfg-cert-dados").value = reader.result;
      document.getElementById("cfg-cert-nome").textContent = `✅ ${file.name} (${(file.size/1024).toFixed(1)} KB)`;
    };
    reader.readAsDataURL(file);
  });

  // Restaurar de arquivo local
  document.getElementById("cfg-backup-upload")?.addEventListener("change", async (e) => {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    e.target.value = "";
    const conf1 = confirm(
      `⚠️ ATENÇÃO — Restaurar backup de arquivo\n\nArquivo: ${arquivo.name}\n\n` +
      `Esta operação irá SUBSTITUIR todos os dados atuais.\n` +
      `Um backup de segurança será gerado automaticamente antes.\n\nConfirma?`
    );
    if (!conf1) return;
    const conf2 = confirm(
      `⚠️ CONFIRMAÇÃO FINAL\n\nVocê está prestes a restaurar:\n${arquivo.name}\n\n` +
      `TODOS OS DADOS ATUAIS SERÃO SUBSTITUÍDOS.\n\nClique OK apenas se tiver certeza absoluta.`
    );
    if (!conf2) return;
    const status = document.getElementById("cfg-backup-status");
    status.innerHTML = `<span style="color:#f59e0b"><i class="fa-solid fa-spinner spin"></i> Enviando e restaurando… aguarde.</span>`;
    const fd = new FormData();
    fd.append("arquivo", arquivo);
    try {
      const r = await API.upload("/api/backup/restaurar-upload", fd);
      status.innerHTML = `<span style="color:#27ae60"><i class="fa-solid fa-check"></i>
        <strong>Restaurado com sucesso!</strong><br>
        <small>Backup de segurança gerado: <strong>${r.backup_seguranca}</strong></small></span>`;
      toast("Backup restaurado! Recarregando…");
      setTimeout(() => location.reload(), 2500);
    } catch(e) {
      status.innerHTML = `<span style="color:#e74c3c"><i class="fa-solid fa-triangle-exclamation"></i> ${e.message}</span>`;
      toast(e.message, "error");
    }
  });

  document.getElementById("cfg-backup-gerar")?.addEventListener("click", async () => {
    const btn = document.getElementById("cfg-backup-gerar");
    const status = document.getElementById("cfg-backup-status");
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner spin"></i> Gerando…`;
    status.textContent = "";
    try {
      const r = await API.post("/api/backup/gerar");
      status.innerHTML = `<span style="color:#27ae60"><i class="fa-solid fa-check"></i> Backup gerado: <strong>${r.arquivo}</strong> (${r.tamanho})</span>`;
      toast("Backup gerado com sucesso");
      _carregarListaBackups();
    } catch(e) {
      status.innerHTML = `<span style="color:#e74c3c"><i class="fa-solid fa-triangle-exclamation"></i> ${e.message}</span>`;
      toast(e.message, "error");
    }
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-database"></i> Gerar backup agora`;
  });

  document.getElementById("cfg-backup-listar")?.addEventListener("click", _carregarListaBackups);

  // Restauração de backup
  window.__backupRestore = async function(arquivo) {
    const conf1 = confirm(
      `⚠️ ATENÇÃO — Restaurar backup\n\n` +
      `Arquivo: ${arquivo}\n\n` +
      `Esta operação irá SUBSTITUIR todos os dados atuais pelos dados deste backup.\n` +
      `Os dados atuais serão perdidos (um backup de segurança será gerado automaticamente antes).\n\n` +
      `Tem certeza que deseja continuar?`
    );
    if (!conf1) return;

    const conf2 = confirm(
      `⚠️ CONFIRMAÇÃO FINAL\n\n` +
      `Você está prestes a restaurar o backup:\n${arquivo}\n\n` +
      `TODOS OS DADOS ATUAIS SERÃO SUBSTITUÍDOS.\n\n` +
      `Clique OK apenas se tiver certeza absoluta.`
    );
    if (!conf2) return;

    const status = document.getElementById("cfg-backup-status");
    status.innerHTML = `<span style="color:#f59e0b"><i class="fa-solid fa-spinner spin"></i> Restaurando backup… aguarde, isso pode levar alguns minutos.</span>`;

    try {
      const r = await API.post(`/api/backup/restaurar/${arquivo}`);
      status.innerHTML = `
        <span style="color:#27ae60">
          <i class="fa-solid fa-check"></i>
          <strong>Backup restaurado com sucesso!</strong><br>
          <small>Backup de segurança gerado antes da restauração: <strong>${r.backup_seguranca}</strong></small>
        </span>`;
      toast("Backup restaurado! Recarregando sistema…");
      setTimeout(() => location.reload(), 2500);
    } catch(e) {
      status.innerHTML = `
        <span style="color:#e74c3c">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <strong>Erro na restauração:</strong> ${e.message}
          ${e.backup_seguranca ? `<br><small>Backup de segurança salvo: ${e.backup_seguranca}</small>` : ""}
        </span>`;
      toast(e.message, "error");
    }
  };

  async function _carregarListaBackups() {
    const alvo = document.getElementById("cfg-backup-lista");
    alvo.innerHTML = `<div class="loading"><i class="fa-solid fa-spinner spin"></i></div>`;
    try {
      const r = await API.get("/api/backup/listar");
      if (!r.backups?.length) {
        alvo.innerHTML = `<div class="empty" style="padding:.75rem 0">
          <i class="fa-solid fa-inbox"></i> Nenhum backup disponível ainda</div>`;
        return;
      }
      alvo.innerHTML = `
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Arquivo</th><th>Tamanho</th><th>Data</th><th></th></tr></thead>
          <tbody>${r.backups.map((b) => `<tr>
            <td><i class="fa-solid fa-file-code" style="color:#0d9488;margin-right:6px"></i>${b.arquivo}</td>
            <td>${b.tamanho}</td>
            <td>${b.criado_em}</td>
            <td style="white-space:nowrap;display:flex;gap:.4rem">
              <a class="btn btn--sm btn--primary" href="/api/backup/baixar/${b.arquivo}"
                download="${b.arquivo}">
                <i class="fa-solid fa-download"></i> Baixar
              </a>
              <button class="btn btn--sm btn--danger" style="background:#e74c3c;color:#fff;border:none"
                onclick="window.__backupRestore('${b.arquivo}')">
                <i class="fa-solid fa-rotate-left"></i> Restaurar
              </button>
            </td>
          </tr>`).join("")}
          </tbody>
        </table></div>
        <p style="font-size:.8rem;color:var(--text-muted);margin-top:.5rem">
          <i class="fa-solid fa-info-circle"></i>
          Os últimos 7 backups são mantidos automaticamente. Salve em HD externo ou Google Drive.
        </p>`;
    } catch(e) {
      alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
    }
  }

})();
