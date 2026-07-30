"""
financeiro.py — Contas a receber/pagar, baixas, fluxo de caixa e cobranças.

Convenção:
    tipo = 'receber'  -> entrada de dinheiro
    tipo = 'pagar'    -> saída de dinheiro
    status = aberto | parcial | pago | atrasado

O fluxo de caixa é derivado dos lançamentos pagos + vendas do PDV.
"""

from datetime import date
from flask import Blueprint, request, jsonify, session
from database.database import query, now, registrar_log
from api.usuarios import login_obrigatorio, perfil_permitido

financeiro_bp = Blueprint("financeiro", __name__)


def _marcar_atrasados():
    """Atualiza para 'atrasado' os lançamentos abertos/parciais e vencidos."""
    hoje = date.today().isoformat()
    query("UPDATE financeiro SET status='atrasado' "
          "WHERE status IN ('aberto','parcial') AND vencimento < ?",
          (hoje,), commit=True)


def _total_devido(reg):
    """Valor cheio da conta = valor + juros + multa (encargos já gravados)."""
    return (reg["valor"] or 0) + (reg["juros"] or 0) + (reg["multa"] or 0)


@financeiro_bp.route("/api/financeiro", methods=["GET"])
@login_obrigatorio
def listar():
    _marcar_atrasados()
    tipo = request.args.get("tipo", "receber")     # receber | pagar
    status = request.args.get("status", "").strip()

    # Prefixo "f." é obrigatório: a tabela clientes também tem coluna "tipo",
    # e o JOIN abaixo tornaria a referência ambígua sem o alias.
    where = ["f.tipo = ?"]
    params = [tipo]
    if status:
        where.append("f.status = ?")
        params.append(status)

    lista = query(
        f"SELECT f.*, c.nome AS cliente_nome, fo.nome AS fornecedor_nome "
        f"FROM financeiro f "
        f"LEFT JOIN clientes c ON c.id=f.cliente_id "
        f"LEFT JOIN fornecedores fo ON fo.id=f.fornecedor_id "
        f"WHERE {' AND '.join(where)} ORDER BY f.vencimento", params)

    # "aberto" agrega o que ainda falta receber/pagar (aberto + parcial + atrasado),
    # descontando o que já foi pago parcialmente. "pago" soma o efetivamente baixado.
    def falta(x):
        return max(_total_devido(x) - (x["valor_pago"] or 0), 0)

    totais = {
        "aberto": sum(falta(x) for x in lista if x["status"] in ("aberto", "parcial")),
        "pago": sum(x["valor_pago"] or 0 for x in lista if x["status"] in ("pago", "parcial")),
        "atrasado": sum(falta(x) for x in lista if x["status"] == "atrasado"),
    }
    return jsonify({"dados": lista, "totais": totais})


@financeiro_bp.route("/api/financeiro", methods=["POST"])
@login_obrigatorio
@perfil_permitido("administrador", "gerente", "financeiro", "caixa")
def criar():
    d = request.get_json(force=True)
    res = query(
        "INSERT INTO financeiro (tipo, descricao, cliente_id, fornecedor_id, os_id, "
        "valor, vencimento, forma_pagamento, status, juros, multa, criado_em) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (d.get("tipo", "receber"), d.get("descricao"), d.get("cliente_id"),
         d.get("fornecedor_id"), d.get("os_id"), d.get("valor", 0),
         d.get("vencimento"), d.get("forma_pagamento"), "aberto",
         d.get("juros", 0), d.get("multa", 0), now()),
        commit=True,
    )
    registrar_log(session["user_id"], "criar_lancamento", d.get("descricao"))
    return jsonify({"ok": True, "id": res["_lastid"]}), 201


@financeiro_bp.route("/api/financeiro/<int:fid>", methods=["PUT"])
@login_obrigatorio
@perfil_permitido("administrador", "gerente", "financeiro")
def editar(fid):
    """Edita um lançamento ainda não quitado (não mexe em valores já baixados)."""
    reg = query("SELECT * FROM financeiro WHERE id=?", (fid,), fetchone=True)
    if not reg:
        return jsonify({"erro": "Lançamento não encontrado"}), 404
    if reg["status"] == "pago":
        return jsonify({"erro": "Lançamento já quitado não pode ser editado"}), 400
    d = request.get_json(force=True)
    query(
        "UPDATE financeiro SET descricao=?, cliente_id=?, fornecedor_id=?, "
        "valor=?, vencimento=?, forma_pagamento=?, juros=?, multa=? WHERE id=?",
        (d.get("descricao", reg["descricao"]),
         d.get("cliente_id", reg["cliente_id"]),
         d.get("fornecedor_id", reg["fornecedor_id"]),
         d.get("valor", reg["valor"]),
         d.get("vencimento", reg["vencimento"]),
         d.get("forma_pagamento", reg["forma_pagamento"]),
         d.get("juros", reg["juros"]),
         d.get("multa", reg["multa"]),
         fid),
        commit=True,
    )
    registrar_log(session["user_id"], "editar_lancamento", str(fid))
    return jsonify({"ok": True})


