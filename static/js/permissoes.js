/* =======================================================================
   permissoes.js — Tela de Permissões (somente administrador)
   Matriz Perfil × Módulo, cada célula com o nível: Nenhum / Visualizar / Completo.
   ======================================================================= */
(async () => {
  await Layout.iniciar("permissoes", "Permissões");

  // Segurança extra no front (o backend também bloqueia): só admin acessa.
  if (Layout.usuario?.perfil !== "administrador") {
    Layout.set(`<div class="empty"><i class="fa-solid fa-lock"></i>Acesso restrito ao administrador.</div>`);
    return;
  }

  const ROTULO_MODULO = {
    dashboard: "Dashboard", clientes: "Clientes", veiculos: "Veículos",
    ordem_servico: "Ordem de Serviço / Orçamentos", servicos: "Serviços",
    produtos: "Produtos", estoque: "Estoque", xml: "Importação XML",
    financeiro: "Financeiro / Cobranças", pdv: "PDV", relatorios: "Relatórios",
    usuarios: "Usuários", logs: "Logs",
  };
  const ROTULO_PERFIL = {
    gerente: "Gerente", atendente: "Atendente", mecanico: "Mecânico",
    financeiro: "Financeiro", caixa: "Caixa",
  };
  const NIVEIS = [[0, "Nenhum"], [1, "Visualizar"], [2, "Completo"]];

  let dados;
  try {
    dados = await API.get("/api/permissoes");
  } catch (e) {
    Layout.set(`<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`);
    return;
  }
  const { modulos, perfis, permissoes } = dados;

  const selCell = (perfil, modulo, nivel) => `
    <td class="perm-cell">
      <select data-perfil="${perfil}" data-modulo="${modulo}" class="perm-sel n${nivel}">
        ${NIVEIS.map(([v, r]) => `<option value="${v}" ${v === nivel ? "selected" : ""}>${r}</option>`).join("")}
      </select>
    </td>`;

  Layout.set(`
    <div class="page-head">
      <div><h1>Permissões</h1><p>Defina o que cada perfil pode acessar. O administrador tem acesso total.</p></div>
      <button class="btn btn--primary" id="perm-salvar"><i class="fa-solid fa-check"></i> Salvar permissões</button>
    </div>
    <div class="card"><div class="card__body">
      <div class="table-wrap"><table class="data perm-tabela">
        <thead><tr><th>Módulo</th>${perfis.map((p) => `<th>${ROTULO_PERFIL[p] || p}</th>`).join("")}</tr></thead>
        <tbody>
          ${modulos.map((m) => `<tr>
            <td><b>${ROTULO_MODULO[m] || m}</b></td>
            ${perfis.map((p) => selCell(p, m, permissoes[p][m] ?? 0)).join("")}
          </tr>`).join("")}
        </tbody>
      </table></div>
      <p class="text-muted" style="margin-top:12px">
        <b>Nenhum</b>: não vê o item. &nbsp; <b>Visualizar</b>: só consulta. &nbsp;
        <b>Completo</b>: cria, edita e exclui.</p>
    </div></div>
  `);

  // Colore o select conforme o nível escolhido
  const pintar = (sel) => { sel.className = "perm-sel n" + sel.value; };
  document.querySelectorAll(".perm-sel").forEach((s) => s.addEventListener("change", () => pintar(s)));

  document.getElementById("perm-salvar").onclick = async () => {
    const matriz = {};
    document.querySelectorAll(".perm-sel").forEach((s) => {
      const p = s.dataset.perfil, m = s.dataset.modulo;
      (matriz[p] = matriz[p] || {})[m] = parseInt(s.value, 10);
    });
    try {
      await API.post("/api/permissoes", { permissoes: matriz });
      toast("Permissões salvas. Os usuários verão as mudanças no próximo login/atualização.");
    } catch (e) { toast(e.message, "error"); }
  };
})();
