"""
configuracoes.py — Configurações gerais da empresa (nome, CNPJ, telefone, logo).

Guardadas como pares chave/valor na tabela 'configuracoes'. A logo é
armazenada como Data URL (base64) para persistir no banco — importante em
hospedagens com disco efêmero (ex.: Railway), onde arquivos em pasta somem
a cada deploy.

Leitura: liberada a qualquer usuário logado (usada no recibo e no menu).
Escrita: somente administrador.
"""

from flask import Blueprint, request, jsonify, session
from database.database import query, registrar_log
from api.usuarios import login_obrigatorio, perfil_permitido

configuracoes_bp = Blueprint("configuracoes", __name__)

CHAVES = ["empresa_nome", "empresa_cnpj", "empresa_telefone", "empresa_cep",
          "empresa_endereco", "empresa_numero", "empresa_bairro", "empresa_cidade",
          "empresa_estado", "empresa_logo",
          "empresa_regime_tributario", "empresa_inscricao_estadual",
          "empresa_inscricao_municipal", "nfe_provedor", "nfe_ambiente", "nfe_token",
          "boleto_provedor", "boleto_ambiente", "boleto_token", "boleto_metodo",
          "boleto_banco", "boleto_agencia", "boleto_conta", "boleto_convenio",
          "boleto_carteira", "boleto_banco_ambiente", "boleto_banco_credenciais",
          # SMTP para envio de emails (cotações, pedidos)
          "smtp_host", "smtp_porta", "smtp_usuario", "smtp_senha",
          "smtp_ssl", "smtp_email_remetente", "smtp_nome_remetente"]

# Limite da logo em base64 (~400 KB de imagem) para não inchar o banco/respostas.
LIMITE_LOGO = 600_000


def obter_config():
    """Retorna um dict {chave: valor} com as configurações salvas."""
    linhas = query("SELECT chave, valor FROM configuracoes")
    return {l["chave"]: l["valor"] for l in linhas}


@configuracoes_bp.route("/api/marca", methods=["GET"])
def marca():
    """
    Marca da empresa (nome + logo) para exibir na tela de login — leitura
    PÚBLICA (sem login), pois aparece antes de o usuário entrar. Só expõe
    nome e logo; dados sensíveis (CNPJ, endereço) continuam protegidos.
    """
    c = obter_config()
    return jsonify({"empresa_nome": c.get("empresa_nome"), "empresa_logo": c.get("empresa_logo")})


@configuracoes_bp.route("/api/configuracoes", methods=["GET"])
@login_obrigatorio
def obter():
    return jsonify(obter_config())


@configuracoes_bp.route("/api/configuracoes", methods=["POST"])
@login_obrigatorio
@perfil_permitido("administrador")
def salvar():
    d = request.get_json(force=True)
    logo = d.get("empresa_logo")
    if logo and len(logo) > LIMITE_LOGO:
        return jsonify({"erro": "Logo muito grande. Use uma imagem menor (até ~400 KB)."}), 400

    for chave in CHAVES:
        if chave not in d:
            continue
        valor = d.get(chave)
        existe = query("SELECT id FROM configuracoes WHERE chave=?", (chave,), fetchone=True)
        if existe:
            query("UPDATE configuracoes SET valor=? WHERE id=?", (valor, existe["id"]), commit=True)
        else:
            query("INSERT INTO configuracoes (chave, valor) VALUES (?,?)", (chave, valor), commit=True)

    registrar_log(session["user_id"], "salvar_configuracoes", "Configurações da empresa atualizadas")
    return jsonify({"ok": True})
