"""
ordem_servico.py — Ordens de Serviço e Orçamentos.

Um orçamento e uma OS compartilham a mesma tabela (ordens_servico), diferenciados
pela coluna eh_orcamento. Converter orçamento em OS é apenas trocar essa flag.

Ao salvar itens, o total é recalculado no backend (nunca confiar no total do front).
Ao finalizar uma OS, os produtos utilizados dão baixa no estoque e é possível
gerar automaticamente uma conta a receber no financeiro.
"""

from flask import Blueprint, request, jsonify, session
from database.database import query, now, registrar_log
from api.usuarios import login_obrigatorio
from api.estoque import movimentar_estoque

os_bp = Blueprint("ordem_servico", __name__)


@os_bp.route("/api/os/mecanicos", methods=["GET"])
@login_obrigatorio
def listar_mecanicos():
    """
    Lista os usuários com perfil 'mecânico' (id e nome) para preencher o
    seletor de mecânico da OS. Fica sob o prefixo /api/os de propósito: assim
    o próprio mecânico consegue acessá-la sem liberar o cadastro de usuários.
    """
    lista = query("SELECT id, nome FROM usuarios WHERE perfil='mecanico' "
                  "AND ativo=1 ORDER BY nome")
    return jsonify({"dados": lista})


STATUS_VALIDOS = {
    "aberta", "em_analise", "aguardando_aprovacao", "aguardando_pecas",
    "em_execucao", "finalizada_mecanico", "finalizada", "cancelada",
}


def _dono_os(oid):
    """
    True se o usuário logado pode acessar esta OS. Mecânicos só acessam as OS
    em que são o responsável; demais perfis não têm essa restrição.
    """
    if session.get("perfil") != "mecanico":
        return True
    row = query("SELECT mecanico_id FROM ordens_servico WHERE id=?", (oid,), fetchone=True)
    return bool(row) and row["mecanico_id"] == session.get("user_id")


def _proximo_numero():
    """Gera número sequencial no formato OS-000001."""
    r = query("SELECT COUNT(*) AS n FROM ordens_servico", fetchone=True)
    return f"OS-{(r['n'] + 1):06d}"


def _recalcular_total(os_id):
    """Soma os itens, aplica o desconto e grava o total na OS."""
    itens = query("SELECT subtotal FROM os_itens WHERE os_id=?", (os_id,))
    soma = sum(i["subtotal"] or 0 for i in itens)
    os_reg = query("SELECT desconto FROM ordens_servico WHERE id=?",
                   (os_id,), fetchone=True)
    desconto = float(os_reg["desconto"] or 0) if os_reg else 0
    total = max(soma - desconto, 0)
    query("UPDATE ordens_servico SET total=? WHERE id=?", (total, os_id), commit=True)
    return total


@os_bp.route("/api/os", methods=["GET"])
@login_obrigatorio
def listar():
    # eh_orcamento=1 filtra orçamentos; padrão lista ordens de serviço
    eh_orc = request.args.get("orcamento", "0")
    status = request.args.get("status", "").strip()
    q = request.args.get("q", "").strip().upper()

    where = ["o.eh_orcamento = ?"]
    params = [1 if eh_orc == "1" else 0]
    if status:
        where.append("o.status = ?")
        params.append(status)
    if q:
        where.append("(UPPER(o.numero) LIKE ? OR UPPER(c.nome) LIKE ? OR UPPER(v.placa) LIKE ?)")
        params += [f"%{q}%"] * 3

    # Mecânico só enxerga as OS em que ele é o responsável (não as dos colegas).
    # Exceção: notif=1 é usado pelo polling de notificação — mostra todos os
    # orçamentos com cliente_aprovou independente de mecânico atribuído.
    notif = request.args.get("notif", "0") == "1"
    if session.get("perfil") == "mecanico" and not notif:
        where.append("o.mecanico_id = ?")
        params.append(session.get("user_id"))

    clausula = "WHERE " + " AND ".join(where)
    lista = query(
        f"SELECT o.*, c.nome AS cliente_nome, v.placa AS veiculo_placa, "
        f"v.modelo AS veiculo_modelo, u.nome AS mecanico_nome FROM ordens_servico o "
        f"LEFT JOIN clientes c ON c.id=o.cliente_id "
        f"LEFT JOIN veiculos v ON v.id=o.veiculo_id "
        f"LEFT JOIN usuarios u ON u.id=o.mecanico_id "
        f"{clausula} ORDER BY o.id DESC LIMIT 200", params)
    return jsonify({"dados": lista})


