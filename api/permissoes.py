"""
permissoes.py — Permissões por perfil (configuráveis pelo administrador).

Cada módulo do sistema tem, para cada perfil, um nível de acesso:
  0 = sem acesso   1 = visualizar   2 = completo (criar/editar/excluir)

O administrador tem acesso total sempre (não é armazenado nem editável).
As permissões ficam em cache na memória e são recarregadas ao salvar.
"""

from flask import Blueprint, request, jsonify, session
from database.database import query, registrar_log, MODULOS_PERMISSAO

permissoes_bp = Blueprint("permissoes", __name__)

# Perfis configuráveis (administrador fica de fora: sempre completo)
PERFIS_CONFIG = ["gerente", "atendente", "mecanico", "financeiro", "caixa"]

# Cache: { perfil: { modulo: nivel } }
_cache = {}


def carregar_cache():
    """(Re)carrega todas as permissões do banco para a memória."""
    global _cache
    novo = {}
    for l in query("SELECT perfil, modulo, nivel FROM permissoes"):
        novo.setdefault(l["perfil"], {})[l["modulo"]] = l["nivel"]
    _cache = novo


def nivel_de(perfil, modulo):
    """Nível de acesso de um perfil a um módulo (0/1/2)."""
    if perfil == "administrador":
        return 2
    if not _cache:
        carregar_cache()
    return _cache.get(perfil, {}).get(modulo, 0)


def permissoes_do_perfil(perfil):
    """Mapa {modulo: nivel} usado pelo front (menu + telas)."""
    if perfil == "administrador":
        return {m: 2 for m in MODULOS_PERMISSAO}
    if not _cache:
        carregar_cache()
    base = _cache.get(perfil, {})
    return {m: base.get(m, 0) for m in MODULOS_PERMISSAO}


# ---- Importado por decoradores após a definição do blueprint ----
from api.usuarios import login_obrigatorio, perfil_permitido


@permissoes_bp.route("/api/permissoes", methods=["GET"])
@login_obrigatorio
@perfil_permitido("administrador")
def obter():
    if not _cache:
        carregar_cache()
    matriz = {p: {m: nivel_de(p, m) for m in MODULOS_PERMISSAO} for p in PERFIS_CONFIG}
    return jsonify({"modulos": MODULOS_PERMISSAO, "perfis": PERFIS_CONFIG, "permissoes": matriz})


@permissoes_bp.route("/api/permissoes", methods=["POST"])
@login_obrigatorio
@perfil_permitido("administrador")
def salvar():
    d = request.get_json(force=True)
    matriz = d.get("permissoes", {})
    for perfil, mods in matriz.items():
        if perfil not in PERFIS_CONFIG:
            continue
        for modulo, nivel in mods.items():
            if modulo not in MODULOS_PERMISSAO:
                continue
            nivel = int(nivel)
            existe = query("SELECT id FROM permissoes WHERE perfil=? AND modulo=?",
                           (perfil, modulo), fetchone=True)
            if existe:
                query("UPDATE permissoes SET nivel=? WHERE id=?",
                      (nivel, existe["id"]), commit=True)
            else:
                query("INSERT INTO permissoes (perfil, modulo, nivel) VALUES (?,?,?)",
                      (perfil, modulo, nivel), commit=True)
    carregar_cache()
    registrar_log(session["user_id"], "salvar_permissoes", "Permissões atualizadas")
    return jsonify({"ok": True})
