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