@os_bp.route("/api/os/<int:oid>", methods=["GET"])
@login_obrigatorio
def detalhe(oid):
    if not _dono_os(oid):
        return jsonify({"erro": "Esta OS pertence a outro mecânico"}), 403
    o = query(
        "SELECT o.*, c.nome AS cliente_nome, v.placa AS veiculo_placa, "
        "v.modelo AS veiculo_modelo, u.nome AS mecanico_nome "
        "FROM ordens_servico o "
        "LEFT JOIN clientes c ON c.id=o.cliente_id "
        "LEFT JOIN veiculos v ON v.id=o.veiculo_id "
        "LEFT JOIN usuarios u ON u.id=o.mecanico_id WHERE o.id=?",
        (oid,), fetchone=True)
    if not o:
        return jsonify({"erro": "OS não encontrada"}), 404
    o["itens"] = query("SELECT * FROM os_itens WHERE os_id=?", (oid,))
    return jsonify(o)


@os_bp.route("/api/os", methods=["POST"])
@login_obrigatorio
def criar():
    d = request.get_json(force=True)
    eh_orc = int(d.get("eh_orcamento", 0))
    # Se um mecânico cria a OS sem escolher responsável, assume ele mesmo —
    # assim a OS aparece na lista dele (que só mostra as próprias).
    mecanico_id = d.get("mecanico_id")
    if session.get("perfil") == "mecanico" and not mecanico_id:
        mecanico_id = session.get("user_id")
    res = query(
        "INSERT INTO ordens_servico (numero, cliente_id, veiculo_id, mecanico_id, "
        "data, previsao, status, problema, diagnostico, horas_trabalhadas, garantia, "
        "observacoes, validade, forma_pagamento, condicoes, obs_finais, eh_orcamento, "
        "desconto, total, criado_em) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (_proximo_numero(), d.get("cliente_id"), d.get("veiculo_id"),
         mecanico_id, d.get("data", now()), d.get("previsao"),
         d.get("status", "aberta"), d.get("problema"), d.get("diagnostico"),
         d.get("horas_trabalhadas", 0), d.get("garantia"), d.get("observacoes"),
         d.get("validade"), d.get("forma_pagamento"), d.get("condicoes"),
         d.get("obs_finais"), eh_orc, d.get("desconto", 0), 0, now()),
        commit=True,
    )
    oid = res["_lastid"]
    _salvar_itens(oid, d.get("itens", []))
    _recalcular_total(oid)
    registrar_log(session["user_id"], "criar_os", str(oid))
    return jsonify({"ok": True, "id": oid}), 201


@os_bp.route("/api/os/<int:oid>", methods=["PUT"])
@login_obrigatorio
def editar(oid):
    if not _dono_os(oid):
        return jsonify({"erro": "Esta OS pertence a outro mecânico"}), 403
    d = request.get_json(force=True)
    if d.get("status") and d["status"] not in STATUS_VALIDOS:
        return jsonify({"erro": "Status inválido"}), 400
    query(
        "UPDATE ordens_servico SET cliente_id=?, veiculo_id=?, mecanico_id=?, "
        "previsao=?, status=?, problema=?, diagnostico=?, horas_trabalhadas=?, "
        "garantia=?, observacoes=?, validade=?, forma_pagamento=?, condicoes=?, "
        "obs_finais=?, desconto=? WHERE id=?",
        (d.get("cliente_id"), d.get("veiculo_id"), d.get("mecanico_id"),
         d.get("previsao"), d.get("status", "aberta"), d.get("problema"),
         d.get("diagnostico"), d.get("horas_trabalhadas", 0), d.get("garantia"),
         d.get("observacoes"), d.get("validade"), d.get("forma_pagamento"),
         d.get("condicoes"), d.get("obs_finais"), d.get("desconto", 0), oid),
        commit=True,
    )
    if "itens" in d:
        query("DELETE FROM os_itens WHERE os_id=?", (oid,), commit=True)
        _salvar_itens(oid, d["itens"])
    _recalcular_total(oid)
    registrar_log(session["user_id"], "editar_os", str(oid))
    return jsonify({"ok": True})


