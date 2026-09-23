"""
recuperar_senha.py — "Esqueci a senha" com código enviado por e-mail.

Fluxo:
    1) POST /api/esqueci-senha/enviar-codigo  {usuario, email}
       Se o e-mail digitado for o mesmo cadastrado no usuário, gera um código
       de 6 dígitos (válido por 15 min) e envia para esse e-mail.
       A resposta é sempre a mesma, para não revelar quais dados existem.
    2) POST /api/esqueci-senha/redefinir      {usuario, codigo, senha}
       Confere o código e grava a nova senha.

Envio de e-mail configurado por variáveis de ambiente (use UMA das opções):
    Resend (recomendado no Railway):  RESEND_API_KEY, EMAIL_FROM
    SMTP (ex.: Gmail):                SMTP_HOST, SMTP_PORT (587 ou 465),
                                      SMTP_USER, SMTP_PASS, SMTP_FROM
Sem nenhuma delas (desenvolvimento), o código é mostrado no console/logs.
"""

import json
import os
import secrets
import smtplib
import ssl
from datetime import datetime, timedelta
from email.message import EmailMessage
from urllib import error as urlerror
from urllib import request as urlrequest

from flask import Blueprint, jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash

from database.database import buscar_usuario_login, now, query, registrar_log

bp = Blueprint("recuperar_senha", __name__)

VALIDADE_MINUTOS = 15      # tempo de vida do código
MAX_TENTATIVAS = 5         # erros permitidos antes de invalidar o código
INTERVALO_REENVIO = 60     # segundos mínimos entre dois envios
SENHA_MINIMA = 6


def _fmt(dt):
    return dt.strftime("%Y-%m-%d %H:%M:%S")


ASSUNTO = "Código para redefinir sua senha"


def _texto_email(nome, codigo):
    return (
        f"Olá, {nome}!\n\n"
        f"Seu código para redefinir a senha é: {codigo}\n\n"
        f"Ele vale por {VALIDADE_MINUTOS} minutos. "
        f"Se você não pediu a troca de senha, ignore este e-mail."
    )


def _enviar_resend(destino, nome, codigo):
    """Envia pela API do Resend (HTTPS — não depende de portas SMTP)."""
    corpo = json.dumps({
        "from": os.getenv("EMAIL_FROM") or "MecPRIME <onboarding@resend.dev>",
        "to": [destino],
        "subject": ASSUNTO,
        "text": _texto_email(nome, codigo),
    }).encode("utf-8")
    req = urlrequest.Request(
        "https://api.resend.com/emails", data=corpo, method="POST",
        headers={
            "Authorization": f"Bearer {os.getenv('RESEND_API_KEY')}",
            "Content-Type": "application/json",
            "User-Agent": "MecPRIME/1.0",
        })
    try:
        with urlrequest.urlopen(req, timeout=20) as resp:
            resp.read()
    except urlerror.HTTPError as e:
        raise RuntimeError(f"Resend respondeu {e.code}: {e.read().decode('utf-8', 'ignore')}")


def _enviar_email(destino, nome, codigo):
    """Envia o código por e-mail (Resend, SMTP ou, sem nenhum, só no console)."""
    if os.getenv("RESEND_API_KEY"):
        _enviar_resend(destino, nome, codigo)
        return

    host = os.getenv("SMTP_HOST")
    if not host:
        print(f">> [DEV] Código de recuperação para {destino}: {codigo}")
        return

    msg = EmailMessage()
    msg["Subject"] = ASSUNTO
    msg["From"] = os.getenv("SMTP_FROM") or os.getenv("SMTP_USER")
    msg["To"] = destino
    msg.set_content(_texto_email(nome, codigo))

    porta = int(os.getenv("SMTP_PORT", "587"))
    contexto = ssl.create_default_context()
    if porta == 465:
        servidor = smtplib.SMTP_SSL(host, porta, context=contexto, timeout=20)
    else:
        servidor = smtplib.SMTP(host, porta, timeout=20)
        servidor.starttls(context=contexto)
    with servidor:
        if os.getenv("SMTP_USER"):
            servidor.login(os.getenv("SMTP_USER"), os.getenv("SMTP_PASS", ""))
        servidor.send_message(msg)


