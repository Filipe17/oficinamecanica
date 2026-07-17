/* =======================================================================
   usuarios.js — Página de Usuários (Crud genérico)
   Apenas administradores/gerentes conseguem gravar (o backend valida).
   ======================================================================= */
(async () => {
  await Layout.iniciar("usuarios", "Usuários");

  const PERFIS = [
    ["administrador", "Administrador"],
    ["gerente", "Gerente"],
    ["mecanico", "Mecânico"],
    ["atendente", "Atendente"],
    ["financeiro", "Financeiro"],
    ["caixa", "Caixa"],
  ];

  const crud = new Crud({
    endpoint: "/api/usuarios",
    titulo: "Usuários",
    singular: "Usuário",
    subtitulo: "Controle de acesso e permissões da equipe",
    paginado: false,
    colunas: [
      { chave: "nome", titulo: "Nome" },
      { chave: "email", titulo: "E-mail" },
      { chave: "perfil", titulo: "Perfil", render: (v) => `<span class="badge">${v}</span>` },
      { chave: "ativo", titulo: "Situação", render: (v) =>
          v ? `<span class="badge badge--success">Ativo</span>`
            : `<span class="badge badge--danger">Inativo</span>` },
    ],
    campos: [
      { nome: "nome", label: "Nome", obrigatorio: true, larguraTotal: true },
      { nome: "email", label: "E-mail", tipo: "email", obrigatorio: true },
      { nome: "perfil", label: "Perfil", tipo: "select", opcoes: PERFIS },
      { nome: "senha", label: "Senha (deixe em branco para manter)", tipo: "password" },
    ],
  });
  crud.montar();
})();