def _comissao_do_cadastro(tipo, referencia_id):
    """Lê a % de comissão cadastrada no produto/serviço de origem (ou 0)."""
    if not referencia_id:
        return 0
    tabela = "servicos" if tipo == "servico" else "produtos"
    row = query(f"SELECT comissao_percentual FROM {tabela} WHERE id=?",
                (referencia_id,), fetchone=True)
    return (row.get("comissao_percentual") or 0) if row else 0


def _salvar_itens(oid, itens):
    """Grava a lista de itens (produtos/serviços) de uma OS/orçamento."""
    for it in itens:
        qtd = float(it.get("quantidade", 1) or 0)
        vu = float(it.get("valor_unitario", 0) or 0)
        desc = float(it.get("desconto", 0) or 0)
        subtotal = qtd * vu - desc
        # Congela a % de comissão do item no momento da venda: usa o que o front
        # enviar; se não vier, copia do cadastro (produto/serviço). Assim, mudar
        # a % do cadastro depois não altera comissões de OS já lançadas.
        comissao_pct = it.get("comissao_percentual")
        if comissao_pct is None:
            comissao_pct = _comissao_do_cadastro(it.get("tipo"), it.get("referencia_id"))
        query(
            "INSERT INTO os_itens (os_id, tipo, referencia_id, descricao, codigo, "
            "unidade, quantidade, valor_unitario, desconto, subtotal, comissao_percentual) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (oid, it.get("tipo"), it.get("referencia_id"), it.get("descricao"),
             it.get("codigo"), it.get("unidade"), qtd, vu, desc, subtotal,
             float(comissao_pct or 0)),
            commit=True,
        )


def _gerar_comissoes_os(o, oid):
    """
    Gera as comissões do mecânico responsável pela OS.
    Regras (definidas com o cliente):
      - Só gera se houver mecânico definido; sem mecânico, não gera nada.
      - Base de cálculo: valor cheio do item (quantidade × valor_unitário),
        ANTES do desconto.
      - Usa a % congelada em os_itens.comissao_percentual; itens com % 0 são
        ignorados.
      - Uma pessoa por OS (o mecanico_id).
    """
    mecanico_id = o.get("mecanico_id")
    if not mecanico_id:
        return  # sem mecânico -> sem comissão

    # Idempotência: limpa comissões anteriores desta OS antes de regravar.
    query("DELETE FROM comissoes WHERE origem='os' AND origem_id=?", (oid,), commit=True)

    itens = query("SELECT * FROM os_itens WHERE os_id=?", (oid,))
    for it in itens:
        pct = float(it.get("comissao_percentual") or 0)
        if pct <= 0:
            continue
        qtd = float(it.get("quantidade") or 0)
        vu = float(it.get("valor_unitario") or 0)
        base = qtd * vu  # valor cheio, antes do desconto
        valor = round(base * pct / 100, 2)
        if valor <= 0:
            continue
        query(
            "INSERT INTO comissoes (usuario_id, origem, origem_id, os_item_id, "
            "base_calculo, percentual, valor, criado_em) VALUES (?,?,?,?,?,?,?,?)",
            (mecanico_id, "os", oid, it["id"], round(base, 2), pct, valor, now()),
            commit=True,
        )