@financeiro_bp.route("/api/financeiro/<int:fid>/baixar", methods=["POST"])
@login_obrigatorio
@perfil_permitido("administrador", "gerente", "financeiro", "caixa")
def baixar(fid):
    """
    Registra recebimento/pagamento (baixa), com suporte a:
      - juros/multa: o total devido = valor + juros + multa.
      - baixa parcial: se o acumulado pago < total devido, status='parcial'
        e o restante continua cobrável; quando alcança o total, status='pago'.
    """
    d = request.get_json(force=True)
    reg = query("SELECT * FROM financeiro WHERE id=?", (fid,), fetchone=True)
    if not reg:
        return jsonify({"erro": "Lançamento não encontrado"}), 404
    if reg["status"] == "pago":
        return jsonify({"erro": "Lançamento já quitado"}), 400

    total_devido = _total_devido(reg)
    ja_pago = reg["valor_pago"] or 0

    # Valor desta baixa (default: quitar o restante).
    restante = max(total_devido - ja_pago, 0)
    try:
        valor_baixa = float(d.get("valor_pago", restante))
    except (TypeError, ValueError):
        return jsonify({"erro": "Valor inválido"}), 400
    if valor_baixa <= 0:
        return jsonify({"erro": "Valor da baixa deve ser maior que zero"}), 400

    acumulado = ja_pago + valor_baixa
    # Tolerância de 1 centavo para evitar sobra por arredondamento.
    quitado = acumulado >= (total_devido - 0.01)
    novo_status = "pago" if quitado else "parcial"

    query(
        "UPDATE financeiro SET status=?, valor_pago=?, pago_em=?, "
        "forma_pagamento=? WHERE id=?",
        (novo_status, round(acumulado, 2), now(),
         d.get("forma_pagamento", reg["forma_pagamento"]), fid),
        commit=True,
    )
    registrar_log(session["user_id"],
                  "baixar_lancamento" + ("" if quitado else "_parcial"), str(fid))
    return jsonify({
        "ok": True,
        "status": novo_status,
        "total_devido": round(total_devido, 2),
        "pago_acumulado": round(acumulado, 2),
        "restante": round(max(total_devido - acumulado, 0), 2),
    })


@financeiro_bp.route("/api/financeiro/<int:fid>", methods=["DELETE"])
@login_obrigatorio
@perfil_permitido("administrador", "gerente", "financeiro")
def excluir(fid):
    query("DELETE FROM financeiro WHERE id=?", (fid,), commit=True)
    registrar_log(session["user_id"], "excluir_lancamento", str(fid))
    return jsonify({"ok": True})


@financeiro_bp.route("/api/financeiro/fluxo", methods=["GET"])
@login_obrigatorio
def fluxo_caixa():
    """
    Fluxo de caixa consolidado por dia (últimos registros pagos + vendas PDV).
    Retorna série pronta para o gráfico do dashboard.
    """
    entradas = query(
        "SELECT substr(pago_em,1,10) AS dia, SUM(valor_pago) AS total "
        "FROM financeiro WHERE tipo='receber' AND status IN ('pago','parcial') "
        "GROUP BY dia ORDER BY dia")
    saidas = query(
        "SELECT substr(pago_em,1,10) AS dia, SUM(valor_pago) AS total "
        "FROM financeiro WHERE tipo='pagar' AND status IN ('pago','parcial') "
        "GROUP BY dia ORDER BY dia")
    vendas = query(
        "SELECT substr(criado_em,1,10) AS dia, SUM(total) AS total "
        "FROM vendas GROUP BY dia ORDER BY dia")
    return jsonify({"entradas": entradas, "saidas": saidas, "vendas": vendas})


@financeiro_bp.route("/api/cobrancas", methods=["GET"])
@login_obrigatorio
def cobrancas():
    """Lista de inadimplentes (contas a receber atrasadas) para gestão de cobrança."""
    _marcar_atrasados()
    lista = query(
        "SELECT f.*, c.nome AS cliente_nome, c.whatsapp, c.telefone, c.email "
        "FROM financeiro f LEFT JOIN clientes c ON c.id=f.cliente_id "
        "WHERE f.tipo='receber' AND f.status='atrasado' ORDER BY f.vencimento")
    return jsonify({"dados": lista, "total": sum(x["valor"] for x in lista)})
