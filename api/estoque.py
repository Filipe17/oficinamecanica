"""
estoque.py — Controle de estoque.

Regra central: TODA alteração de saldo passa por movimentar_estoque(), que
grava um registro em estoque_mov (histórico) e atualiza produtos.estoque_atual.
Isso garante rastreabilidade total (entrada, saída, ajuste, transferência).
"""

from flask import Blueprint, request, jsonify, session
from database.database import query, now, registrar_log
from api.usuarios import login_obrigatorio

estoque_bp = Blueprint("estoque", __name__)


def movimentar_estoque(produto_id, tipo, quantidade, origem="manual",
                       documento=None, usuario_id=None):
    """
    Aplica uma movimentação e retorna o novo saldo.

    tipo: 'entrada' soma; 'saida' subtrai; 'ajuste' define o valor absoluto;
          'transferencia' subtrai (transferência de saída).
    Usada também pelo PDV, OS e importação de XML.
    """
    prod = query("SELECT estoque_atual FROM produtos WHERE id=?",
                 (produto_id,), fetchone=True)
    if not prod:
        raise ValueError("Produto inexistente")

    atual = float(prod["estoque_atual"] or 0)
    qtd = float(quantidade)

    if tipo == "entrada":
        novo = atual + qtd
    elif tipo in ("saida", "transferencia"):
        novo = atual - qtd
    elif tipo == "ajuste":
        novo = qtd
    else:
        raise ValueError("Tipo de movimentação inválido")

    query("UPDATE produtos SET estoque_atual=? WHERE id=?", (novo, produto_id),
          commit=True)
    query(
        "INSERT INTO estoque_mov (produto_id, tipo, quantidade, saldo_apos, "
        "origem, documento, usuario_id, criado_em) VALUES (?,?,?,?,?,?,?,?)",
        (produto_id, tipo, qtd, novo, origem, documento,
         usuario_id or session.get("user_id"), now()),
        commit=True,
    )
    return novo


@estoque_bp.route("/api/estoque/movimentar", methods=["POST"])
@login_obrigatorio
def api_movimentar():
    d = request.get_json(force=True)
    try:
        novo = movimentar_estoque(
            d["produto_id"], d["tipo"], d["quantidade"],
            origem=d.get("origem", "manual"), documento=d.get("documento"))
    except (KeyError, ValueError) as e:
        return jsonify({"erro": str(e)}), 400
    registrar_log(session["user_id"], "movimentar_estoque",
                  f"produto {d.get('produto_id')} {d.get('tipo')} {d.get('quantidade')}")
    return jsonify({"ok": True, "saldo": novo})


@estoque_bp.route("/api/estoque/movimentacoes", methods=["GET"])
@login_obrigatorio
def movimentacoes():
    """Histórico geral de movimentações, com nome do produto."""
    lista = query(
        "SELECT m.*, p.nome AS produto_nome FROM estoque_mov m "
        "LEFT JOIN produtos p ON p.id = m.produto_id "
        "ORDER BY m.id DESC LIMIT 200")
    return jsonify({"dados": lista})


@estoque_bp.route("/api/estoque/alertas", methods=["GET"])
@login_obrigatorio
def alertas():
    """Produtos zerados e produtos abaixo do estoque mínimo (críticos)."""
    # Exclui produtos pai que têm variações — o estoque real fica nas variações
    _excluir_pais = """
        AND (produto_pai_id IS NOT NULL OR NOT EXISTS (
            SELECT 1 FROM produtos v WHERE v.produto_pai_id = produtos.id
        ))
    """
    sem_estoque = query(
        "SELECT * FROM produtos WHERE estoque_atual <= 0 " + _excluir_pais + " ORDER BY nome")
    criticos = query(
        "SELECT * FROM produtos WHERE estoque_atual > 0 "
        "AND estoque_minimo > 0 AND estoque_atual <= estoque_minimo "
        + _excluir_pais + " ORDER BY nome")
    return jsonify({"sem_estoque": sem_estoque, "criticos": criticos})


@estoque_bp.route("/api/estoque/curva-abc", methods=["GET"])
@login_obrigatorio
def curva_abc():
    """
    Curva ABC simplificada por valor imobilizado (estoque_atual * preco_venda).
    A = top 20% do valor, B = próximos 30%, C = restante.
    """
    produtos = query(
        "SELECT id, nome, estoque_atual, preco_venda, "
        "(estoque_atual * preco_venda) AS valor FROM produtos "
        "ORDER BY valor DESC")
    total = sum(p["valor"] or 0 for p in produtos) or 1
    acumulado = 0
    for p in produtos:
        acumulado += (p["valor"] or 0)
        perc = acumulado / total
        p["classe"] = "A" if perc <= 0.8 else ("B" if perc <= 0.95 else "C")
    return jsonify({"dados": produtos})