@os_bp.route("/api/os/<int:oid>/finalizar", methods=["POST"])
@login_obrigatorio
def finalizar(oid):
    """
    Finalização DEFINITIVA (estágio 2): só disponível para admin/gerente/atendente,
    e somente quando a OS estiver com status 'finalizada_mecanico'.
    Baixa estoque, gera comissões e (opcional) cria conta a receber.
    """
    perfil = session.get("perfil")
    if perfil == "mecanico":
        return jsonify({"erro": "Mecânico não pode fazer a finalização definitiva"}), 403
    if not _dono_os(oid):
        return jsonify({"erro": "Acesso negado a esta OS"}), 403
    o = query("SELECT * FROM ordens_servico WHERE id=?", (oid,), fetchone=True)
    if not o:
        return jsonify({"erro": "Registro não encontrado"}), 404
    if o.get("status") == "finalizada":
        return jsonify({"erro": "Este registro já foi finalizado", "ja_finalizada": True}), 400
    if o.get("status") != "finalizada_mecanico" and o.get("eh_orcamento") != 1:
        return jsonify({"erro": "A OS precisa estar com status 'Finalizada pelo mecânico' para finalizar definitivamente"}), 400

    # Baixa de estoque para itens do tipo produto
    itens = query("SELECT * FROM os_itens WHERE os_id=? AND tipo='produto'", (oid,))
    for it in itens:
        if it.get("referencia_id"):
            try:
                movimentar_estoque(it["referencia_id"], "saida", it["quantidade"],
                                   origem="os", documento=o["numero"])
            except ValueError:
                pass  # produto pode ter sido removido; ignora silenciosamente

    query("UPDATE ordens_servico SET status='finalizada' WHERE id=?", (oid,), commit=True)

    # Gera as comissões do mecânico responsável (não gera para orçamento).
    if o.get("eh_orcamento") != 1:
        _gerar_comissoes_os(o, oid)

    # Gera conta a receber APENAS para orçamentos (eh_orcamento=1).
    # OS real nunca lança no financeiro/caixa, mesmo que o front peça.
    # (forma de pagamento fica em aberto: é o caixa que define ao dar baixa)
    d = request.get_json(silent=True) or {}

    # No modo sem_caixa não gera nenhum lançamento financeiro
    from api.configuracoes import obter_config as _cfg
    if (_cfg().get("modo_financeiro") or "completo") == "sem_caixa":
        registrar_log(session["user_id"], "finalizar_os", str(oid))
        return jsonify({"ok": True, "msg": "OS finalizada (modo sem caixa)"})

    if o.get("eh_orcamento") == 1 and d.get("gerar_financeiro"):
        rfin = query(
            "INSERT INTO financeiro (tipo, descricao, cliente_id, os_id, valor, "
            "vencimento, forma_pagamento, status, criado_em) "
            "VALUES ('receber',?,?,?,?,?,?, 'aberto', ?)",
            (f"Orçamento {o['numero']}", o["cliente_id"], oid, o["total"],
             d.get("vencimento", now()), d.get("forma_pagamento"), now()),
            commit=True,
        )
        fin_id = rfin["_lastid"]
        # Se a forma escolhida for boleto, tenta gerar o boleto automaticamente.
        # Falha aqui (ex.: provedor não configurado) NÃO quebra a finalização —
        # a conta a receber fica criada e o boleto pode ser gerado manualmente.
        forma = (d.get("forma_pagamento") or "").lower()
        if "boleto" in forma:
            try:
                from api.boletos import gerar_boleto_interno
                gerar_boleto_interno(fin_id)
            except Exception:
                pass
    # Gera registro de garantia se a OS tiver prazo de garantia informado
    garantia_texto = (o.get("garantia") or "").strip()
    if garantia_texto and o.get("cliente_id"):
        import re as _re
        from datetime import date as _date, timedelta as _td
        # Tenta extrair número de dias/meses do texto (ex: "3 meses", "90 dias", "6 meses")
        dias_gar = None
        m = _re.search(r"(\d+)\s*(mes|mês|meses)", garantia_texto, _re.IGNORECASE)
        if m:
            dias_gar = int(m.group(1)) * 30
        else:
            m = _re.search(r"(\d+)\s*(dia|dias)", garantia_texto, _re.IGNORECASE)
            if m:
                dias_gar = int(m.group(1))
            else:
                m = _re.search(r"(\d+)\s*(ano|anos)", garantia_texto, _re.IGNORECASE)
                if m:
                    dias_gar = int(m.group(1)) * 365
        if dias_gar:
            hoje = _date.today()
            data_fim = (hoje + _td(days=dias_gar)).isoformat()
            # Evita duplicata para a mesma OS
            existe = query("SELECT id FROM garantias WHERE os_id=?", (oid,), fetchone=True)
            if not existe:
                query(
                    "INSERT INTO garantias (os_id, cliente_id, veiculo_id, descricao, "
                    "data_inicio, data_fim, dias_garantia, status, criado_em) "
                    "VALUES (?,?,?,?,?,?,?,?,?)",
                    (oid, o["cliente_id"], o.get("veiculo_id"), garantia_texto,
                     hoje.isoformat(), data_fim, dias_gar, "vigente", now()),
                    commit=True)

    registrar_log(session["user_id"], "finalizar_os", str(oid))
    return jsonify({"ok": True})


