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
    "em_execucao", "finalizada", "cancelada",
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
    q = request.args.get("q", "").strip()

    where = ["o.eh_orcamento = ?"]
    params = [1 if eh_orc == "1" else 0]
    if status:
        where.append("o.status = ?")
        params.append(status)
    if q:
        where.append("(o.numero LIKE ? OR c.nome LIKE ? OR v.placa LIKE ?)")
        params += [f"%{q}%"] * 3

    # Mecânico só enxerga as OS em que ele é o responsável (não as dos colegas).
    if session.get("perfil") == "mecanico":
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


def _salvar_itens(oid, itens):
    """Grava a lista de itens (produtos/serviços) de uma OS/orçamento."""
    for it in itens:
        qtd = float(it.get("quantidade", 1) or 0)
        vu = float(it.get("valor_unitario", 0) or 0)
        desc = float(it.get("desconto", 0) or 0)
        subtotal = qtd * vu - desc
        query(
            "INSERT INTO os_itens (os_id, tipo, referencia_id, descricao, codigo, "
            "unidade, quantidade, valor_unitario, desconto, subtotal) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (oid, it.get("tipo"), it.get("referencia_id"), it.get("descricao"),
             it.get("codigo"), it.get("unidade"), qtd, vu, desc, subtotal),
            commit=True,
        )


@os_bp.route("/api/os/<int:oid>/finalizar", methods=["POST"])
@login_obrigatorio
def finalizar(oid):
    """
    Finaliza a OS: baixa produtos do estoque e (opcional) gera conta a receber.
    """
    if not _dono_os(oid):
        return jsonify({"erro": "Esta OS pertence a outro mecânico"}), 403
    o = query("SELECT * FROM ordens_servico WHERE id=?", (oid,), fetchone=True)
    if not o:
        return jsonify({"erro": "OS não encontrada"}), 404

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

    # Gera conta a receber se solicitado
    d = request.get_json(silent=True) or {}
    if d.get("gerar_financeiro"):
        query(
            "INSERT INTO financeiro (tipo, descricao, cliente_id, os_id, valor, "
            "vencimento, forma_pagamento, status, criado_em) "
            "VALUES ('receber',?,?,?,?,?,?, 'aberto', ?)",
            (f"OS {o['numero']}", o["cliente_id"], oid, o["total"],
             d.get("vencimento", now()), d.get("forma_pagamento", "dinheiro"), now()),
            commit=True,
        )
    registrar_log(session["user_id"], "finalizar_os", str(oid))
    return jsonify({"ok": True})


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
