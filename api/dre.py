"""
dre.py — Demonstrativo de Resultado do Exercício (DRE) por competência.

Regime de competência (Opção A): a receita é reconhecida pelo que foi VENDIDO
no período (vendas do PDV + OS finalizadas), independente de já ter sido
recebido. O custo (CMV/CSP) sai do preço de custo dos produtos efetivamente
vendidos. As despesas operacionais vêm dos lançamentos 'pagar' do financeiro,
agrupadas pela coluna 'categoria'.

Estrutura devolvida:
    Receita Bruta
    (-) Deduções (impostos sobre venda) .......... (0 até existir módulo fiscal)
    = Receita Líquida
    (-) CMV / CSP (custo das peças/serviços vendidos)
    = Lucro Bruto
    (-) Despesas Operacionais (por categoria)
    = Resultado Líquido (lucro ou prejuízo)

Datas: parâmetros 'inicio' e 'fim' no formato YYYY-MM-DD (ambos opcionais;
sem eles, considera tudo). A comparação usa substr(campo,1,10) para casar com
o padrão de datas em texto do restante do sistema.
"""

from flask import Blueprint, request, jsonify
from database.database import query
from api.usuarios import login_obrigatorio

dre_bp = Blueprint("dre", __name__)


def _periodo(campo, params, inicio, fim):
    """Monta a cláusula de período para um campo de data (texto YYYY-MM-DD...)."""
    cond = []
    if inicio:
        cond.append(f"substr({campo},1,10) >= ?")
        params.append(inicio)
    if fim:
        cond.append(f"substr({campo},1,10) <= ?")
        params.append(fim)
    return (" AND " + " AND ".join(cond)) if cond else ""


@dre_bp.route("/api/relatorios/dre", methods=["GET"])
@login_obrigatorio
def dre():
    inicio = request.args.get("inicio", "").strip()
    fim = request.args.get("fim", "").strip()

    # ---------------------------------------------------------------- RECEITA
    # Receita = vendas do PDV + OS finalizadas (não-orçamento) no período.
    pv, saved = [], []
    receita_pdv = query(
        "SELECT COALESCE(SUM(total),0) AS v FROM vendas WHERE 1=1"
        + _periodo("criado_em", pv, inicio, fim), pv, fetchone=True)["v"] or 0

    receita_os = query(
        "SELECT COALESCE(SUM(total),0) AS v FROM ordens_servico "
        "WHERE eh_orcamento=0 AND status='finalizada'"
        + _periodo("data", saved, inicio, fim), saved, fetchone=True)["v"] or 0

    receita_bruta = round(receita_pdv + receita_os, 2)

    # Deduções sobre venda (impostos) — placeholder até existir módulo fiscal.
    deducoes = 0.0
    receita_liquida = round(receita_bruta - deducoes, 2)

    # ------------------------------------------------------------------- CMV
    # Custo dos produtos vendidos = quantidade vendida × preco_custo do produto.
    # Considera itens de PRODUTO das vendas (PDV) e das OS finalizadas.
    # Itens sem produto vinculado ou sem custo cadastrado entram como 0.
    cv, co = [], []
    cmv_pdv = query(
        "SELECT COALESCE(SUM(vi.quantidade * COALESCE(p.preco_compra,0)),0) AS v "
        "FROM venda_itens vi "
        "JOIN vendas v ON v.id=vi.venda_id "
        "LEFT JOIN produtos p ON p.id=vi.produto_id "
        "WHERE 1=1" + _periodo("v.criado_em", cv, inicio, fim), cv,
        fetchone=True)["v"] or 0

    cmv_os = query(
        "SELECT COALESCE(SUM(oi.quantidade * COALESCE(p.preco_compra,0)),0) AS v "
        "FROM os_itens oi "
        "JOIN ordens_servico o ON o.id=oi.os_id "
        "LEFT JOIN produtos p ON p.id=oi.referencia_id "
        "WHERE oi.tipo='produto' AND o.eh_orcamento=0 AND o.status='finalizada'"
        + _periodo("o.data", co, inicio, fim), co, fetchone=True)["v"] or 0

    cmv = round(cmv_pdv + cmv_os, 2)
    lucro_bruto = round(receita_liquida - cmv, 2)

    # --------------------------------------------------- DESPESAS OPERACIONAIS
    # Lançamentos 'pagar' baixados (pago/parcial) no período, por categoria.
    # Usa o que foi efetivamente pago (valor_pago) e a data de pagamento.
    dp = []
    desp_rows = query(
        "SELECT COALESCE(NULLIF(TRIM(categoria),''),'Sem categoria') AS categoria, "
        "COALESCE(SUM(valor_pago),0) AS total "
        "FROM financeiro WHERE tipo='pagar' AND status IN ('pago','parcial')"
        + _periodo("pago_em", dp, inicio, fim)
        + " GROUP BY COALESCE(NULLIF(TRIM(categoria),''),'Sem categoria') "
        "ORDER BY total DESC", dp)

    despesas = [{"categoria": r["categoria"], "total": round(r["total"] or 0, 2)}
                for r in desp_rows]
    total_despesas = round(sum(d["total"] for d in despesas), 2)

    resultado = round(lucro_bruto - total_despesas, 2)

    margem = round((resultado / receita_bruta * 100), 1) if receita_bruta else 0.0

    return jsonify({
        "periodo": {"inicio": inicio or None, "fim": fim or None},
        "receita_bruta": receita_bruta,
        "receita_pdv": round(receita_pdv, 2),
        "receita_os": round(receita_os, 2),
        "deducoes": deducoes,
        "receita_liquida": receita_liquida,
        "cmv": cmv,
        "lucro_bruto": lucro_bruto,
        "despesas": despesas,
        "total_despesas": total_despesas,
        "resultado": resultado,
        "margem": margem,
    })