@os_bp.route("/api/os/<int:oid>/para-orcamento", methods=["POST"])
@login_obrigatorio
def para_orcamento(oid):
    """
    Gera um Orçamento a partir de uma OS para enviar ao cliente aprovar.

    IMPORTANTE: a OS de origem NÃO é convertida nem some da lista de OS. O
    orçamento é uma CÓPIA (registro novo com eh_orcamento=1); a OS continua
    ativa com status 'aguardando_aprovacao', porque o serviço ainda não
    terminou — o orçamento serve apenas para o cliente aprovar.
    """
    perfil = session.get("perfil")
    if perfil == "mecanico":
        return jsonify({"erro": "Mecânico não pode gerar orçamento"}), 403
    o = query("SELECT * FROM ordens_servico WHERE id=?", (oid,), fetchone=True)
    if not o:
        return jsonify({"erro": "OS não encontrada"}), 404
    if o.get("eh_orcamento") == 1:
        return jsonify({"erro": "Este registro já é um orçamento", "ja_orcamento": True}), 400

    # 1) Cria o registro do orçamento (cópia da OS), com número próprio.
    novo_numero = _proximo_numero()
    r = query(
        "INSERT INTO ordens_servico (numero, cliente_id, veiculo_id, mecanico_id, "
        "data, previsao, status, problema, diagnostico, horas_trabalhadas, garantia, "
        "observacoes, validade, forma_pagamento, condicoes, obs_finais, eh_orcamento, "
        "desconto, total, criado_em) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (novo_numero, o.get("cliente_id"), o.get("veiculo_id"), o.get("mecanico_id"),
         now(), o.get("previsao"), "aberta", o.get("problema"), o.get("diagnostico"),
         o.get("horas_trabalhadas", 0), o.get("garantia"), o.get("observacoes"),
         o.get("validade"), o.get("forma_pagamento"), o.get("condicoes"),
         o.get("obs_finais"), 1, o.get("desconto", 0), 0, now()),
        commit=True,
    )
    orc_id = r["_lastid"]

    # A partir daqui, se algo falhar, apagamos o orçamento recém-criado para
    # não deixar um orçamento "vazio" órfão, e devolvemos a mensagem real do
    # erro (em vez de estourar um 500 genérico no front).
    try:
        # 2) Copia os itens da OS para o orçamento, preenchendo código e valor de
        #    venda a partir do cadastro (na OS as peças ficam com valor_unitario=0
        #    e codigo=null). A peça pode ter sido digitada pelo mecânico sem vínculo
        #    (referencia_id nulo); nesse caso localizamos o produto pelo nome.
        itens = query("SELECT * FROM os_itens WHERE os_id=?", (oid,))
        for it in itens:
            ref_id = it.get("referencia_id")
            codigo = it.get("codigo")
            unidade = it.get("unidade")
            vu = float(it.get("valor_unitario") or 0)
            qtd = float(it.get("quantidade") or 1)
            if it.get("tipo") == "produto":
                prod = None
                if ref_id:
                    prod = query("SELECT id, codigo, preco_venda FROM produtos WHERE id=?",
                                 (ref_id,), fetchone=True)
                if not prod and (it.get("descricao") or "").strip():
                    prod = query("SELECT id, codigo, preco_venda FROM produtos "
                                 "WHERE lower(trim(nome))=lower(trim(?))",
                                 (it["descricao"],), fetchone=True)
                if prod:
                    ref_id = prod.get("id")
                    codigo = prod.get("codigo")
                    unidade = unidade or "UN"
                    if not vu:
                        vu = float(prod.get("preco_venda") or 0)
            desc = float(it.get("desconto") or 0)
            subtotal = round(qtd * vu - desc, 2)
            query(
                "INSERT INTO os_itens (os_id, tipo, referencia_id, descricao, codigo, "
                "unidade, quantidade, valor_unitario, desconto, subtotal, comissao_percentual) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (orc_id, it.get("tipo"), ref_id, it.get("descricao"), codigo, unidade,
                 qtd, vu, desc, subtotal, float(it.get("comissao_percentual") or 0)),
                commit=True,
            )
        _recalcular_total(orc_id)

        # 3) A OS de origem permanece na lista, agora aguardando aprovação do cliente.
        query("UPDATE ordens_servico SET status='aguardando_aprovacao' WHERE id=?",
              (oid,), commit=True)
    except Exception as e:
        # Desfaz o orçamento parcial para não sobrar registro vazio.
        try:
            query("DELETE FROM os_itens WHERE os_id=?", (orc_id,), commit=True)
            query("DELETE FROM ordens_servico WHERE id=?", (orc_id,), commit=True)
        except Exception:
            pass
        import traceback
        traceback.print_exc()
        return jsonify({"erro": f"Falha ao gerar orçamento: {e}"}), 500

    registrar_log(session["user_id"], "os_para_orcamento",
                  f"os={oid} orc={orc_id}")
    return jsonify({
        "ok": True,
        "orcamento_id": orc_id,
        "orcamento_numero": novo_numero,
        "os_numero": o.get("numero"),
    })


