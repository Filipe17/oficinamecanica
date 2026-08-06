"""
xml.py — Importação de XML de NF-e (entrada de mercadorias).

Lê o XML da nota, extrai fornecedor e itens (produtos, quantidades, preços,
tributos, NCM/CFOP/EAN), cadastra produtos inexistentes, atualiza o estoque
automaticamente e evita reimportar a mesma nota (controle pela chave de acesso).

O parser usa xml.etree do próprio Python (sem dependências externas) e é
tolerante ao namespace padrão da NF-e.
"""

import xml.etree.ElementTree as ET
from flask import Blueprint, request, jsonify, session
from database.database import query, now, registrar_log
from api.usuarios import login_obrigatorio
from api.estoque import movimentar_estoque

xml_bp = Blueprint("xml", __name__)

# Namespace padrão do portal da NF-e
NS = {"nfe": "http://www.portalfiscal.inf.br/nfe"}


def _texto(elemento, caminho, default=""):
    """Busca texto respeitando o namespace; devolve default se não achar."""
    if elemento is None:
        return default
    achado = elemento.find(caminho, NS)
    return achado.text if (achado is not None and achado.text) else default


def _parse_nfe(conteudo_xml):
    """Extrai os dados relevantes do XML. Retorna dict com fornecedor + itens."""
    root = ET.fromstring(conteudo_xml)

    # A infNFe pode estar sob nfeProc/NFe/infNFe ou NFe/infNFe
    infnfe = root.find(".//nfe:infNFe", NS)
    if infnfe is None:
        raise ValueError("XML não parece ser uma NF-e válida")

    chave = (infnfe.get("Id") or "").replace("NFe", "")

    emit = infnfe.find("nfe:emit", NS)
    fornecedor = _texto(emit, "nfe:xNome") or _texto(emit, "nfe:xFant")
    cnpj = _texto(emit, "nfe:CNPJ")

    itens = []
    for det in infnfe.findall("nfe:det", NS):
        prod = det.find("nfe:prod", NS)
        if prod is None:
            continue
        itens.append({
            "codigo": _texto(prod, "nfe:cProd"),
            "ean": _texto(prod, "nfe:cEAN"),
            "nome": _texto(prod, "nfe:xProd"),
            "ncm": _texto(prod, "nfe:NCM"),
            "cfop": _texto(prod, "nfe:CFOP"),
            "quantidade": float(_texto(prod, "nfe:qCom", "0") or 0),
            "valor_unitario": float(_texto(prod, "nfe:vUnCom", "0") or 0),
        })

    valor_total = float(
        _texto(infnfe.find("nfe:total/nfe:ICMSTot", NS), "nfe:vNF", "0") or 0)

    return {"chave": chave, "fornecedor": fornecedor, "cnpj": cnpj,
            "itens": itens, "valor_total": valor_total}


@xml_bp.route("/api/xml/importar", methods=["POST"])
@login_obrigatorio
def importar():
    """
    Recebe o arquivo XML (multipart 'arquivo' ou JSON {'xml': '...'}),
    processa e atualiza o estoque.
    """
    conteudo = None
    if "arquivo" in request.files:
        conteudo = request.files["arquivo"].read().decode("utf-8", errors="ignore")
    else:
        d = request.get_json(silent=True) or {}
        conteudo = d.get("xml")

    if not conteudo:
        return jsonify({"erro": "Nenhum XML enviado"}), 400

    try:
        dados = _parse_nfe(conteudo)
    except (ET.ParseError, ValueError) as e:
        return jsonify({"erro": f"Falha ao ler XML: {e}"}), 400

    # Evita duplicidade pela chave de acesso
    if dados["chave"]:
        ja = query("SELECT id FROM xml_importacoes WHERE chave=?",
                   (dados["chave"],), fetchone=True)
        if ja:
            return jsonify({"erro": "Esta nota já foi importada"}), 409

    # Garante que o fornecedor existe
    fornecedor_id = None
    if dados["fornecedor"]:
        f = query("SELECT id FROM fornecedores WHERE nome=?",
                  (dados["fornecedor"],), fetchone=True)
        if f:
            fornecedor_id = f["id"]
        else:
            r = query("INSERT INTO fornecedores (nome, cnpj, criado_em) VALUES (?,?,?)",
                      (dados["fornecedor"], dados["cnpj"], now()), commit=True)
            fornecedor_id = r["_lastid"]

    novos, atualizados = 0, 0
    for it in dados["itens"]:
        # Procura produto por EAN ou código
        existente = None
        if it["ean"] and it["ean"] not in ("SEM GTIN", ""):
            existente = query("SELECT * FROM produtos WHERE ean=?",
                              (it["ean"],), fetchone=True)
        if not existente and it["codigo"]:
            existente = query("SELECT * FROM produtos WHERE codigo=?",
                              (it["codigo"],), fetchone=True)

        if existente:
            # Atualiza preço de compra e dá entrada no estoque
            query("UPDATE produtos SET preco_compra=?, fornecedor_id=? WHERE id=?",
                  (it["valor_unitario"], fornecedor_id, existente["id"]), commit=True)
            movimentar_estoque(existente["id"], "entrada", it["quantidade"],
                               origem="xml", documento=dados["chave"])
            atualizados += 1
        else:
            # Cadastra produto novo (preço de venda inicia igual ao de compra)
            r = query(
                "INSERT INTO produtos (codigo, ean, nome, ncm, cfop, fornecedor_id, "
                "preco_compra, preco_venda, estoque_atual, criado_em) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                (it["codigo"], it["ean"], it["nome"], it["ncm"], it["cfop"],
                 fornecedor_id, it["valor_unitario"], it["valor_unitario"],
                 0, now()), commit=True)
            movimentar_estoque(r["_lastid"], "entrada", it["quantidade"],
                               origem="xml", documento=dados["chave"])
            novos += 1

    # Registra histórico da importação
    query(
        "INSERT INTO xml_importacoes (chave, fornecedor, qtd_produtos, valor_total, criado_em) "
        "VALUES (?,?,?,?,?)",
        (dados["chave"], dados["fornecedor"], len(dados["itens"]),
         dados["valor_total"], now()), commit=True)

    registrar_log(session["user_id"], "importar_xml", dados["chave"])
    return jsonify({
        "ok": True,
        "fornecedor": dados["fornecedor"],
        "produtos_novos": novos,
        "produtos_atualizados": atualizados,
        "total_itens": len(dados["itens"]),
    })


