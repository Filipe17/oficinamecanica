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

// =======================================================================
// Recuperação de senha em 3 passos, todos dentro do mesmo card:
//   1) usuário  ->  2) e-mail cadastrado (recebe o código)  ->  3) código + nova senha
// =======================================================================
const recuperacao = { usuario: "", email: "" };

// Mostra só a tela pedida (login ou um dos passos da recuperação).
function mostrarTela(id) {
  ["view-login", "view-recuperar", "view-email", "view-codigo", "view-concluido"].forEach((v) => {
    const el = document.getElementById(v);
    if (el) el.style.display = v === id ? "" : "none";
  });
  document.querySelectorAll(".login-msg").forEach((m) => (m.style.display = "none"));
  const primeiro = document.querySelector(`#${id} input`);
  if (primeiro) primeiro.focus();
}

function mostrarErro(idMsg, texto) {
  const msg = document.getElementById(idMsg);
  msg.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${texto}`;
  msg.style.display = "block";
}

// Deixa o botão em "carregando" enquanto espera o servidor.
function carregando(btn, ativo, texto) {
  if (ativo) btn.dataset.texto = btn.innerHTML;
  btn.disabled = ativo;
  btn.innerHTML = ativo ? `<i class="fa-solid fa-spinner spin"></i> ${texto}` : btn.dataset.texto;
}

// Link "Esqueci a senha"
function esqueciSenha(ev) {
  if (ev) ev.preventDefault();
  const login = document.querySelector('#form-login [name="email"]').value.trim();
  document.querySelector('#form-recuperar [name="usuario"]').value = login;
  mostrarTela("view-recuperar");
}

// Link "Voltar ao login"
function voltarLogin(ev) {
  if (ev) ev.preventDefault();
  document.getElementById("form-codigo").reset();
  mostrarTela("view-login");
}

// Passo 1 -> 2: guarda o usuário e pede o e-mail
document.getElementById("form-recuperar").addEventListener("submit", (e) => {
  e.preventDefault();
  recuperacao.usuario = e.target.usuario.value.trim();
  if (!recuperacao.usuario) return;
  mostrarTela("view-email");
});

// Passo 2 -> 3: envia o código para o e-mail digitado
document.getElementById("form-email").addEventListener("submit", async (e) => {
  e.preventDefault();
  recuperacao.email = e.target.email.value.trim();
  const btn = document.getElementById("btn-enviar-codigo");
  carregando(btn, true, "Enviando…");
  try {
    await API.post("/api/esqueci-senha/enviar-codigo", recuperacao);
    document.getElementById("codigo-sub").textContent =
      `Se o e-mail ${recuperacao.email} for o cadastrado neste usuário, você vai receber um código ` +
      `em instantes (confira também o spam). Digite o código e escolha uma nova senha.`;
    mostrarTela("view-codigo");
  } catch (err) {
    mostrarErro("email-msg", err.message || "Não foi possível enviar o código. Tente novamente.");
  }
  carregando(btn, false);
});

// Passo 3: confere o código e grava a nova senha
document.getElementById("form-codigo").addEventListener("submit", async (e) => {
  e.preventDefault();
  const codigo = e.target.codigo.value.replace(/\D/g, "");
  const senha = e.target.senha.value;
  if (codigo.length !== 6) return mostrarErro("codigo-msg", "O código tem 6 números.");
  if (senha.length < 6) return mostrarErro("codigo-msg", "A nova senha precisa ter pelo menos 6 caracteres.");
  if (senha !== e.target.confirmar.value) return mostrarErro("codigo-msg", "As senhas não conferem.");

  const btn = document.getElementById("btn-redefinir");
  carregando(btn, true, "Salvando…");
  try {
    await API.post("/api/esqueci-senha/redefinir", { usuario: recuperacao.usuario, codigo, senha });
    e.target.reset();
    document.querySelector('#form-login [name="email"]').value = recuperacao.usuario;
    document.querySelector('#form-login [name="senha"]').value = "";
    mostrarTela("view-concluido");
  } catch (err) {
    mostrarErro("codigo-msg", err.message || "Código inválido ou expirado.");
  }
  carregando(btn, false);
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