@bp.route("/api/esqueci-senha/enviar-codigo", methods=["POST"])
def enviar_codigo():
    dados = request.get_json(silent=True) or {}
    email = (dados.get("email") or "").strip().lower()
    if not email:
        return jsonify({"erro": "Informe o e-mail cadastrado"}), 400

    usuario = buscar_usuario_login(dados.get("usuario"))
    confere = (
        usuario
        and usuario.get("ativo")
        and (usuario.get("email") or "").strip().lower() == email
    )

    if confere:
        # Evita disparar vários e-mails seguidos
        limite = _fmt(datetime.now() - timedelta(seconds=INTERVALO_REENVIO))
        recente = query(
            "SELECT id FROM recuperacao_senha WHERE usuario_id=? AND criado_em>?",
            (usuario["id"], limite), fetchone=True)
        if not recente:
            # Só o código mais novo vale
            query("UPDATE recuperacao_senha SET usado=1 WHERE usuario_id=? AND usado=0",
                  (usuario["id"],), commit=True)
            codigo = f"{secrets.randbelow(1_000_000):06d}"
            expira = _fmt(datetime.now() + timedelta(minutes=VALIDADE_MINUTOS))
            query(
                "INSERT INTO recuperacao_senha "
                "(usuario_id, codigo_hash, expira_em, tentativas, usado, criado_em) "
                "VALUES (?,?,?,?,?,?)",
                (usuario["id"], generate_password_hash(codigo), expira, 0, 0, now()),
                commit=True)
            try:
                _enviar_email(usuario["email"], usuario["nome"], codigo)
            except Exception as erro:
                print(f">> Falha ao enviar e-mail de recuperação: {erro}")
                return jsonify({"erro": "Não foi possível enviar o e-mail agora. "
                                        "Tente novamente ou procure o administrador."}), 500
            registrar_log(usuario["id"], "recuperar_senha",
                          "Código de recuperação enviado por e-mail")

    # Mesma resposta em qualquer caso
    return jsonify({"ok": True})


@bp.route("/api/esqueci-senha/redefinir", methods=["POST"])
def redefinir():
    dados = request.get_json(silent=True) or {}
    codigo = "".join(c for c in str(dados.get("codigo") or "") if c.isdigit())
    senha = dados.get("senha") or ""
    if len(senha) < SENHA_MINIMA:
        return jsonify({"erro": f"A nova senha precisa ter pelo menos {SENHA_MINIMA} caracteres"}), 400

    invalido = (jsonify({"erro": "Código inválido ou expirado. Peça um novo código."}), 400)

    usuario = buscar_usuario_login(dados.get("usuario"))
    if not usuario or len(codigo) != 6:
        return invalido

    pedido = query(
        "SELECT * FROM recuperacao_senha WHERE usuario_id=? AND usado=0 ORDER BY id DESC",
        (usuario["id"],), fetchone=True)
    if not pedido or pedido["expira_em"] < now() or pedido["tentativas"] >= MAX_TENTATIVAS:
        return invalido

    if not check_password_hash(pedido["codigo_hash"], codigo):
        query("UPDATE recuperacao_senha SET tentativas=tentativas+1 WHERE id=?",
              (pedido["id"],), commit=True)
        return invalido

    query("UPDATE usuarios SET senha_hash=? WHERE id=?",
          (generate_password_hash(senha), usuario["id"]), commit=True)
    query("UPDATE recuperacao_senha SET usado=1 WHERE usuario_id=?",
          (usuario["id"],), commit=True)
    registrar_log(usuario["id"], "recuperar_senha", "Senha redefinida pelo código de e-mail")
    return jsonify({"ok": True})