@xml_bp.route("/api/xml/historico", methods=["GET"])
@login_obrigatorio
def historico():
    lista = query("SELECT * FROM xml_importacoes ORDER BY id DESC LIMIT 100")
    return jsonify({"dados": lista})


# =========================================================================
# Importação de Produtos em Lote (XML próprio do DevSystem PRIME)
# =========================================================================

def _parse_produtos_xml(conteudo):
    """
    Lê o XML de produtos no formato próprio do DevSystem PRIME.
    Retorna lista de dicts com os campos do produto + variações.
    """
    root = ET.fromstring(conteudo)
    if root.tag != "produtos":
        raise ValueError("XML não parece ser um arquivo de importação de produtos válido")

    def txt(el, tag, default=""):
        found = el.find(tag)
        return (found.text or "").strip() if found is not None else default

    def num(el, tag, default=0.0):
        v = txt(el, tag)
        try: return float(v) if v else default
        except ValueError: return default

    produtos = []
    for p in root.findall("produto"):
        variacoes = []
        vars_el = p.find("variacoes")
        if vars_el is not None:
            for v in vars_el.findall("variacao"):
                variacoes.append({
                    "atributo":           txt(v, "atributo"),
                    "codigo":             txt(v, "codigo") or None,
                    "codigo_barras":      txt(v, "codigo_barras") or None,
                    "ean":                txt(v, "ean") or None,
                    "preco_compra":       num(v, "preco_compra"),
                    "preco_venda":        num(v, "preco_venda"),
                    "estoque_atual":      num(v, "estoque_atual"),
                    "estoque_minimo":     num(v, "estoque_minimo"),
                    "estoque_maximo":     num(v, "estoque_maximo"),
                    "comissao_percentual":num(v, "comissao_percentual"),
                })
        produtos.append({
            "codigo":             txt(p, "codigo") or None,
            "codigo_barras":      txt(p, "codigo_barras") or None,
            "nome":               txt(p, "nome"),
            "categoria":          txt(p, "categoria") or None,
            "marca":              txt(p, "marca") or None,
            "fornecedor":         txt(p, "fornecedor") or None,
            "localizacao":        txt(p, "localizacao") or None,
            "preco_compra":       num(p, "preco_compra"),
            "preco_venda":        num(p, "preco_venda"),
            "estoque_atual":      num(p, "estoque_atual"),
            "estoque_minimo":     num(p, "estoque_minimo"),
            "estoque_maximo":     num(p, "estoque_maximo"),
            "comissao_percentual":num(p, "comissao_percentual"),
            "ncm":                txt(p, "ncm") or None,
            "cfop":               txt(p, "cfop") or None,
            "cest":               txt(p, "cest") or None,
            "ean":                txt(p, "ean") or None,
            "variacoes":          variacoes,
        })

    if not produtos:
        raise ValueError("Nenhum produto encontrado no XML")
    return produtos


