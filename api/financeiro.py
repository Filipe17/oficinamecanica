"""
financeiro.py — Contas a receber/pagar, baixas, fluxo de caixa e cobranças.

Convenção:
    tipo = 'receber'  -> entrada de dinheiro
    tipo = 'pagar'    -> saída de dinheiro
    status = aberto | pago | atrasado

O fluxo de caixa é derivado dos lançamentos pagos + vendas do PDV.
"""

from datetime import date
from flask import Blueprint, request, jsonify, session
from database.database import query, now, registrar_log
from api.usuarios import login_obrigatorio, perfil_permitido

financeiro_bp = Blueprint("financeiro", __name__)


def _marcar_atrasados():
    """Atualiza para 'atrasado' os lançamentos abertos e vencidos."""
    hoje = date.today().isoformat()
    query("UPDATE financeiro SET status='atrasado' "
          "WHERE status='aberto' AND vencimento < ?", (hoje,), commit=True)


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

    totais = {
        "aberto": sum(x["valor"] for x in lista if x["status"] == "aberto"),
        "pago": sum(x["valor_pago"] or 0 for x in lista if x["status"] == "pago"),
        "atrasado": sum(x["valor"] for x in lista if x["status"] == "atrasado"),
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


@financeiro_bp.route("/api/financeiro/<int:fid>/baixar", methods=["POST"])
@login_obrigatorio
@perfil_permitido("administrador", "gerente", "financeiro", "caixa")
def baixar(fid):
    """Registra o recebimento/pagamento (baixa) de um lançamento."""
    d = request.get_json(force=True)
    reg = query("SELECT * FROM financeiro WHERE id=?", (fid,), fetchone=True)
    if not reg:
        return jsonify({"erro": "Lançamento não encontrado"}), 404
    valor_pago = float(d.get("valor_pago", reg["valor"]))
    query(
        "UPDATE financeiro SET status='pago', valor_pago=?, pago_em=?, "
        "forma_pagamento=? WHERE id=?",
        (valor_pago, now(), d.get("forma_pagamento", reg["forma_pagamento"]), fid),
        commit=True,
    )
    registrar_log(session["user_id"], "baixar_lancamento", str(fid))
    return jsonify({"ok": True})


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
        "FROM financeiro WHERE tipo='receber' AND status='pago' "
        "GROUP BY dia ORDER BY dia")
    saidas = query(
        "SELECT substr(pago_em,1,10) AS dia, SUM(valor_pago) AS total "
        "FROM financeiro WHERE tipo='pagar' AND status='pago' "
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
