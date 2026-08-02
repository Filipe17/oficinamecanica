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

      <h3 style="margin:22px 0 4px;font-size:15px">Nota Fiscal (Gateway)</h3>
      <p class="text-muted" style="margin:0 0 12px;font-size:13px">Credenciais do provedor de nota fiscal (NF-e/NFS-e). Preencha após contratar o gateway.</p>
      <div class="form-grid" id="cfg-form-fiscal">
        <div class="field"><label>Provedor</label>
          <select name="nfe_provedor">
            ${["", "focus", "plugnotas", "nfeio", "enotas", "webmania"].map((p) => {
              const nomes = { "": "— nenhum —", focus: "Focus NFe", plugnotas: "PlugNotas", nfeio: "NFe.io", enotas: "eNotas", webmania: "WebmaniaBR" };
              return `<option value="${p}" ${(c.nfe_provedor || "") === p ? "selected" : ""}>${nomes[p]}</option>`;
            }).join("")}
          </select></div>
        <div class="field"><label>Ambiente</label>
          <select name="nfe_ambiente">
            ${["homologacao", "producao"].map((a) =>
              `<option value="${a}" ${(c.nfe_ambiente || "homologacao") === a ? "selected" : ""}>${a === "homologacao" ? "Homologação (teste)" : "Produção (valendo)"}</option>`).join("")}
          </select></div>
        <div class="field col-2"><label>Token do gateway</label>
          <input name="nfe_token" value="${c.nfe_token || ""}" placeholder="Cole aqui o token/chave da API do provedor" autocomplete="off"></div>
        <div class="field col-2"><label>Inscrição Municipal (para NFS-e)</label>
          <input name="empresa_inscricao_municipal" value="${c.empresa_inscricao_municipal || ""}" placeholder="Número da inscrição na prefeitura"></div>
      </div>

      <h3 style="margin:22px 0 4px;font-size:15px">Boleto Bancário (Provedor)</h3>
      <p class="text-muted" style="margin:0 0 12px;font-size:13px">Credenciais do provedor de pagamento para emitir boletos registrados. Preencha após contratar.</p>
      <div class="form-grid" id="cfg-form-boleto">
        <div class="field"><label>Provedor</label>
          <select name="boleto_provedor">
            ${["", "asaas", "efi", "cora", "cobrefacil"].map((p) => {
              const nomes = { "": "— nenhum —", asaas: "Asaas", efi: "Efí (Gerencianet)", cora: "Cora", cobrefacil: "Cobre Fácil" };
              return `<option value="${p}" ${(c.boleto_provedor || "") === p ? "selected" : ""}>${nomes[p]}</option>`;
            }).join("")}
          </select></div>
        <div class="field"><label>Ambiente</label>
          <select name="boleto_ambiente">
            ${["homologacao", "producao"].map((a) =>
              `<option value="${a}" ${(c.boleto_ambiente || "homologacao") === a ? "selected" : ""}>${a === "homologacao" ? "Homologação (teste)" : "Produção (valendo)"}</option>`).join("")}
          </select></div>
        <div class="field col-2"><label>Token / chave da API do provedor</label>
          <input name="boleto_token" value="${c.boleto_token || ""}" placeholder="Cole aqui a chave de API do provedor de boleto" autocomplete="off"></div>
      </div>

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

  /* ---------------- salvar ---------------- */
  document.getElementById("cfg-salvar").onclick = async () => {
    const val = (n) => (document.querySelector(`#cfg-form [name="${n}"], #cfg-form-fiscal [name="${n}"], #cfg-form-boleto [name="${n}"]`)?.value || "").trim();
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
      nfe_token: val("nfe_token"),
      boleto_provedor: val("boleto_provedor"),
      boleto_ambiente: val("boleto_ambiente"),
      boleto_token: val("boleto_token"),
      empresa_logo: logoAtual,
    };
    try {
      await API.post("/api/configuracoes", dados);
      toast("Configurações salvas");
      setTimeout(() => location.reload(), 600);
    } catch (e) { toast(e.message, "error"); }
  };
})();