@xml_bp.route("/api/xml/importar-produtos", methods=["POST"])
@login_obrigatorio
def importar_produtos():
    """
    Importa produtos em lote a partir do XML próprio do DevSystem PRIME.
    Cria produtos novos e atualiza existentes (localiza por código ou EAN).
    Suporta grade: variações são criadas como produtos filhos (produto_pai_id).
    """
    conteudo = None
    if "arquivo" in request.files:
        conteudo = request.files["arquivo"].read().decode("utf-8", errors="ignore")
    else:
        d = request.get_json(silent=True) or {}
        conteudo = d.get("xml")

    if not conteudo:
        return jsonify({"erro": "Nenhum XML enviado"}), 400

    try:
        produtos = _parse_produtos_xml(conteudo)
    except (ET.ParseError, ValueError) as e:
        return jsonify({"erro": f"Falha ao ler XML de produtos: {e}"}), 400

    novos = atualizados = variacoes_criadas = 0

    for p in produtos:
        # Resolve fornecedor pelo nome
        fornecedor_id = None
        if p["fornecedor"]:
            f = query("SELECT id FROM fornecedores WHERE lower(nome)=lower(?)",
                      (p["fornecedor"],), fetchone=True)
            if f:
                fornecedor_id = f["id"]
            else:
                r = query("INSERT INTO fornecedores (nome, criado_em) VALUES (?,?)",
                          (p["fornecedor"], now()), commit=True)
                fornecedor_id = r["_lastid"]

        # Localiza produto existente por código ou EAN
        existente = None
        if p["codigo"]:
            existente = query("SELECT * FROM produtos WHERE codigo=? AND (produto_pai_id IS NULL OR produto_pai_id=0)",
                              (p["codigo"],), fetchone=True)
        if not existente and p["ean"]:
            existente = query("SELECT * FROM produtos WHERE ean=? AND (produto_pai_id IS NULL OR produto_pai_id=0)",
                              (p["ean"],), fetchone=True)

        if existente:
            query(
                "UPDATE produtos SET codigo=?, codigo_barras=?, nome=?, categoria=?, marca=?, "
                "fornecedor_id=?, localizacao=?, preco_compra=?, preco_venda=?, "
                "estoque_minimo=?, estoque_maximo=?, comissao_percentual=?, "
                "ncm=?, cfop=?, cest=?, ean=? WHERE id=?",
                (p["codigo"], p["codigo_barras"], p["nome"], p["categoria"], p["marca"],
                 fornecedor_id, p["localizacao"], p["preco_compra"], p["preco_venda"],
                 p["estoque_minimo"], p["estoque_maximo"], p["comissao_percentual"],
                 p["ncm"], p["cfop"], p["cest"], p["ean"], existente["id"]),
                commit=True,
            )
            pai_id = existente["id"]
            atualizados += 1
        else:
            r = query(
                "INSERT INTO produtos (codigo, codigo_barras, nome, categoria, marca, "
                "fornecedor_id, localizacao, preco_compra, preco_venda, estoque_atual, "
                "estoque_minimo, estoque_maximo, comissao_percentual, ncm, cfop, cest, "
                "ean, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (p["codigo"], p["codigo_barras"], p["nome"], p["categoria"], p["marca"],
                 fornecedor_id, p["localizacao"], p["preco_compra"], p["preco_venda"],
                 p["estoque_atual"], p["estoque_minimo"], p["estoque_maximo"],
                 p["comissao_percentual"], p["ncm"], p["cfop"], p["cest"],
                 p["ean"], now()),
                commit=True,
            )
            pai_id = r["_lastid"]
            novos += 1

        # Processa variações
        for v in p.get("variacoes", []):
            if not v.get("atributo"):
                continue
            # Verifica se a variação já existe (mesmo pai + mesmo atributo)
            var_exist = query(
                "SELECT id FROM produtos WHERE produto_pai_id=? AND lower(variacao_atributo)=lower(?)",
                (pai_id, v["atributo"]), fetchone=True)
            nome_var = f"{p['nome']} — {v['atributo']}"
            if var_exist:
                query(
                    "UPDATE produtos SET codigo=?, codigo_barras=?, nome=?, preco_compra=?, "
                    "preco_venda=?, estoque_minimo=?, estoque_maximo=?, "
                    "comissao_percentual=?, ean=? WHERE id=?",
                    (v["codigo"], v["codigo_barras"], nome_var, v["preco_compra"],
                     v["preco_venda"], v["estoque_minimo"], v["estoque_maximo"],
                     v["comissao_percentual"], v["ean"], var_exist["id"]),
                    commit=True,
                )
            else:
                query(
                    "INSERT INTO produtos (produto_pai_id, variacao_atributo, codigo, "
                    "codigo_barras, nome, categoria, marca, fornecedor_id, localizacao, "
                    "preco_compra, preco_venda, estoque_atual, estoque_minimo, estoque_maximo, "
                    "comissao_percentual, ncm, cfop, cest, ean, criado_em) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (pai_id, v["atributo"], v["codigo"], v["codigo_barras"], nome_var,
                     p["categoria"], p["marca"], fornecedor_id, p["localizacao"],
                     v["preco_compra"], v["preco_venda"], v["estoque_atual"],
                     v["estoque_minimo"], v["estoque_maximo"], v["comissao_percentual"],
                     p["ncm"], p["cfop"], p["cest"], v["ean"], now()),
                    commit=True,
                )
                variacoes_criadas += 1

    registrar_log(session["user_id"], "importar_produtos_xml",
                  f"novos={novos} atualizados={atualizados} variacoes={variacoes_criadas}")
    return jsonify({
        "ok": True,
        "produtos_novos": novos,
        "produtos_atualizados": atualizados,
        "variacoes_criadas": variacoes_criadas,
        "total_produtos": len(produtos),
    })
