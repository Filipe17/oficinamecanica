/* =======================================================================
   nps.js — Painel de NPS (Net Promoter Score) / Avaliações pós-serviço
   ======================================================================= */
(async () => {
  await Layout.iniciar("nps", "NPS / Avaliações");

  Layout.set(`
    <div class="page-head">
      <div><h1>NPS / Avaliações</h1>
        <p>Feedback dos clientes após o serviço</p></div>
    </div>

    <div class="stat-grid" id="nps-resumo"></div>

    <div class="card" style="margin-bottom:1rem"><div class="card__body">
      <div class="tabs" id="nps-tabs">
        <button class="tab active" data-filtro="">Todas</button>
        <button class="tab" data-filtro="1">Respondidas</button>
        <button class="tab" data-filtro="0">Aguardando</button>
      </div>
    </div></div>

    <div class="card"><div class="card__body">
      <div id="nps-lista">
        <div class="loading"><i class="fa-solid fa-spinner spin"></i></div>
      </div>
    </div></div>
  `);

  let _filtro = "";

  function _cor(nota) {
    if (nota === null || nota === undefined) return "#aaa";
    if (nota >= 9) return "#22c55e";
    if (nota >= 7) return "#f59e0b";
    return "#ef4444";
  }
  function _label(nota) {
    if (nota === null || nota === undefined) return "—";
    if (nota >= 9) return "Promotor";
    if (nota >= 7) return "Neutro";
    return "Detrator";
  }
  function _emoji(nota) {
    if (nota === null || nota === undefined) return "⏳";
    if (nota >= 9) return "😍";
    if (nota >= 7) return "😊";
    if (nota >= 5) return "😐";
    return "😞";
  }

  async function carregar() {
    const alvo = document.getElementById("nps-lista");
    alvo.innerHTML = `<div class="loading"><i class="fa-solid fa-spinner spin"></i></div>`;
    try {
      const r = await API.get(`/api/nps?respondidas=${_filtro}`);

      // Cards de resumo
      const nps = r.nps_score;
      const corNps = nps === null ? "#aaa" : nps >= 50 ? "#22c55e" : nps >= 0 ? "#f59e0b" : "#ef4444";
      document.getElementById("nps-resumo").innerHTML = `
        <div class="stat">
          <div class="stat__icon" style="background:${corNps}20;color:${corNps}">
            <i class="fa-solid fa-star"></i></div>
          <div class="stat__body">
            <div class="stat__value" style="color:${corNps}">${nps !== null ? nps : "—"}</div>
            <div class="stat__label">NPS Score</div>
          </div>
        </div>
        <div class="stat">
          <div class="stat__icon" style="background:#22c55e20;color:#22c55e">
            <i class="fa-solid fa-face-smile"></i></div>
          <div class="stat__body">
            <div class="stat__value" style="color:#22c55e">${r.media !== null ? r.media : "—"}</div>
            <div class="stat__label">Média das notas</div>
          </div>
        </div>
        <div class="stat">
          <div class="stat__icon" style="background:#22c55e20;color:#22c55e">
            <i class="fa-solid fa-thumbs-up"></i></div>
          <div class="stat__body">
            <div class="stat__value">${r.promotores}</div>
            <div class="stat__label">Promotores (9-10)</div>
          </div>
        </div>
        <div class="stat">
          <div class="stat__icon" style="background:#ef444420;color:#ef4444">
            <i class="fa-solid fa-thumbs-down"></i></div>
          <div class="stat__body">
            <div class="stat__value">${r.detratores}</div>
            <div class="stat__label">Detratores (0-6)</div>
          </div>
        </div>
        <div class="stat">
          <div class="stat__icon"><i class="fa-solid fa-hourglass-half"></i></div>
          <div class="stat__body">
            <div class="stat__value">${r.total - r.respondidas}</div>
            <div class="stat__label">Aguardando resposta</div>
          </div>
        </div>`;

      const lista = r.dados || [];
      if (!lista.length) {
        alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-inbox"></i>
          Nenhuma pesquisa encontrada</div>`;
        return;
      }

      alvo.innerHTML = `<div class="table-wrap"><table class="data">
        <thead><tr>
          <th>Cliente</th><th>OS</th><th>Enviado</th>
          <th>Nota</th><th>Perfil</th><th>Comentário</th><th>Ações</th>
        </tr></thead>
        <tbody>${lista.map((p) => {
          const nota = p.nota;
          const cor = _cor(nota);
          return `<tr>
            <td><strong>${p.cliente_nome || "—"}</strong></td>
            <td>${p.os_numero || "—"}</td>
            <td>${fmt.data(p.enviado_em)}</td>
            <td style="text-align:center">
              ${nota !== null && nota !== undefined
                ? `<span style="display:inline-flex;align-items:center;justify-content:center;
                    width:36px;height:36px;border-radius:50%;background:${cor}20;
                    color:${cor};font-weight:900;font-size:1.1rem">${nota}</span>`
                : `<span style="color:#aaa">⏳</span>`}
            </td>
            <td>
              ${nota !== null && nota !== undefined
                ? `<span style="font-size:.75rem;padding:2px 8px;border-radius:99px;
                    background:${cor}20;color:${cor};font-weight:600">
                    ${_emoji(nota)} ${_label(nota)}</span>`
                : `<span style="color:#aaa;font-size:.8rem">Não respondeu</span>`}
            </td>
            <td style="max-width:200px;font-size:.82rem;color:var(--text-muted)">
              ${p.comentario ? `"${p.comentario.slice(0,80)}${p.comentario.length>80?"…":""}"` : "—"}
            </td>
            <td style="white-space:nowrap">
              <button class="icon-btn btn--sm" title="Copiar link"
                onclick="window.__nps.copiarLink('${p.token}')">
                <i class="fa-solid fa-link"></i>
              </button>
              ${!p.respondido_em && p.canal === 'email' ? `
                <button class="icon-btn btn--sm" title="Reenviar email"
                  onclick="window.__nps.reenviar(${p.id}, ${p.os_id}, ${p.cliente_id})">
                  <i class="fa-solid fa-paper-plane"></i>
                </button>` : ""}
            </td>
          </tr>`;
        }).join("")}
        </tbody></table></div>`;

    } catch(e) {
      document.getElementById("nps-lista").innerHTML =
        `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
    }
  }

  document.getElementById("nps-tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tab"); if (!b) return;
    document.querySelectorAll("#nps-tabs .tab").forEach((t) => t.classList.remove("active"));
    b.classList.add("active");
    _filtro = b.dataset.filtro;
    carregar();
  });

  window.__nps = {
    copiarLink(token) {
      const link = `${location.origin}/nps/${token}`;
      navigator.clipboard?.writeText(link).then(() => toast("Link copiado!"))
        .catch(() => { prompt("Copie o link:", link); });
    },

    async reenviar(id, osId, clienteId) {
      try {
        await API.post("/api/nps/enviar", { os_id: osId, cliente_id: clienteId, canal: "email" });
        toast("Pesquisa reenviada");
      } catch(e) { toast(e.message, "error"); }
    },
  };

  // Expõe para a OS poder abrir o modal de envio de NPS
  window.__nps.abrirEnvio = async function(osId, clienteId, clienteNome, clienteEmail, clienteWhatsapp) {
    Modal.abrir(
      `<i class="fa-solid fa-star"></i> Enviar Pesquisa NPS`,
      `<p style="color:var(--text-muted);font-size:.85rem;margin-bottom:1rem">
        Envie uma pesquisa de satisfação para <strong>${clienteNome}</strong>
        após o serviço.
      </p>
      <div class="form-grid" id="nps-envio-form">
        <div class="field col-2"><label>Canal de envio</label>
          <select id="nps-canal">
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp (link)</option>
            <option value="link">Só gerar link</option>
          </select>
        </div>
        <div class="field col-2" id="nps-email-wrap">
          <label>Email do cliente</label>
          <input id="nps-email-dest" type="email" value="${clienteEmail || ""}"
            placeholder="email@cliente.com.br">
        </div>
      </div>`,
      `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
       <button class="btn btn--primary" id="nps-envio-btn">
         <i class="fa-solid fa-paper-plane"></i> Enviar
       </button>`
    );

    document.getElementById("nps-canal").onchange = () => {
      const canal = document.getElementById("nps-canal").value;
      document.getElementById("nps-email-wrap").style.display =
        canal === "email" ? "" : "none";
    };

    document.getElementById("nps-envio-btn").onclick = async () => {
      const canal = document.getElementById("nps-canal").value;
      const email = document.getElementById("nps-email-dest")?.value.trim();
      const btn = document.getElementById("nps-envio-btn");
      btn.disabled = true;
      btn.innerHTML = `<i class="fa-solid fa-spinner spin"></i> Enviando…`;
      try {
        const r = await API.post("/api/nps/enviar", {
          os_id: osId, cliente_id: clienteId, canal, email,
        });
        if (canal === "whatsapp" && r.whatsapp_link) {
          window.open(r.whatsapp_link, "_blank");
          toast("Link do WhatsApp aberto");
        } else if (canal === "link") {
          navigator.clipboard?.writeText(r.link);
          toast("Link copiado para a área de transferência");
        } else {
          toast("Pesquisa enviada por email");
        }
        Modal.fechar();
      } catch(e) {
        toast(e.message, "error");
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Enviar`;
      }
    };
  };

  carregar();
})();
