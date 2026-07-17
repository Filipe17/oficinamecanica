"""
relatorios.py — Estatísticas do dashboard, dados de gráficos e relatórios.

Concentra as consultas agregadas usadas pelos cards e gráficos do dashboard,
além dos endpoints de relatórios que o front pode exportar (CSV é gerado aqui;
PDF/Excel podem ser gerados no front a partir do JSON).
"""

from datetime import date
from flask import Blueprint, jsonify, request, Response, session
from database.database import query
from api.usuarios import login_obrigatorio

relatorios_bp = Blueprint("relatorios", __name__)


def _um(sql, params=()):
    """Atalho: retorna o primeiro valor numérico de um COUNT/SUM."""
    r = query(sql, params, fetchone=True)
    if not r:
        return 0
    return list(r.values())[0] or 0


@relatorios_bp.route("/api/dashboard", methods=["GET"])
@login_obrigatorio
def dashboard():
    """Todos os cards do dashboard em uma única resposta (menos requisições)."""
    mes = date.today().strftime("%Y-%m")           # ex.: 2026-07
    hoje = date.today().isoformat()

    cards = {
        "os_abertas": _um("SELECT COUNT(*) FROM ordens_servico "
                          "WHERE eh_orcamento=0 AND status NOT IN ('finalizada','cancelada')"),
        "os_finalizadas": _um("SELECT COUNT(*) FROM ordens_servico "
                             "WHERE status='finalizada'"),
        "veiculos_manutencao": _um("SELECT COUNT(DISTINCT veiculo_id) FROM ordens_servico "
                                  "WHERE status IN ('em_execucao','aguardando_pecas')"),
        "orcamentos_pendentes": _um("SELECT COUNT(*) FROM ordens_servico WHERE eh_orcamento=1"),
        "clientes": _um("SELECT COUNT(*) FROM clientes"),
        "veiculos": _um("SELECT COUNT(*) FROM veiculos"),
        "produtos": _um("SELECT COUNT(*) FROM produtos"),
        "servicos_realizados": _um("SELECT COUNT(*) FROM os_itens WHERE tipo='servico'"),
        "receita_mes": _um("SELECT COALESCE(SUM(valor_pago),0) FROM financeiro "
                          "WHERE tipo='receber' AND status='pago' AND substr(pago_em,1,7)=?", (mes,)),
        "despesa_mes": _um("SELECT COALESCE(SUM(valor_pago),0) FROM financeiro "
                          "WHERE tipo='pagar' AND status='pago' AND substr(pago_em,1,7)=?", (mes,)),
        "contas_receber": _um("SELECT COALESCE(SUM(valor),0) FROM financeiro "
                             "WHERE tipo='receber' AND status IN ('aberto','atrasado')"),
        "contas_pagar": _um("SELECT COALESCE(SUM(valor),0) FROM financeiro "
                           "WHERE tipo='pagar' AND status IN ('aberto','atrasado')"),
        "cobrancas_atraso": _um("SELECT COUNT(*) FROM financeiro "
                               "WHERE tipo='receber' AND status='atrasado'"),
        "itens_estoque": _um("SELECT COUNT(*) FROM produtos WHERE estoque_atual>0"),
        "itens_criticos": _um("SELECT COUNT(*) FROM produtos "
                             "WHERE estoque_minimo>0 AND estoque_atual<=estoque_minimo"),
        "pdv_dia": _um("SELECT COALESCE(SUM(total),0) FROM vendas "
                      "WHERE substr(criado_em,1,10)=?", (hoje,)),
    }
    cards["lucro_mes"] = (cards["receita_mes"] or 0) - (cards["despesa_mes"] or 0)
    return jsonify({"cards": cards})


@relatorios_bp.route("/api/dashboard/graficos", methods=["GET"])
@login_obrigatorio
def graficos():
    """Séries para os gráficos do dashboard."""
    # Ordens por status
    os_status = query(
        "SELECT status, COUNT(*) AS total FROM ordens_servico "
        "WHERE eh_orcamento=0 GROUP BY status")

    # Serviços mais vendidos
    servicos_top = query(
        "SELECT descricao, COUNT(*) AS qtd, SUM(subtotal) AS valor "
        "FROM os_itens WHERE tipo='servico' GROUP BY descricao "
        "ORDER BY qtd DESC LIMIT 8")

    # Produtos mais vendidos (PDV + OS)
    produtos_top = query(
        "SELECT descricao, SUM(quantidade) AS qtd FROM venda_itens "
        "GROUP BY descricao ORDER BY qtd DESC LIMIT 8")

    # Faturamento por mês (vendas + recebimentos)
    faturamento = query(
        "SELECT substr(criado_em,1,7) AS mes, SUM(total) AS total "
        "FROM vendas GROUP BY mes ORDER BY mes LIMIT 12")

    # Entrada x saída de estoque
    estoque_mov = query(
        "SELECT tipo, COUNT(*) AS total FROM estoque_mov GROUP BY tipo")

    return jsonify({
        "os_status": os_status,
        "servicos_top": servicos_top,
        "produtos_top": produtos_top,
        "faturamento": faturamento,
        "estoque_mov": estoque_mov,
    })


# -------------------------------------------------------------------------
# Relatórios exportáveis (CSV gerado no backend)
# -------------------------------------------------------------------------
RELATORIOS = {
    "clientes": "SELECT id, nome, cpf_cnpj, telefone, cidade, estado FROM clientes ORDER BY nome",
    "veiculos": "SELECT id, marca, modelo, placa, ano, cor FROM veiculos ORDER BY id",
    "produtos": "SELECT id, nome, categoria, preco_venda, estoque_atual FROM produtos ORDER BY nome",
    "os": "SELECT id, numero, status, total, data FROM ordens_servico ORDER BY id DESC",
    "vendas": "SELECT id, total, forma_pagamento, criado_em FROM vendas ORDER BY id DESC",
    "financeiro": "SELECT id, tipo, descricao, valor, status, vencimento FROM financeiro ORDER BY vencimento",
}


@relatorios_bp.route("/api/relatorios/<nome>", methods=["GET"])
@login_obrigatorio
def relatorio(nome):
    """Retorna os dados de um relatório em JSON (o front exporta PDF/Excel/CSV)."""
    if nome not in RELATORIOS:
        return jsonify({"erro": "Relatório inexistente"}), 404
    dados = query(RELATORIOS[nome])
    return jsonify({"nome": nome, "dados": dados, "total": len(dados)})


@relatorios_bp.route("/api/relatorios/<nome>/csv", methods=["GET"])
@login_obrigatorio
def relatorio_csv(nome):
    """Exporta o relatório diretamente em CSV (download)."""
    if nome not in RELATORIOS:
        return jsonify({"erro": "Relatório inexistente"}), 404
    dados = query(RELATORIOS[nome])
    if not dados:
        return Response("Sem dados", mimetype="text/plain")

    colunas = list(dados[0].keys())
    linhas = [";".join(colunas)]
    for row in dados:
        linhas.append(";".join(str(row.get(c, "")) for c in colunas))
    csv = "\n".join(linhas)
    return Response(csv, mimetype="text/csv",
                    headers={"Content-Disposition": f"attachment; filename={nome}.csv"})


@relatorios_bp.route("/api/logs", methods=["GET"])
@login_obrigatorio
def logs():
    lista = query(
        "SELECT l.*, u.nome AS usuario_nome FROM logs l "
        "LEFT JOIN usuarios u ON u.id=l.usuario_id "
        "ORDER BY l.id DESC LIMIT 300")
    return jsonify({"dados": lista})