@estoque_bp.route("/api/estoque/sugestao-compras", methods=["GET"])
@login_obrigatorio
def sugestao_compras():
    """
    Lista produtos abaixo do estoque mínimo, agrupados por fornecedor.
    Quantidade sugerida = estoque_maximo - estoque_atual (ou estoque_minimo*2
    quando estoque_maximo não está definido).
    Inclui variações (produto_pai_id não nulo) com seus próprios estoques.
    """
    criticos = query("""
        SELECT p.id, p.nome, p.codigo, p.categoria, p.marca,
               p.estoque_atual, p.estoque_minimo, p.estoque_maximo,
               p.preco_compra, p.produto_pai_id,
               f.nome AS fornecedor, f.id AS fornecedor_id,
               f.telefone AS fornecedor_tel, f.email AS fornecedor_email
        FROM produtos p
        LEFT JOIN fornecedores f ON f.id = p.fornecedor_id
        WHERE p.estoque_minimo > 0
          AND p.estoque_atual <= p.estoque_minimo
          AND (
            -- inclui variações (tem pai)
            p.produto_pai_id IS NOT NULL
            OR
            -- inclui produtos simples (sem pai E sem filhos)
            NOT EXISTS (
              SELECT 1 FROM produtos v WHERE v.produto_pai_id = p.id
            )
          )
        ORDER BY f.nome NULLS LAST, p.nome
    """)

    # Calcula quantidade sugerida e valor estimado
    for p in criticos:
        atual = float(p["estoque_atual"] or 0)
        minimo = float(p["estoque_minimo"] or 0)
        maximo = float(p["estoque_maximo"] or 0)
        sugerido = (maximo - atual) if maximo > atual else (minimo * 2 - atual)
        sugerido = max(round(sugerido, 2), 1)
        p["sugerido"] = sugerido
        p["valor_estimado"] = round(sugerido * float(p["preco_compra"] or 0), 2)

    # Agrupa por fornecedor
    grupos = {}
    sem_fornecedor = []
    for p in criticos:
        forn = p.get("fornecedor") or ""
        if not forn:
            sem_fornecedor.append(p)
            continue
        if forn not in grupos:
            grupos[forn] = {
                "fornecedor": forn,
                "fornecedor_id": p.get("fornecedor_id"),
                "telefone": p.get("fornecedor_tel"),
                "email": p.get("fornecedor_email"),
                "itens": [],
                "total_estimado": 0,
            }
        grupos[forn]["itens"].append(p)
        grupos[forn]["total_estimado"] = round(
            grupos[forn]["total_estimado"] + p["valor_estimado"], 2)

    if sem_fornecedor:
        grupos["— Sem fornecedor —"] = {
            "fornecedor": "— Sem fornecedor —",
            "fornecedor_id": None,
            "telefone": None,
            "email": None,
            "itens": sem_fornecedor,
            "total_estimado": round(sum(p["valor_estimado"] for p in sem_fornecedor), 2),
        }

    total_geral = round(sum(g["total_estimado"] for g in grupos.values()), 2)
    return jsonify({
        "grupos": list(grupos.values()),
        "total_itens": len(criticos),
        "total_geral": total_geral,
    })


@estoque_bp.route("/api/estoque/cotacao/historico/<int:produto_id>", methods=["GET"])
@login_obrigatorio
def historico_preco(produto_id):
    """Retorna as últimas entradas do produto para referência de preço."""
    historico = query(
        "SELECT m.criado_em, m.quantidade, m.documento, m.origem, "
        "p.preco_compra AS preco_atual "
        "FROM estoque_mov m "
        "JOIN produtos p ON p.id = m.produto_id "
        "WHERE m.produto_id=? AND m.tipo='entrada' "
        "ORDER BY m.id DESC LIMIT 5",
        (produto_id,))
    # Tenta pegar o último preço pago via XML (NF-e)
    ultimo_xml = next((h for h in historico if h.get("origem") == "xml"), None)
    return jsonify({"historico": historico, "ultimo_xml": ultimo_xml})


