/*
 * whatsapp.js — abre o WhatsApp direto, sem a página intermediária
 * "Conversar com ... no WhatsApp" (api.whatsapp.com / wa.me).
 *
 * Como funciona:
 *   - No COMPUTADOR, qualquer link wa.me / api.whatsapp.com/send aberto pelo
 *     sistema (window.open ou <a href>) é trocado por web.whatsapp.com/send,
 *     que já abre a conversa com a mensagem preenchida. Todas as mensagens
 *     usam a mesma aba ("whatsapp_web"), em vez de abrir uma aba nova a cada envio.
 *   - No CELULAR, mantém o wa.me, que abre direto o aplicativo
 *     (o WhatsApp Web não funciona no celular).
 *
 * Carregue este arquivo ANTES dos outros scripts da página.
 * Uso direto (opcional):  WhatsApp.abrir("35999010261", "Olá!")
 */
(function () {
  "use strict";
  if (window.WhatsApp) return;

  const ABA = "whatsapp_web";
  const celular = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
  const openOriginal = window.open.bind(window);

  const soDigitos = (v) => String(v || "").replace(/\D/g, "");

  function normalizarFone(fone) {
    let f = soDigitos(fone);
    if (!f) return "";
    if (!(f.startsWith("55") && f.length >= 12)) f = "55" + f;
    return f;
  }

  function montar(fone, texto) {
    const f = normalizarFone(fone);
    const t = texto ? encodeURIComponent(texto) : "";
    if (celular) {
      return `https://wa.me/${f}${t ? "?text=" + t : ""}`;
    }
    const partes = [];
    if (f) partes.push("phone=" + f);
    if (t) partes.push("text=" + t);
    return "https://web.whatsapp.com/send" + (partes.length ? "?" + partes.join("&") : "");
  }

  // Converte um link wa.me / api.whatsapp.com em link direto. Devolve null
  // se não for um link de WhatsApp (aí o link segue como está).
  function converter(url) {
    if (celular || !url) return null;
    let u;
    try { u = new URL(String(url), location.href); } catch (_) { return null; }
    const host = u.hostname.replace(/^www\./, "");
    let fone = "", texto = "";
    if (host === "wa.me") {
      fone = u.pathname;
      texto = u.searchParams.get("text") || "";
    } else if ((host === "api.whatsapp.com" || host === "whatsapp.com") && u.pathname.startsWith("/send")) {
      fone = u.searchParams.get("phone") || "";
      texto = u.searchParams.get("text") || "";
    } else {
      return null;
    }
    return montar(fone, texto);
  }

  function abrir(fone, texto) {
    const url = montar(fone, texto);
    return openOriginal(url, celular ? "_blank" : ABA);
  }

  // Abre uma janela já no clique (evita bloqueio de pop-up quando a mensagem
  // só fica pronta depois de um await). Use: const j = WhatsApp.reservar();
  // ... depois: WhatsApp.enviar(j, fone, texto)
  function reservar() {
    return openOriginal("", celular ? "_blank" : ABA);
  }
  function enviar(janela, fone, texto) {
    const url = montar(fone, texto);
    if (janela && !janela.closed) { janela.location.href = url; return janela; }
    return openOriginal(url, celular ? "_blank" : ABA);
  }

  // Intercepta window.open de qualquer tela do sistema
  window.open = function (url, alvo, recursos) {
    const direto = converter(url);
    if (direto) return openOriginal(direto, ABA, recursos);
    return openOriginal.apply(window, arguments);
  };

  // Intercepta links <a href="https://wa.me/..."> clicados
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0) return;
    const a = e.target && e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    const direto = converter(a.href);
    if (!direto) return;
    e.preventDefault();
    openOriginal(direto, ABA);
  }, true);

  window.WhatsApp = { abrir, reservar, enviar, converter, montar };
})();