@os_bp.route("/api/os/<int:oid>/converter", methods=["POST"])
@login_obrigatorio
def converter_orcamento(oid):
    """Converte um orçamento em Ordem de Serviço (um clique)."""
    query("UPDATE ordens_servico SET eh_orcamento=0, status='aberta' WHERE id=?",
          (oid,), commit=True)
    registrar_log(session["user_id"], "converter_orcamento", str(oid))
    return jsonify({"ok": True})


@os_bp.route("/api/os/<int:oid>", methods=["DELETE"])
@login_obrigatorio
def excluir(oid):
    if not _dono_os(oid):
        return jsonify({"erro": "Esta OS pertence a outro mecânico"}), 403
    query("DELETE FROM os_itens WHERE os_id=?", (oid,), commit=True)
    query("DELETE FROM ordens_servico WHERE id=?", (oid,), commit=True)
    registrar_log(session["user_id"], "excluir_os", str(oid))
    return jsonify({"ok": True})


# =========================================================================
# CHECKLIST DE INSPEÇÃO VEICULAR
# =========================================================================

# Itens padrão do checklist organizados por grupo
CHECKLIST_PADRAO = [
    # Lataria exterior
    {"grupo": "Lataria", "item": "Para-choque dianteiro"},
    {"grupo": "Lataria", "item": "Para-choque traseiro"},
    {"grupo": "Lataria", "item": "Capô"},
    {"grupo": "Lataria", "item": "Porta dianteira esquerda"},
    {"grupo": "Lataria", "item": "Porta dianteira direita"},
    {"grupo": "Lataria", "item": "Porta traseira esquerda"},
    {"grupo": "Lataria", "item": "Porta traseira direita"},
    {"grupo": "Lataria", "item": "Para-lama dianteiro esquerdo"},
    {"grupo": "Lataria", "item": "Para-lama dianteiro direito"},
    {"grupo": "Lataria", "item": "Lateral esquerda"},
    {"grupo": "Lataria", "item": "Lateral direita"},
    {"grupo": "Lataria", "item": "Tampa do porta-malas"},
    {"grupo": "Lataria", "item": "Teto"},
    # Vidros e retrovisores
    {"grupo": "Vidros", "item": "Para-brisa dianteiro"},
    {"grupo": "Vidros", "item": "Para-brisa traseiro"},
    {"grupo": "Vidros", "item": "Vidro porta dianteira esquerda"},
    {"grupo": "Vidros", "item": "Vidro porta dianteira direita"},
    {"grupo": "Vidros", "item": "Retrovisor esquerdo"},
    {"grupo": "Vidros", "item": "Retrovisor direito"},
    {"grupo": "Vidros", "item": "Retrovisor interno"},
    # Pneus e rodas
    {"grupo": "Pneus e Rodas", "item": "Pneu dianteiro esquerdo"},
    {"grupo": "Pneus e Rodas", "item": "Pneu dianteiro direito"},
    {"grupo": "Pneus e Rodas", "item": "Pneu traseiro esquerdo"},
    {"grupo": "Pneus e Rodas", "item": "Pneu traseiro direito"},
    {"grupo": "Pneus e Rodas", "item": "Estepe"},
    {"grupo": "Pneus e Rodas", "item": "Calota/Aro dianteiro esquerdo"},
    {"grupo": "Pneus e Rodas", "item": "Calota/Aro dianteiro direito"},
    {"grupo": "Pneus e Rodas", "item": "Calota/Aro traseiro esquerdo"},
    {"grupo": "Pneus e Rodas", "item": "Calota/Aro traseiro direito"},
    # Elétrica
    {"grupo": "Elétrica", "item": "Farol dianteiro esquerdo"},
    {"grupo": "Elétrica", "item": "Farol dianteiro direito"},
    {"grupo": "Elétrica", "item": "Lanterna traseira esquerda"},
    {"grupo": "Elétrica", "item": "Lanterna traseira direita"},
    {"grupo": "Elétrica", "item": "Seta dianteira esquerda"},
    {"grupo": "Elétrica", "item": "Seta dianteira direita"},
    {"grupo": "Elétrica", "item": "Luz de ré"},
    {"grupo": "Elétrica", "item": "Buzina"},
    {"grupo": "Elétrica", "item": "Limpador de para-brisa"},
    # Interior
    {"grupo": "Interior", "item": "Bancos dianteiros"},
    {"grupo": "Interior", "item": "Bancos traseiros"},
    {"grupo": "Interior", "item": "Painel/Dashboard"},
    {"grupo": "Interior", "item": "Volante"},
    {"grupo": "Interior", "item": "Tapetes"},
    {"grupo": "Interior", "item": "Rádio/Central multimídia"},
    {"grupo": "Interior", "item": "Ar-condicionado"},
    # Documentos
    {"grupo": "Documentos", "item": "CRLV (documento do veículo)"},
    {"grupo": "Documentos", "item": "Manual do proprietário"},
    {"grupo": "Documentos", "item": "Chave reserva"},
    {"grupo": "Documentos", "item": "Macaco e chave de roda"},
]


