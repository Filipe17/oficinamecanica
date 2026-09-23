/* =======================================================================
   login.js — Lógica da tela de login
   -----------------------------------------------------------------------
   Envia as credenciais para POST /api/login. Em caso de sucesso, o backend
   grava a sessão (cookie) e o usuário é redirecionado ao dashboard.
   Também controla o botão de mostrar/ocultar senha e o link "esqueci senha".
   ======================================================================= */

// Mostra a logo e a razão social da empresa (das Configurações) no TOPO do
// card de login. Se ainda não houver empresa cadastrada, o card fica sem isso
// e a marca DevSystem PRIME segue no painel da esquerda.
(async () => {
  try {
    const m = await API.get("/api/marca");
    if (!m || (!m.empresa_nome && !m.empresa_logo)) return;
    const card = document.querySelector(".login-card");
    if (!card) return;
    const bloco = document.createElement("div");
    bloco.className = "login-card__marca";
    bloco.innerHTML = `
      ${m.empresa_logo ? `<img class="login-card__logo" src="${m.empresa_logo}" alt="${m.empresa_nome || "Empresa"}">` : ""}
      ${m.empresa_nome ? `<div class="login-card__nome">${m.empresa_nome}</div>` : ""}`;
    card.insertBefore(bloco, card.firstChild);
  } catch (_) { /* sem config ou offline: mantém o card padrão */ }
})();

// Se já houver sessão ativa, pula direto para o dashboard.
(async () => {
  try {
    await API.get("/api/me");
    location.href = "/dashboard";
  } catch (_) {
    /* sem sessão: permanece no login */
  }
})();

// Preenche o usuário lembrado (se o usuário marcou "lembrar acesso" antes).
const emailLembrado = localStorage.getItem("login_email");
if (emailLembrado) {
  const campo = document.querySelector('input[name="email"]');
  if (campo) campo.value = emailLembrado;
}

// Submit do formulário
document.getElementById("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("btn-entrar");
  const dados = {
    email: e.target.email.value.trim(),
    senha: e.target.senha.value,
  };
  if (!dados.email || !dados.senha) {
    toast("Informe usuário e senha", "warning");
    return;
  }

  // Guarda (ou limpa) o usuário conforme o "lembrar acesso".
  if (e.target.lembrar.checked) localStorage.setItem("login_email", dados.email);
  else localStorage.removeItem("login_email");

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner spin"></i> Entrando…';
  try {
    await API.post("/api/login", dados);
    location.href = "/dashboard";
  } catch (err) {
    toast(err.message || "Falha no login", "error");
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Entrar';
  }
});

// Mostrar/ocultar senha
function toggleSenha(botao) {
  const input = botao.parentElement.querySelector("input");
  const icone = botao.querySelector("i");
  if (input.type === "password") {
    input.type = "text";
    icone.className = "fa-solid fa-eye-slash";
  } else {
    input.type = "password";
    icone.className = "fa-solid fa-eye";
  }
}

// Esqueci a senha: troca o card de login pela tela "Recuperar sua senha".
function esqueciSenha(ev) {
  if (ev) ev.preventDefault();
  const login = document.querySelector('#form-login [name="email"]').value.trim();
  const form = document.getElementById("form-recuperar");
  form.usuario.value = login;
  form.style.display = "";
  document.getElementById("recuperar-msg").style.display = "none";
  document.getElementById("view-login").style.display = "none";
  document.getElementById("view-recuperar").style.display = "";
  form.usuario.focus();
}

// Volta da tela de recuperar senha para o login.
function voltarLogin(ev) {
  if (ev) ev.preventDefault();
  document.getElementById("view-recuperar").style.display = "none";
  document.getElementById("view-login").style.display = "";
}

// Envio do pedido de redefinição (registrado nos logs para o administrador).
document.getElementById("form-recuperar").addEventListener("submit", async (e) => {
  e.preventDefault();
  const usuario = e.target.usuario.value.trim();
  const btn = document.getElementById("btn-recuperar");
  const msg = document.getElementById("recuperar-msg");
  if (!usuario) return;

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner spin"></i> Enviando…';
  try {
    await API.post("/api/auth/esqueci-senha", { usuario });
    msg.className = "login-msg";
    msg.innerHTML = '<i class="fa-solid fa-circle-check"></i> Pedido registrado. ' +
                    "O administrador do sistema vai redefinir sua senha e te passar a nova.";
    e.target.style.display = "none";
  } catch (_) {
    msg.className = "login-msg erro";
    msg.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Não foi possível enviar o pedido agora. ' +
                    "Entre em contato com o administrador do sistema.";
  }
  msg.style.display = "block";
  btn.disabled = false;
  btn.innerHTML = "Próximo";
});

// Botão de tema na tela de login (se existir no HTML)
const btnTemaLogin = document.getElementById("btn-tema-login");
if (btnTemaLogin) {
  const sinc = () => {
    const escuro = document.documentElement.getAttribute("data-theme") === "dark";
    btnTemaLogin.querySelector("i").className = escuro ? "fa-solid fa-sun" : "fa-solid fa-moon";
  };
  sinc();
  btnTemaLogin.addEventListener("click", () => { Tema.alternar(); sinc(); });
}