@estoque_bp.route("/api/estoque/cotacao/enviar", methods=["POST"])
@login_obrigatorio
def enviar_cotacao():
    """
    Envia pedido de cotação/compra por email para um fornecedor.
    Body: { fornecedor_id, email_destino, itens: [{produto_id, nome, codigo, quantidade, preco_referencia}],
            obs, prazo, assunto_custom }
    """
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    from api.configuracoes import obter_config

    d = request.get_json(force=True)
    itens = d.get("itens", [])
    if not itens:
        return jsonify({"erro": "Nenhum item para cotar"}), 400

    email_destino = (d.get("email_destino") or "").strip()
    if not email_destino:
        return jsonify({"erro": "E-mail do fornecedor não informado"}), 400

    cfg = obter_config()
    smtp_host = cfg.get("smtp_host", "").strip()
    smtp_porta = int(cfg.get("smtp_porta") or 587)
    smtp_usuario = cfg.get("smtp_usuario", "").strip()
    smtp_senha = cfg.get("smtp_senha", "").strip()
    smtp_ssl = str(cfg.get("smtp_ssl", "")).lower() in ("1", "true", "sim", "yes")
    email_rem = cfg.get("smtp_email_remetente") or smtp_usuario
    nome_rem = cfg.get("smtp_nome_remetente") or cfg.get("empresa_nome") or "DevSystem PRIME"

    if not smtp_host or not smtp_usuario or not smtp_senha:
        return jsonify({"erro": "Configure o servidor SMTP em Configurações antes de enviar emails"}), 400

    # Busca dados do fornecedor
    forn = query("SELECT * FROM fornecedores WHERE id=?", (d.get("fornecedor_id"),), fetchone=True) or {}
    empresa = cfg.get("empresa_nome") or "Oficina"
    from datetime import date
    hoje = date.today().strftime("%d/%m/%Y")

    # Monta tabela HTML do pedido
    linhas_html = "".join(f"""
        <tr>
          <td style="padding:8px;border-bottom:1px solid #eee">{it.get('codigo') or '—'}</td>
          <td style="padding:8px;border-bottom:1px solid #eee">{it.get('nome')}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">{it.get('quantidade')}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">
            {"R$ {:.2f}".format(float(it.get('preco_referencia') or 0)) if it.get('preco_referencia') else '—'}
          </td>
        </tr>""" for it in itens)

    obs_html = f"<p><strong>Observações:</strong> {d.get('obs')}</p>" if d.get('obs') else ""
    prazo_html = f"<p><strong>Prazo desejado:</strong> {d.get('prazo')}</p>" if d.get('prazo') else ""

    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;color:#222">
      <div style="background:#1a6b6b;padding:20px 24px;border-radius:8px 8px 0 0">
        <h2 style="color:#fff;margin:0">Pedido de Cotação</h2>
        <p style="color:#b2dfdf;margin:4px 0 0">{empresa} — {hoje}</p>
      </div>
      <div style="background:#fff;padding:24px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px">
        <p>Prezados <strong>{forn.get('nome', 'Fornecedor')}</strong>,</p>
        <p>Solicitamos cotação para os itens abaixo:</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <thead>
            <tr style="background:#f5f5f5">
              <th style="padding:8px;text-align:left;font-size:12px">Código</th>
              <th style="padding:8px;text-align:left;font-size:12px">Produto</th>
              <th style="padding:8px;text-align:center;font-size:12px">Qtd.</th>
              <th style="padding:8px;text-align:right;font-size:12px">Ref. Último Preço</th>
            </tr>
          </thead>
          <tbody>{linhas_html}</tbody>
        </table>
        {prazo_html}
        {obs_html}
        <p>Por favor, responda com disponibilidade, preços e prazo de entrega.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
        <p style="font-size:12px;color:#888">
          {empresa}<br>
          {cfg.get('empresa_telefone') or ''}<br>
          {email_rem}
        </p>
      </div>
    </div>"""

    assunto = d.get("assunto_custom") or f"Pedido de Cotação — {empresa} — {hoje}"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = assunto
    msg["From"] = f"{nome_rem} <{email_rem}>"
    msg["To"] = email_destino
    msg.attach(MIMEText(html, "html", "utf-8"))

    try:
        if smtp_ssl:
            srv = smtplib.SMTP_SSL(smtp_host, smtp_porta, timeout=15)
        else:
            srv = smtplib.SMTP(smtp_host, smtp_porta, timeout=15)
            srv.starttls()
        srv.login(smtp_usuario, smtp_senha)
        srv.sendmail(email_rem, [email_destino], msg.as_string())
        srv.quit()
    except Exception as e:
        return jsonify({"erro": f"Falha ao enviar email: {e}"}), 500

    registrar_log(session["user_id"], "cotacao_enviada",
                  f"forn={d.get('fornecedor_id')} email={email_destino} itens={len(itens)}")
    return jsonify({"ok": True, "enviado_para": email_destino, "itens": len(itens)})
