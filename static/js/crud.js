/* =======================================================================
   crud.js — Componente genérico de listagem + cadastro (CRUD)
   -----------------------------------------------------------------------
   Recebe uma configuração declarativa e monta: toolbar com busca, botão
   "Novo", tabela com ordenação, paginação e modal de cadastro/edição.
   Usado por clientes, veículos, produtos e serviços — cada página só
   descreve seus campos e colunas, sem repetir lógica de tabela/modal.

   config = {
     endpoint: "/api/clientes",
     titulo: "Clientes",
     colunas: [{ chave, titulo, render? }],
     campos:  [{ nome, label, tipo?, opcoes?, obrigatorio?, larguraTotal? }],
     paginado: true|false,   // se a API devolve {dados,total,...}
   }
   ======================================================================= */

/* -----------------------------------------------------------------------
   Máscaras de digitação e busca de CEP (reutilizáveis).
   Aplicadas via config do campo: { mascara: "cpf_cnpj" | "telefone" | "cep" }
   e { cep: true } para o campo que dispara a busca de endereço.
   ----------------------------------------------------------------------- */
const Mascaras = {
  cpf_cnpj(v) {
    v = (v || "").replace(/\D/g, "").slice(0, 14);
    if (v.length <= 11) {
      // CPF: 000.000.000-00
      return v
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    }
    // CNPJ: 00.000.000/0000-00
    return v
      .replace(/(\d{2})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1/$2")
      .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
  },
  telefone(v) {
    v = (v || "").replace(/\D/g, "").slice(0, 11);
    if (v.length <= 10) {
      // Fixo: (00) 0000-0000
      return v
        .replace(/(\d{2})(\d)/, "($1) $2")
        .replace(/(\d{4})(\d{1,4})$/, "$1-$2");
    }
    // Celular: (00) 00000-0000
    return v
      .replace(/(\d{2})(\d)/, "($1) $2")
      .replace(/(\d{5})(\d{1,4})$/, "$1-$2");
  },
  cep(v) {
    v = (v || "").replace(/\D/g, "").slice(0, 8);
    return v.replace(/(\d{5})(\d{1,3})$/, "$1-$2");
  },
  aplicar(tipo, valor) {
    return typeof this[tipo] === "function" ? this[tipo](valor) : valor;
  },
  // Busca o endereço no ViaCEP e preenche os campos do formulário por nome.
  async buscarCep(cep, form) {
    const num = (cep || "").replace(/\D/g, "");
    if (num.length !== 8) return;
    try {
      const resp = await fetch(`https://viacep.com.br/ws/${num}/json/`);
      const d = await resp.json();
      if (d.erro) { toast("CEP não encontrado", "warning"); return; }
      // O container é uma <div> (não <form>), então buscamos por [name="..."].
      const campo = (nome) => form.querySelector(`[name="${nome}"]`);
      const set = (nome, val) => { const el = campo(nome); if (el && val) el.value = val; };
      set("endereco", d.logradouro);
      set("bairro", d.bairro);
      set("cidade", d.localidade);
      set("estado", d.uf);
      // Foca no número, que o ViaCEP não fornece.
      const numEl = campo("numero");
      if (numEl) numEl.focus();
    } catch (_) { /* offline ou serviço fora: ignora silenciosamente */ }
  },
};

class Crud {
  constructor(config) {
    this.cfg = config;
    this.pagina = 1;
    this.q = "";
    this.ordem = config.ordemPadrao || null;
  }

  montar(alvo = "conteudo") {
    document.getElementById(alvo).innerHTML = `
      <div class="page-head">
        <div><h1>${this.cfg.titulo}</h1><p>${this.cfg.subtitulo || ""}</p></div>
        <button class="btn btn--primary" id="crud-novo">
          <i class="fa-solid fa-plus"></i> Novo
        </button>
      </div>
      <div class="card">
        <div class="card__body">
          <div class="toolbar">
            <div class="toolbar__search">
              <i class="fa-solid fa-magnifying-glass"></i>
              <input id="crud-busca" placeholder="Pesquisar…" autocomplete="off">
            </div>
          </div>
          <div id="crud-tabela"><div class="loading"><i class="fa-solid fa-spinner spin"></i></div></div>
          <div id="crud-paginacao"></div>
        </div>
      </div>`;

    document.getElementById("crud-novo").onclick = () => this.abrirForm();
    document.getElementById("crud-busca").oninput = debounce((e) => {
      this.q = e.target.value.trim(); this.pagina = 1; this.carregar();
    });
    this.carregar();
  }

  async carregar() {
    const params = new URLSearchParams();
    if (this.q) params.set("q", this.q);
    if (this.cfg.paginado) { params.set("pagina", this.pagina); params.set("por_pagina", 15); }
    if (this.ordem) params.set("ordem", this.ordem);

    try {
      const r = await API.get(`${this.cfg.endpoint}?${params}`);
      const dados = this.cfg.paginado ? r.dados : (r.dados || r);
      this.render(dados, r);
    } catch (e) {
      document.getElementById("crud-tabela").innerHTML =
        `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${e.message}</div>`;
    }
  }

  render(dados, meta) {
    const alvo = document.getElementById("crud-tabela");
    if (!dados || !dados.length) {
      alvo.innerHTML = `<div class="empty"><i class="fa-solid fa-inbox"></i>Nenhum registro encontrado</div>`;
      document.getElementById("crud-paginacao").innerHTML = "";
      return;
    }
    const cabecalho = this.cfg.colunas.map((c) => `<th>${c.titulo}</th>`).join("") + "<th></th>";
    const linhas = dados.map((row) => {
      const celulas = this.cfg.colunas.map((c) => {
        const val = c.render ? c.render(row[c.chave], row) : (row[c.chave] ?? "-");
        return `<td>${val}</td>`;
      }).join("");
      return `<tr>
        ${celulas}
        <td class="text-right">
          <button class="icon-btn btn--sm" title="Editar" onclick='window.__crud.abrirForm(${JSON.stringify(row).replace(/'/g, "&#39;")})'>
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="icon-btn btn--sm" title="Excluir" onclick="window.__crud.excluir(${row.id})">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td></tr>`;
    }).join("");

    alvo.innerHTML = `<div class="table-wrap"><table class="data">
      <thead><tr>${cabecalho}</tr></thead><tbody>${linhas}</tbody></table></div>`;

    window.__crud = this;   // permite os onclick inline acima

    // Paginação (quando aplicável)
    if (this.cfg.paginado && meta.paginas > 1) {
      document.getElementById("crud-paginacao").innerHTML = `
        <div class="pagination">
          <span class="pagination__info">
            Página ${meta.pagina} de ${meta.paginas} — ${meta.total} registros
          </span>
          <div class="pagination__ctrls">
            <button class="btn btn--ghost btn--sm" ${meta.pagina <= 1 ? "disabled" : ""}
              onclick="window.__crud.irPagina(${meta.pagina - 1})"><i class="fa-solid fa-chevron-left"></i></button>
            <button class="btn btn--ghost btn--sm" ${meta.pagina >= meta.paginas ? "disabled" : ""}
              onclick="window.__crud.irPagina(${meta.pagina + 1})"><i class="fa-solid fa-chevron-right"></i></button>
          </div>
        </div>`;
    } else {
      document.getElementById("crud-paginacao").innerHTML = "";
    }
  }

  irPagina(p) { this.pagina = p; this.carregar(); }

  abrirForm(registro = null) {
    const ed = registro && registro.id;
    const campos = this.cfg.campos.map((f) => this._campoHtml(f, registro)).join("");
    Modal.abrir(
      `${ed ? "Editar" : "Novo"} — ${this.cfg.singular || this.cfg.titulo}`,
      `<div class="form-grid" id="crud-form">${campos}</div>`,
      `<button class="btn btn--ghost" onclick="Modal.fechar()">Cancelar</button>
       <button class="btn btn--primary" id="crud-salvar"><i class="fa-solid fa-check"></i> Salvar</button>`,
      this.cfg.modalGrande
    );
    document.getElementById("crud-salvar").onclick = () => this.salvar(ed ? registro.id : null);
    this._aplicarMascaras();
    window.__crud = this;
  }

  // Liga as máscaras de digitação e a busca de CEP nos campos configurados.
  _aplicarMascaras() {
    const form = document.getElementById("crud-form");
    if (!form) return;
    form.querySelectorAll("[data-mascara]").forEach((inp) => {
      const tipo = inp.dataset.mascara;
      const aplicar = () => { inp.value = Mascaras.aplicar(tipo, inp.value); };
      if (inp.value) aplicar();                 // formata valor já existente (edição)
      inp.addEventListener("input", aplicar);
    });
    const cepInp = form.querySelector("[data-cep]");
    if (cepInp) {
      cepInp.addEventListener("input", () => { cepInp.value = Mascaras.cep(cepInp.value); });
      cepInp.addEventListener("blur", () => Mascaras.buscarCep(cepInp.value, form));
    }
  }

  _campoHtml(f, registro) {
    const val = registro ? (registro[f.nome] ?? "") : "";
    const cls = f.larguraTotal ? "field col-2" : "field";
    let input;
    if (f.tipo === "select") {
      const ops = (f.opcoes || []).map((o) => {
        const [v, t] = Array.isArray(o) ? o : [o, o];
        return `<option value="${v}" ${String(v) === String(val) ? "selected" : ""}>${t}</option>`;
      }).join("");
      input = `<select name="${f.nome}">${ops}</select>`;
    } else if (f.tipo === "textarea") {
      input = `<textarea name="${f.nome}">${val}</textarea>`;
    } else {
      const extra = [
        f.obrigatorio ? "required" : "",
        f.mascara ? `data-mascara="${f.mascara}"` : "",
        f.cep ? `data-cep="1"` : "",
        f.placeholder ? `placeholder="${f.placeholder}"` : "",
      ].filter(Boolean).join(" ");
      input = `<input type="${f.tipo || "text"}" name="${f.nome}" value="${val}" ${extra}>`;
    }
    return `<div class="${cls}"><label>${f.label}${f.obrigatorio ? " *" : ""}</label>${input}</div>`;
  }

  _coletar() {
    const dados = {};
    document.querySelectorAll("#crud-form [name]").forEach((el) => {
      dados[el.name] = el.value;
    });
    return dados;
  }

  async salvar(id) {
    const dados = this._coletar();
    // Validação simples no front (o backend também valida)
    for (const f of this.cfg.campos) {
      if (f.obrigatorio && !dados[f.nome]) {
        toast(`Preencha o campo "${f.label}"`, "warning");
        return;
      }
    }
    try {
      if (id) await API.put(`${this.cfg.endpoint}/${id}`, dados);
      else await API.post(this.cfg.endpoint, dados);
      toast("Registro salvo com sucesso");
      Modal.fechar();
      this.carregar();
    } catch (e) { toast(e.message, "error"); }
  }

  async excluir(id) {
    if (!confirm("Confirma a exclusão deste registro?")) return;
    try {
      await API.del(`${this.cfg.endpoint}/${id}`);
      toast("Registro excluído");
      this.carregar();
    } catch (e) { toast(e.message, "error"); }
  }
}
