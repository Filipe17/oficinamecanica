"""
cartao.py — Controle de vendas no cartão (maquininha).

Permite cadastrar as TAXAS da maquininha por bandeira/modalidade/parcelas e
calcular automaticamente o VALOR LÍQUIDO (o que a oficina recebe descontada a
taxa). Também gera um relatório de vendas no cartão por período.

Obs.: a conciliação automática com a adquirente (Cielo/Stone/Rede) NÃO faz
parte deste módulo — depende de integração externa e fica para quando houver
uma adquirente definida.
"""

from flask import Blueprint, request, jsonify, session
from database.database import query, now, registrar_log
from api.usuarios import login_obrigatorio, perfil_permitido

cartao_bp = Blueprint("cartao", __name__)


# ------------------------------------------------------------ TAXAS (CRUD)
@cartao_bp.route("/api/cartao/taxas", methods=["GET"])
@login_obrigatorio
def listar_taxas():
    taxas = query("SELECT * FROM taxas_cartao WHERE ativo=1 "
                  "ORDER BY modalidade, parcelas, bandeira")
    return jsonify({"dados": taxas})


@cartao_bp.route("/api/cartao/taxas", methods=["POST"])
@login_obrigatorio
@perfil_permitido("administrador", "gerente", "financeiro")
def criar_taxa():
    d = request.get_json(force=True)
    if not d.get("modalidade"):
        return jsonify({"erro": "Modalidade é obrigatória"}), 400
    res = query(
        "INSERT INTO taxas_cartao (bandeira, modalidade, parcelas, percentual, "
        "prazo_dias, ativo, criado_em) VALUES (?,?,?,?,?,1,?)",
        (d.get("bandeira") or "Todas", d.get("modalidade"),
         int(d.get("parcelas") or 1), float(d.get("percentual") or 0),
         int(d.get("prazo_dias") or 30), now()),
        commit=True)
    registrar_log(session["user_id"], "criar_taxa_cartao", str(res["_lastid"]))
    return jsonify({"ok": True, "id": res["_lastid"]}), 201


@cartao_bp.route("/api/cartao/taxas/<int:tid>", methods=["PUT"])
@login_obrigatorio
@perfil_permitido("administrador", "gerente", "financeiro")
def editar_taxa(tid):
    d = request.get_json(force=True)
    query("UPDATE taxas_cartao SET bandeira=?, modalidade=?, parcelas=?, "
          "percentual=?, prazo_dias=? WHERE id=?",
          (d.get("bandeira") or "Todas", d.get("modalidade"),
           int(d.get("parcelas") or 1), float(d.get("percentual") or 0),
           int(d.get("prazo_dias") or 30), tid), commit=True)
    return jsonify({"ok": True})


@cartao_bp.route("/api/cartao/taxas/<int:tid>", methods=["DELETE"])
@login_obrigatorio
@perfil_permitido("administrador", "gerente", "financeiro")
def excluir_taxa(tid):
    query("UPDATE taxas_cartao SET ativo=0 WHERE id=?", (tid,), commit=True)
    return jsonify({"ok": True})


# ------------------------------------------------------ CÁLCULO DO LÍQUIDO
def taxa_aplicavel(modalidade, parcelas, bandeira=None):
    """
    Acha a taxa cadastrada mais específica para a venda:
    tenta bandeira+modalidade+parcelas; se não achar, cai para 'Todas'.
    """
    p = int(parcelas or 1)
    # 1) bandeira específica
    if bandeira:
        r = query("SELECT * FROM taxas_cartao WHERE ativo=1 AND modalidade=? "
                   "AND parcelas=? AND bandeira=? LIMIT 1",
                   (modalidade, p, bandeira), fetchone=True)
        if r:
            return r
    # 2) padrão 'Todas'
    r = query("SELECT * FROM taxas_cartao WHERE ativo=1 AND modalidade=? "
               "AND parcelas=? AND (bandeira='Todas' OR bandeira IS NULL) LIMIT 1",
               (modalidade, p), fetchone=True)
    return r


@cartao_bp.route("/api/cartao/calcular", methods=["POST"])
@login_obrigatorio
def calcular():
    """
    Recebe { valor, modalidade, parcelas, bandeira } e devolve a taxa aplicável
    e o valor líquido. Usado na tela de pagamento para preencher automaticamente.
    """
    d = request.get_json(force=True)
    valor = float(d.get("valor") or 0)
    t = taxa_aplicavel(d.get("modalidade"), d.get("parcelas"), d.get("bandeira"))
    pct = float(t["percentual"]) if t else 0.0
    desconto = round(valor * pct / 100, 2)
    liquido = round(valor - desconto, 2)
    return jsonify({"percentual": pct, "desconto": desconto,
                    "valor_liquido": liquido,
                    "prazo_dias": (t["prazo_dias"] if t else None),
                    "sem_taxa_cadastrada": t is None})


# ------------------------------------------------------------- RELATÓRIO
@cartao_bp.route("/api/cartao/relatorio", methods=["GET"])
@login_obrigatorio
@perfil_permitido("administrador", "gerente", "financeiro")
def relatorio():
    """
    Vendas no cartão no período (financeiro tipo receber com cartão preenchido).
    Parâmetros: inicio, fim (YYYY-MM-DD).
    """
    inicio = request.args.get("inicio", "").strip()
    fim = request.args.get("fim", "").strip()
    where = ["cartao_modalidade IS NOT NULL", "cartao_modalidade <> ''"]
    params = []
    if inicio:
        where.append("substr(COALESCE(pago_em, vencimento, criado_em),1,10) >= ?"); params.append(inicio)
    if fim:
        where.append("substr(COALESCE(pago_em, vencimento, criado_em),1,10) <= ?"); params.append(fim)

    linhas = query(
        f"SELECT id, descricao, cartao_bandeira, cartao_modalidade, cartao_parcelas, "
        f"cartao_taxa, valor, cartao_valor_liquido, status, "
        f"COALESCE(pago_em, vencimento, criado_em) AS data "
        f"FROM financeiro WHERE {' AND '.join(where)} ORDER BY data DESC", params)

    bruto = sum(l["valor"] or 0 for l in linhas)
    liquido = sum(l["cartao_valor_liquido"] or 0 for l in linhas)
    taxas = round(bruto - liquido, 2)

    # Resumo por bandeira
    por_bandeira = {}
    for l in linhas:
        b = l["cartao_bandeira"] or "—"
        g = por_bandeira.setdefault(b, {"bandeira": b, "qtd": 0, "bruto": 0, "liquido": 0})
        g["qtd"] += 1; g["bruto"] += l["valor"] or 0; g["liquido"] += l["cartao_valor_liquido"] or 0

    return jsonify({
        "dados": linhas,
        "resumo": {"bruto": round(bruto, 2), "taxas": taxas, "liquido": round(liquido, 2),
                   "qtd": len(linhas)},
        "por_bandeira": [
            {**g, "bruto": round(g["bruto"], 2), "liquido": round(g["liquido"], 2)}
            for g in por_bandeira.values()],
    })
