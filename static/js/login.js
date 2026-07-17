/* =======================================================================
   login.js — Lógica da tela de login
   -----------------------------------------------------------------------
   Envia as credenciais para POST /api/login. Em caso de sucesso, o backend
   grava a sessão (cookie) e o usuário é redirecionado ao dashboard.
   Também controla o botão de mostrar/ocultar senha e o link "esqueci senha".
   ======================================================================= */

// Se já houver sessão ativa, pula direto para o dashboard.
(async () => {
  try {
    await API.get("/api/me");
    location.href = "/dashboard";
  } catch (_) {
    /* sem sessão: permanece no login */
  }
})();

// Preenche o e-mail lembrado (se o usuário marcou "lembrar acesso" antes).
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
    toast("Informe e-mail e senha", "warning");
    return;
  }

  // Guarda (ou limpa) o e-mail conforme o "lembrar acesso".
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

// Esqueci a senha (estrutura preparada — integração de e-mail é futura)
function esqueciSenha(ev) {
  ev.preventDefault();
  Modal.abrir(
    "Recuperar senha",
    `<p class="text-muted">Informe seu e-mail e o administrador da oficina
     receberá um pedido de redefinição de senha.</p>
     <div class="field"><label>E-mail</label>
       <input type="email" id="rec-email" placeholder="voce@oficina.com"></div>
     <p class="text-muted" style="font-size:.82rem;margin-top:.6rem">
       Dica: no acesso de teste use <b>admin@oficina.com</b> / <b>admin123</b>.</p>`,
    `<button class="btn btn--ghost" onclick="Modal.fechar()">Fechar</button>
     <button class="btn btn--primary" onclick="toast('Solicitação registrada. Procure o administrador.');Modal.fechar()">
       <i class="fa-solid fa-paper-plane"></i> Enviar</button>`
  );
}

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