@os_bp.route("/api/os/<int:oid>/checklist", methods=["GET"])
@login_obrigatorio
def get_checklist(oid):
    """Retorna o checklist da OS. Se não existir, retorna o padrão."""
    itens = query("SELECT * FROM os_checklist WHERE os_id=? ORDER BY id", (oid,))
    if itens:
        return jsonify({"os_id": oid, "itens": itens, "existe": True})
    # Retorna o padrão sem gravar (só grava quando o usuário salvar)
    return jsonify({
        "os_id": oid,
        "itens": [{"id": None, "os_id": oid, "item": i["item"],
                   "grupo": i["grupo"], "status": "nao_verificado", "obs": ""}
                  for i in CHECKLIST_PADRAO],
        "existe": False,
    })


@os_bp.route("/api/os/<int:oid>/checklist", methods=["POST"])
@login_obrigatorio
def salvar_checklist(oid):
    """Salva (cria ou substitui) o checklist da OS."""
    o = query("SELECT id FROM ordens_servico WHERE id=?", (oid,), fetchone=True)
    if not o:
        return jsonify({"erro": "OS não encontrada"}), 404
    d = request.get_json(force=True)
    itens = d.get("itens", [])
    if not itens:
        return jsonify({"erro": "Nenhum item enviado"}), 400
    # Remove itens anteriores e regrava
    query("DELETE FROM os_checklist WHERE os_id=?", (oid,), commit=True)
    for it in itens:
        query(
            "INSERT INTO os_checklist (os_id, item, grupo, status, obs, criado_em) "
            "VALUES (?,?,?,?,?,?)",
            (oid, it.get("item"), it.get("grupo"), it.get("status", "nao_verificado"),
             it.get("obs", ""), now()),
            commit=True,
        )
    avariados = sum(1 for i in itens if i.get("status") == "avariado")
    registrar_log(session["user_id"], "salvar_checklist",
                  f"os={oid} itens={len(itens)} avariados={avariados}")
    return jsonify({"ok": True, "itens": len(itens), "avariados": avariados})


