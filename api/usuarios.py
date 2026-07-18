"""
usuarios.py — Autenticação, sessão e gestão de usuários.

Camadas:
    Rotas (Flask Blueprint)  ->  Regras de negócio (funções _*)  ->  database.py

Autenticação por sessão (cookie assinado do Flask). O front envia/recebe JSON
via fetch(). O decorador @login_obrigatorio protege rotas; @perfil_permitido
restringe por nível de acesso (administrador, gerente, etc.).
"""

from functools import wraps
from flask import Blueprint, request, jsonify, session
from werkzeug.security import check_password_hash, generate_password_hash

from database.database import query, now, registrar_log

usuarios_bp = Blueprint("usuarios", __name__)


# -------------------------------------------------------------------------
# Decoradores de segurança (reutilizáveis por todos os módulos)
# -------------------------------------------------------------------------
def login_obrigatorio(func):
    """Bloqueia acesso a quem não está autenticado."""
    @wraps(func)
    def wrapper(*args, **kwargs):
        if not session.get("user_id"):
            return jsonify({"erro": "Não autenticado"}), 401
        return func(*args, **kwargs)
    return wrapper


def perfil_permitido(*perfis):
    """
    Restringe a rota a determinados perfis.
    Administrador tem acesso total automaticamente.
    Uso: @perfil_permitido("administrador", "financeiro")
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            perfil = session.get("perfil")
            if perfil != "administrador" and perfil not in perfis:
                return jsonify({"erro": "Sem permissão para esta ação"}), 403
            return func(*args, **kwargs)
        return wrapper
    return decorator


# -------------------------------------------------------------------------
# Regras de negócio
# -------------------------------------------------------------------------
def _autenticar(email, senha):
    """Valida credenciais e retorna o usuário (sem o hash) ou None."""
    u = query("SELECT * FROM usuarios WHERE email = ? AND ativo = 1",
              (email,), fetchone=True)
    if u and check_password_hash(u["senha_hash"], senha):
        u.pop("senha_hash", None)
        return u
    return None


# -------------------------------------------------------------------------
# Rotas de autenticação
# -------------------------------------------------------------------------
@usuarios_bp.route("/api/login", methods=["POST"])
def login():
    dados = request.get_json(force=True)
    u = _autenticar(dados.get("email", ""), dados.get("senha", ""))
    if not u:
        return jsonify({"erro": "E-mail ou senha inválidos"}), 401

    # Grava a sessão
    session.permanent = bool(dados.get("lembrar"))
    session["user_id"] = u["id"]
    session["nome"] = u["nome"]
    session["perfil"] = u["perfil"]

    registrar_log(u["id"], "login", f"Usuário {u['nome']} entrou no sistema")
    return jsonify({"ok": True, "usuario": u})


@usuarios_bp.route("/api/logout", methods=["POST"])
def logout():
    uid = session.get("user_id")
    session.clear()
    if uid:
        registrar_log(uid, "logout", "Usuário saiu")
    return jsonify({"ok": True})


@usuarios_bp.route("/api/me", methods=["GET"])
def me():
    """Retorna o usuário logado — usado pelo front para validar a sessão."""
    if not session.get("user_id"):
        return jsonify({"autenticado": False}), 401
    # Importação tardia evita dependência circular com o módulo de permissões.
    from api.permissoes import permissoes_do_perfil
    return jsonify({
        "autenticado": True,
        "usuario": {
            "id": session["user_id"],
            "nome": session["nome"],
            "perfil": session["perfil"],
        },
        "permissoes": permissoes_do_perfil(session["perfil"]),
    })


# -------------------------------------------------------------------------
# CRUD de usuários (somente administrador)
# -------------------------------------------------------------------------
@usuarios_bp.route("/api/usuarios", methods=["GET"])
@login_obrigatorio
@perfil_permitido("administrador", "gerente")
def listar_usuarios():
    lista = query("SELECT id, nome, email, perfil, ativo, criado_em "
                  "FROM usuarios ORDER BY nome")
    return jsonify(lista)


@usuarios_bp.route("/api/usuarios", methods=["POST"])
@login_obrigatorio
@perfil_permitido("administrador")
def criar_usuario():
    d = request.get_json(force=True)
    if not d.get("email") or not d.get("senha"):
        return jsonify({"erro": "E-mail e senha são obrigatórios"}), 400

    res = query(
        "INSERT INTO usuarios (nome, email, senha_hash, perfil, ativo, criado_em) "
        "VALUES (?,?,?,?,?,?)",
        (d.get("nome"), d.get("email"),
         generate_password_hash(d["senha"]),
         d.get("perfil", "atendente"), int(d.get("ativo", 1)), now()),
        commit=True,
    )
    registrar_log(session["user_id"], "criar_usuario", d.get("email"))
    return jsonify({"ok": True, "id": res["_lastid"]}), 201


@usuarios_bp.route("/api/usuarios/<int:uid>", methods=["PUT"])
@login_obrigatorio
@perfil_permitido("administrador")
def editar_usuario(uid):
    d = request.get_json(force=True)
    # Atualiza a senha apenas se enviada
    if d.get("senha"):
        query("UPDATE usuarios SET nome=?, email=?, perfil=?, ativo=?, senha_hash=? WHERE id=?",
              (d.get("nome"), d.get("email"), d.get("perfil"),
               int(d.get("ativo", 1)), generate_password_hash(d["senha"]), uid),
              commit=True)
    else:
        query("UPDATE usuarios SET nome=?, email=?, perfil=?, ativo=? WHERE id=?",
              (d.get("nome"), d.get("email"), d.get("perfil"),
               int(d.get("ativo", 1)), uid),
              commit=True)
    registrar_log(session["user_id"], "editar_usuario", str(uid))
    return jsonify({"ok": True})


@usuarios_bp.route("/api/usuarios/<int:uid>", methods=["DELETE"])
@login_obrigatorio
@perfil_permitido("administrador")
def excluir_usuario(uid):
    # Desativa em vez de apagar (mantém histórico/logs íntegros)
    query("UPDATE usuarios SET ativo=0 WHERE id=?", (uid,), commit=True)
    registrar_log(session["user_id"], "desativar_usuario", str(uid))
    return jsonify({"ok": True})
