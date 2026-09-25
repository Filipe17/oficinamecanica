/*
 * whatsapp.js — abre o WhatsApp direto, sem a página intermediária
 * "Conversar com ... no WhatsApp" (api.whatsapp.com / wa.me).
 *
 * Em cada computador o usuário escolhe UMA vez como usa o WhatsApp:
 *   - "Aplicativo" -> abre o WhatsApp instalado no Windows/Mac (whatsapp://),
 *                     já na conversa e com a mensagem pronta;
 *   - "WhatsApp Web" -> abre web.whatsapp.com (precisa estar conectado
 *                     NESTE navegador; senão ele pede o QR Code).
 * A escolha fica salva no navegador. No CELULAR usa sempre o wa.me, que abre
 * direto o aplicativo.
 *
 * Qualquer link wa.me / api.whatsapp.com aberto pelo sistema (window.open ou
 * <a href>) passa por aqui automaticamente.
 * Uso direto (opcional):  WhatsApp.abrir("35999010261", "Olá!")
 * Trocar a escolha:       WhatsApp.escolherModo()
 */
(function () {
  "use strict";
  if (window.WhatsApp) return;

  const ABA = "whatsapp_web";
  const CHAVE = "mecprime_whatsapp_modo";
  const celular = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
  const openOriginal = window.open.bind(window);

  const soDigitos = (v) => String(v || "").replace(/\D/g, "");
  function normalizarFone(fone) {
    let f = soDigitos(fone);
    if (!f) return "";
    if (!(f.startsWith("55") && f.length >= 12)) f = "55" + f;
    return f;
  }

  function lerModo() {
    try { const m = localStorage.getItem(CHAVE); return m === "app" || m === "web" ? m : null; }
    catch (_) { return null; }
  }
  function salvarModo(m) { try { localStorage.setItem(CHAVE, m); } catch (_) {} }

  function url(modo, fone, texto) {
    const f = normalizarFone(fone);
    const t = texto ? encodeURIComponent(texto) : "";
    if (modo === "celular") return `https://wa.me/${f}${t ? "?text=" + t : ""}`;
    const q = [];
    if (f) q.push("phone=" + f);
    if (t) q.push("text=" + t);
    const base = modo === "app" ? "whatsapp://send" : "https://web.whatsapp.com/send";
    return base + (q.length ? "?" + q.join("&") : "");
  }

  // Janela "de mentira" devolvida quando não abrimos aba (modo aplicativo),
  // para quem chamou window.open() não quebrar ao usar o retorno.
  const JANELA_FALSA = { closed: false, close() {}, focus() {}, location: {} };

  function abrirComModo(modo, fone, texto, janela) {
    if (modo === "app") {
      if (janela && janela !== JANELA_FALSA && !janela.closed) { try { janela.close(); } catch (_) {} }
      window.location.href = url("app", fone, texto);   // abre o aplicativo, a página fica
      return JANELA_FALSA;
    }
    const u = url("web", fone, texto);
    if (janela && janela !== JANELA_FALSA && !janela.closed) { janela.location.href = u; return janela; }
    return openOriginal(u, ABA) || JANELA_FALSA;
  }

  /* ---------------- Tela de escolha (1ª vez em cada computador) ---------------- */
  function mostrarEscolha(aoEscolher, trocando) {
    const antigo = document.getElementById("wa-escolha");
    if (antigo) antigo.remove();
    const atual = lerModo();
    const fundo = document.createElement("div");
    fundo.id = "wa-escolha";
    fundo.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:99999;" +
      "display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit";
    const botao = (modo, icone, titulo, desc) => `
      <button type="button" data-modo="${modo}" style="display:flex;gap:14px;align-items:center;width:100%;
        text-align:left;padding:14px 16px;margin-top:10px;border-radius:12px;cursor:pointer;background:#fff;
        border:2px solid ${atual === modo ? "#16a34a" : "#e2e8f0"};font:inherit;color:#0f172a">
        <span style="font-size:26px;width:32px;text-align:center">${icone}</span>
        <span><b style="display:block;font-size:15px">${titulo}</b>
        <span style="font-size:13px;color:#64748b">${desc}</span></span>
      </button>`;
    fundo.innerHTML = `
      <div style="background:#fff;border-radius:16px;max-width:440px;width:100%;padding:22px;
        box-shadow:0 20px 50px rgba(0,0,0,.25)">
        <div style="font-size:17px;font-weight:700;color:#0f172a">Como você usa o WhatsApp neste computador?</div>
        <div style="font-size:13px;color:#64748b;margin-top:4px">A escolha fica salva neste navegador.</div>
        ${botao("app", "💻", "Aplicativo do WhatsApp", "Abre o WhatsApp instalado no computador, já na conversa.")}
        ${botao("web", "🌐", "WhatsApp Web", "Abre no navegador. Precisa estar conectado neste navegador (QR Code).")}
        <div style="text-align:right;margin-top:14px">
          <button type="button" data-modo="" style="background:none;border:0;color:#64748b;cursor:pointer;font:inherit">
            ${trocando ? "Fechar" : "Cancelar"}</button>
        </div>
      </div>`;
    fundo.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-modo]");
      if (!b) return;
      fundo.remove();
      const modo = b.getAttribute("data-modo");
      if (!modo) return;
      salvarModo(modo);
      if (aoEscolher) aoEscolher(modo);
    });
    document.body.appendChild(fundo);
  }

  /* ---------------- API ---------------- */
  function abrir(fone, texto, janela) {
    if (celular) return openOriginal(url("celular", fone, texto), "_blank") || JANELA_FALSA;
    const modo = lerModo();
    if (modo) return abrirComModo(modo, fone, texto, janela);
    if (janela && janela !== JANELA_FALSA && !janela.closed) { try { janela.close(); } catch (_) {} }
    mostrarEscolha((m) => abrirComModo(m, fone, texto));   // o clique na escolha libera o pop-up
    return JANELA_FALSA;
  }

  // Para telas que só montam a mensagem depois de um await: reserva a aba no
  // clique (só no modo WhatsApp Web, que abre aba) e envia depois.
  function reservar() {
    if (!celular && lerModo() === "web") return openOriginal("", ABA);
    return null;
  }
  function enviar(janela, fone, texto) { return abrir(fone, texto, janela); }

  // Extrai telefone e texto de um link wa.me / api.whatsapp.com (ou null).
  function lerLink(link) {
    if (!link) return null;
    let u;
    try { u = new URL(String(link), location.href); } catch (_) { return null; }
    const host = u.hostname.replace(/^www\./, "");
    if (host === "wa.me") return { fone: u.pathname, texto: u.searchParams.get("text") || "" };
    if ((host === "api.whatsapp.com" || host === "whatsapp.com") && u.pathname.startsWith("/send"))
      return { fone: u.searchParams.get("phone") || "", texto: u.searchParams.get("text") || "" };
    return null;
  }

  // Intercepta window.open de qualquer tela do sistema
  window.open = function (link) {
    const w = !celular && lerLink(link);
    if (w) return abrir(w.fone, w.texto);
    return openOriginal.apply(window, arguments);
  };

  // Intercepta links <a href="https://wa.me/..."> clicados
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || celular) return;
    const a = e.target && e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    const w = lerLink(a.href);
    if (!w) return;
    e.preventDefault();
    abrir(w.fone, w.texto);
  }, true);

  window.WhatsApp = {
    abrir, reservar, enviar,
    escolherModo: () => mostrarEscolha(null, true),
    modo: lerModo,
    url: (fone, texto) => url(celular ? "celular" : (lerModo() || "web"), fone, texto),
  };
})();