@os_bp.route("/api/os/<int:oid>/retorno", methods=["POST"])
@login_obrigatorio
def criar_os_retorno(oid):
    """
    Cria uma OS de retorno vinculada à OS original (garantia).
    Copia cliente, veículo e mecânico da OS original.
    Marca a garantia como acionada se informada.
    """
    os_orig = query("SELECT * FROM ordens_servico WHERE id=?", (oid,), fetchone=True)
    if not os_orig:
        return jsonify({"erro": "OS de origem não encontrada"}), 404

    d = request.get_json(force=True)
    garantia_id = d.get("garantia_id")
    problema = d.get("problema") or f"Retorno de garantia — OS {os_orig.get('numero')}"

    novo_numero = _proximo_numero()
    res = query(
        "INSERT INTO ordens_servico (numero, cliente_id, veiculo_id, mecanico_id, "
        "data, status, problema, eh_orcamento, os_origem_id, garantia_id, criado_em) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (novo_numero, os_orig["cliente_id"], os_orig.get("veiculo_id"),
         os_orig.get("mecanico_id"), now()[:10], "aberta", problema,
         0, oid, garantia_id, now()),
        commit=True)

    nova_id = res["_lastid"]

    # Marca garantia como acionada
    if garantia_id:
        query("UPDATE garantias SET status='acionada', obs=? WHERE id=?",
              (f"OS de retorno #{novo_numero} aberta", garantia_id), commit=True)

    registrar_log(session["user_id"], "os_retorno",
                  f"os_origem={oid} nova_os={nova_id} garantia={garantia_id}")
    return jsonify({
        "ok": True,
        "os_id": nova_id,
        "os_numero": novo_numero,
        "os_origem": os_orig.get("numero"),
    }), 201


# =========================================================================
# FOTOS DO VEÍCULO NA ENTRADA
# =========================================================================

@os_bp.route("/api/os/<int:oid>/fotos", methods=["GET"])
@login_obrigatorio
def listar_fotos(oid):
    fotos = query("SELECT id, descricao, criado_em FROM os_fotos WHERE os_id=? ORDER BY id",
                  (oid,))
    return jsonify({"fotos": fotos, "total": len(fotos)})


@os_bp.route("/api/os/<int:oid>/fotos/<int:fid>/dados", methods=["GET"])
@login_obrigatorio
def obter_foto(oid, fid):
    """Retorna o base64 de uma foto específica."""
    foto = query("SELECT dados FROM os_fotos WHERE id=? AND os_id=?",
                 (fid, oid), fetchone=True)
    if not foto:
        return jsonify({"erro": "Foto não encontrada"}), 404
    return jsonify({"dados": foto["dados"]})


@os_bp.route("/api/os/<int:oid>/fotos", methods=["POST"])
@login_obrigatorio
def salvar_foto(oid):
    """Salva uma foto em base64. Limita a 10 fotos por OS e ~2MB por foto."""
    o = query("SELECT id FROM ordens_servico WHERE id=?", (oid,), fetchone=True)
    if not o:
        return jsonify({"erro": "OS não encontrada"}), 404

    total = query("SELECT COUNT(*) AS n FROM os_fotos WHERE os_id=?",
                  (oid,), fetchone=True)["n"]
    if total >= 10:
        return jsonify({"erro": "Limite de 10 fotos por OS atingido"}), 400

    d = request.get_json(force=True)
    dados = d.get("dados", "")
    if not dados or not dados.startswith("data:image"):
        return jsonify({"erro": "Imagem inválida"}), 400

    # Limita tamanho (~2MB em base64 = ~1.5MB real)
    if len(dados) > 2_800_000:
        return jsonify({"erro": "Imagem muito grande. Máximo 2MB."}), 400

    res = query(
        "INSERT INTO os_fotos (os_id, dados, descricao, criado_em) VALUES (?,?,?,?)",
        (oid, dados, d.get("descricao", ""), now()), commit=True)
    registrar_log(session["user_id"], "foto_os", f"os={oid}")
    return jsonify({"ok": True, "id": res["_lastid"]}), 201


@os_bp.route("/api/os/<int:oid>/fotos/<int:fid>", methods=["DELETE"])
@login_obrigatorio
def excluir_foto(oid, fid):
    query("DELETE FROM os_fotos WHERE id=? AND os_id=?", (fid, oid), commit=True)
    return jsonify({"ok": True})
