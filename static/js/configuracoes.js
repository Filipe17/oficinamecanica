/* =======================================================================
   configuracoes.js — Configurações da empresa (somente administrador)
   Nome, CNPJ, telefone, endereço e logo. A logo é convertida em base64 e
   salva no banco (aparece no menu e no recibo).
   ======================================================================= */
(async () => {
  await Layout.iniciar("configuracoes", "Configurações");

  if (Layout.usuario?.perfil !== "administrador") {
    Layout.set(`<div class="empty"><i class="fa-solid fa-lock"></i>Acesso restrito ao administrador.</div>`);
    return;
  }

  const c = Layout.config || {};
  let logoAtual = c.empresa_logo || "";

  Layout.set(`
    <div class="page-head">
      <div><h1>Configurações</h1><p>Dados da empresa que aparecem no sistema e nos recibos</p></div>
    </div>
    <div class="card" style="max-width:720px"><div class="card__body">
      <div class="form-grid" id="cfg-form">
        <div class="field col-2"><label>Nome da empresa</label>
          <input name="empresa_nome" value="${c.empresa_nome || ""}" placeholder="Ex: Oficina do Zé Ltda"></div>
        <div class="field"><label>CNPJ</label>
          <input name="empresa_cnpj" value="${c.empresa_cnpj || ""}" placeholder="00.000.000/0000-00"></div>
        <div class="field"><label>Telefone</label>
          <input name="empresa_telefone" value="${c.empresa_telefone || ""}" placeholder="(00) 0000-0000"></div>
        <div class="field col-2"><label>Endereço</label>
          <input name="empresa_endereco" value="${c.empresa_endereco || ""}" placeholder="Rua, número, bairro, cidade"></div>
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

  const preview = document.getElementById("cfg-preview");
  const btnRemover = document.getElementById("cfg-remover");

  document.getElementById("cfg-file").onchange = (e) => {
    const arquivo = e.target.files[0];
    if (!arquivo) return;
    if (arquivo.size > 500 * 1024) {
      toast("Imagem muito grande. Escolha uma até ~400 KB.", "warning");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      logoAtual = reader.result;   // data URL base64
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

  document.getElementById("cfg-salvar").onclick = async () => {
    const f = document.getElementById("cfg-form");
    const dados = {
      empresa_nome: f.empresa_nome.value.trim(),
      empresa_cnpj: f.empresa_cnpj.value.trim(),
      empresa_telefone: f.empresa_telefone.value.trim(),
      empresa_endereco: f.empresa_endereco.value.trim(),
      empresa_logo: logoAtual,
    };
    try {
      await API.post("/api/configuracoes", dados);
      toast("Configurações salvas");
      // Atualiza o menu/topo com os novos dados
      setTimeout(() => location.reload(), 600);
    } catch (e) { toast(e.message, "error"); }
  };
})();
