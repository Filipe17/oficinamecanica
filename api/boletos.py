"""
boletos.py — Emissão de boleto bancário (registrado) via provedor de pagamento.

O boleto nasce de uma conta a RECEBER do financeiro. Fluxo:
    conta a receber (aberto/atrasado) -> gerar boleto -> provedor registra no
    banco e devolve linha digitável + código de barras + PDF.

    Quando o cliente paga, o provedor avisa (webhook) e a conta é baixada
    automaticamente.

Este módulo é AGNÓSTICO de provedor: monta um payload genérico a partir da
conta e delega a um ADAPTADOR (_registrar_no_provedor), que você implementa
ao escolher Asaas / Efí (Gerencianet) / Cora / etc. Enquanto não houver
credenciais configuradas, roda em modo seguro (não registra nada).

IMPORTANTE: cada oficina configura o próprio provedor e token nas Configurações
(o sistema é alugado, então as credenciais são por empresa/instância).
"""

import os
from flask import Blueprint, request, jsonify, session
from database.database import query, now, registrar_log
from api.usuarios import login_obrigatorio, perfil_permitido
from api.configuracoes import obter_config

boletos_bp = Blueprint("boletos", __name__)


def _provedor_cfg():
    cfg = obter_config()
    return {
        "provedor": os.getenv("BOLETO_PROVEDOR", cfg.get("boleto_provedor", "")),
        "token": os.getenv("BOLETO_TOKEN", cfg.get("boleto_token", "")),
        "ambiente": os.getenv("BOLETO_AMBIENTE", cfg.get("boleto_ambiente", "homologacao")),
    }


def _dados_cobranca(fid):
    """Carrega a conta a receber + dados do cliente (pagador do boleto)."""
    return query(
        "SELECT f.*, c.nome AS cliente_nome, c.cpf_cnpj, c.email, c.telefone, "
        "c.cep, c.endereco, c.numero, c.bairro, c.cidade, c.estado "
        "FROM financeiro f LEFT JOIN clientes c ON c.id=f.cliente_id "
        "WHERE f.id=?", (fid,), fetchone=True)


def _montar_payload(f):
    """Payload genérico de cobrança (o adaptador traduz para o provedor)."""
    valor = (f.get("valor") or 0) + (f.get("juros") or 0) + (f.get("multa") or 0)
    return {
        "valor": round(valor, 2),
        "vencimento": (f.get("vencimento") or "")[:10],
        "descricao": f.get("descricao") or f"Cobrança #{f.get('id')}",
        "pagador": {
            "nome": f.get("cliente_nome"), "documento": f.get("cpf_cnpj"),
            "email": f.get("email"), "telefone": f.get("telefone"),
            "endereco": {
                "cep": f.get("cep"), "logradouro": f.get("endereco"),
                "numero": f.get("numero"), "bairro": f.get("bairro"),
                "cidade": f.get("cidade"), "uf": f.get("estado"),
            },
        },
    }


def _registrar_no_provedor(payload, ambiente):
    """
    >>> PONTO DE INTEGRAÇÃO <<<
    Envia a cobrança ao provedor e retorna dict padronizado:
      { status, boleto_id, linha_digitavel, codigo_barras, url_pdf,
        nosso_numero, mensagem }

    Sem provedor/token configurado -> modo seguro (não registra).
    Ao contratar (Asaas/Efí/Cora), implemente a chamada HTTP real aqui.
    """
    cfg = _provedor_cfg()
    if not cfg["provedor"] or not cfg["token"]:
        return {"status": "nao_configurado",
                "mensagem": "Provedor de boleto não configurado. Preencha em Configurações."}
    # Exemplo (a completar por provedor):
    #   import requests
    #   resp = requests.post(URL[cfg["provedor"]], json=traduzir(payload),
    #                        headers={"Authorization": f"Bearer {cfg['token']}"})
    #   return normalizar(cfg["provedor"], resp.json())
    return {"status": "erro",
            "mensagem": f"Provedor '{cfg['provedor']}' ainda não implementado no adaptador."}


def gerar_boleto_interno(fid):
    """
    Gera o boleto de uma conta a receber SEM depender do request HTTP.
    Usado tanto pela rota quanto pela finalização de orçamento (automático).
    Retorna o dict de resultado do provedor. Não levanta exceção por falta de
    configuração — apenas retorna status 'nao_configurado'.
    """
    f = _dados_cobranca(fid)
    if not f or f.get("tipo") != "receber" or f.get("status") == "pago":
        return {"status": "erro", "mensagem": "Conta inválida para boleto"}
    if f.get("boleto_id"):
        return {"status": "erro", "mensagem": "Já existe boleto para esta conta"}
    if not f.get("cpf_cnpj"):
        return {"status": "erro", "mensagem": "Cliente sem CPF/CNPJ"}

    cfg = _provedor_cfg()
    if not cfg["provedor"] or not cfg["token"]:
        return {"status": "nao_configurado",
                "mensagem": "Provedor de boleto não configurado"}

    payload = _montar_payload(f)
    r = _registrar_no_provedor(payload, cfg["ambiente"])
    if r.get("status") in ("registrado", "pendente"):
        query(
            "UPDATE financeiro SET boleto_id=?, boleto_status=?, boleto_linha=?, "
            "boleto_codigo_barras=?, boleto_url=?, boleto_nosso_numero=? WHERE id=?",
            (r.get("boleto_id"), r.get("status"), r.get("linha_digitavel"),
             r.get("codigo_barras"), r.get("url_pdf"), r.get("nosso_numero"), fid),
            commit=True)
    return r


@boletos_bp.route("/api/boletos/gerar/<int:fid>", methods=["POST"])
@login_obrigatorio
@perfil_permitido("administrador", "gerente", "financeiro")
def gerar(fid):
    """Gera (registra) um boleto para uma conta a receber (rota manual)."""
    f = _dados_cobranca(fid)
    if not f:
        return jsonify({"erro": "Lançamento não encontrado"}), 404
    if f.get("tipo") != "receber":
        return jsonify({"erro": "Boleto só para contas a receber"}), 400
    if f.get("status") == "pago":
        return jsonify({"erro": "Esta conta já está quitada"}), 400
    if f.get("boleto_id"):
        return jsonify({"erro": "Já existe boleto para esta conta",
                        "boleto_url": f.get("boleto_url")}), 400
    if not f.get("cpf_cnpj"):
        return jsonify({"erro": "O cliente precisa ter CPF/CNPJ para gerar boleto"}), 400

    cfg = _provedor_cfg()
    if not cfg["provedor"] or not cfg["token"]:
        return jsonify({"ok": False, "status": "nao_configurado",
                        "mensagem": "Provedor de boleto não configurado. Preencha em Configurações."}), 400

    r = gerar_boleto_interno(fid)
    if r.get("status") in ("registrado", "pendente"):
        registrar_log(session["user_id"], "gerar_boleto", str(fid))
        return jsonify({"ok": True, "status": r.get("status"),
                        "boleto_url": r.get("url_pdf"),
                        "linha_digitavel": r.get("linha_digitavel")})
    return jsonify({"ok": False, "status": r.get("status"),
                    "mensagem": r.get("mensagem")}), 400


@boletos_bp.route("/api/boletos/<int:fid>", methods=["GET"])
@login_obrigatorio
def consultar(fid):
    """Retorna os dados do boleto de uma conta (linha digitável, PDF, status)."""
    f = query("SELECT id, boleto_id, boleto_status, boleto_linha, "
              "boleto_codigo_barras, boleto_url, boleto_nosso_numero "
              "FROM financeiro WHERE id=?", (fid,), fetchone=True)
    if not f:
        return jsonify({"erro": "Lançamento não encontrado"}), 404
    return jsonify(f)
