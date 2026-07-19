"""
server.py — Ponto de entrada da aplicação.

Responsabilidades:
    - Criar o app Flask.
    - Servir as páginas HTML (pasta pages/) e os arquivos estáticos (static/).
    - Registrar todos os Blueprints da API (camada de rotas).
    - Inicializar o banco de dados.
    - Endpoints utilitários: backup do banco e verificação de saúde.

Arquitetura em camadas:
    server.py (rotas HTTP)  ->  api/*.py (regras de negócio)  ->  database.py (dados)

Execução local:
    pip install -r requirements.txt
    python server.py
    Acesse http://localhost:5000  (admin@oficina.com / admin123)
"""

import os
import re
import shutil
from datetime import datetime, timedelta

from flask import Flask, send_from_directory, jsonify, session, redirect, request

from database.database import init_db, SQLITE_PATH, query
from api.usuarios import usuarios_bp, login_obrigatorio, perfil_permitido
from api.clientes import clientes_bp
from api.veiculos import veiculos_bp
from api.produtos import produtos_bp
from api.estoque import estoque_bp
from api.ordem_servico import os_bp
from api.financeiro import financeiro_bp
from api.pdv import pdv_bp
from api.xml import xml_bp
from api.relatorios import relatorios_bp
from api.permissoes import permissoes_bp, nivel_de
from api.configuracoes import configuracoes_bp
from api.caixa import caixa_bp

# Diretórios base
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PAGES_DIR = os.path.join(BASE_DIR, "pages")
STATIC_DIR = os.path.join(BASE_DIR, "static")
BACKUP_DIR = os.path.join(BASE_DIR, "backup")

# -------------------------------------------------------------------------
# Criação do app
# -------------------------------------------------------------------------
app = Flask(__name__, static_folder=None)   # static próprio, tratado abaixo

# Chave usada para assinar o cookie de sessão. Em produção, defina SECRET_KEY.
app.secret_key = os.getenv("SECRET_KEY", "troque-esta-chave-em-producao")
app.permanent_session_lifetime = timedelta(days=30)   # "lembrar acesso"

# Registro dos Blueprints (cada módulo cuida de um domínio)
for bp in (usuarios_bp, clientes_bp, veiculos_bp, produtos_bp, estoque_bp,
           os_bp, financeiro_bp, pdv_bp, xml_bp, relatorios_bp, permissoes_bp,
           configuracoes_bp, caixa_bp):
    app.register_blueprint(bp)


# -------------------------------------------------------------------------
# Controle de acesso por perfil (configurável pelo administrador)
# -------------------------------------------------------------------------
# Cada rota é associada a um "módulo"; o nível do perfil naquele módulo
# (0=sem acesso, 1=visualizar, 2=completo) define o que é permitido.
# As regras vêm da tabela "permissoes" (tela de Permissões do admin).

# Prefixo de API -> módulo
_MODULO_API = [
    ("/api/dashboard", "dashboard"),
    ("/api/clientes", "clientes"),
    ("/api/veiculos", "veiculos"),
    ("/api/servicos", "servicos"),
    ("/api/produtos", "produtos"),
    ("/api/estoque", "estoque"),
    ("/api/xml", "xml"),
    ("/api/financeiro", "financeiro"),
    ("/api/cobrancas", "financeiro"),
    ("/api/pdv", "pdv"),
    ("/api/caixa", "caixa"),
    ("/api/relatorios", "relatorios"),
    ("/api/usuarios", "usuarios"),
    ("/api/logs", "logs"),
]
# Página HTML -> módulo (OS e Orçamentos são módulos separados)
_MODULO_PAGINA = {
    "dashboard": "dashboard", "clientes": "clientes", "veiculos": "veiculos",
    "ordem_servico": "ordem_servico", "orcamentos": "orcamentos",
    "servicos": "servicos", "produtos": "produtos", "estoque": "estoque",
    "xml": "xml", "financeiro": "financeiro", "cobrancas": "financeiro",
    "pdv": "pdv", "caixa": "caixa", "relatorios": "relatorios", "usuarios": "usuarios", "logs": "logs",
}
_SEMPRE_LIBERADO = ("/api/me", "/api/logout", "/api/login", "/api/health", "/", "/login")


def _modulo_os(path, metodo):
    """
    /api/os atende OS e Orçamentos (mesma tabela, flag eh_orcamento). Aqui
    descobrimos a qual módulo a requisição pertence, para aplicar a permissão
    certa (ex.: mecânico tem OS mas não Orçamento).
    """
    if path == "/api/os":
        if metodo == "GET":
            return "orcamentos" if request.args.get("orcamento") == "1" else "ordem_servico"
        corpo = request.get_json(silent=True) or {}
        try:
            eh = int(corpo.get("eh_orcamento", 0) or 0)
        except (TypeError, ValueError):
            eh = 0
        return "orcamentos" if eh == 1 else "ordem_servico"
    m = re.match(r"^/api/os/(\d+)", path)
    if m:
        row = query("SELECT eh_orcamento FROM ordens_servico WHERE id=?",
                    (int(m.group(1)),), fetchone=True)
        if row and row.get("eh_orcamento") == 1:
            return "orcamentos"
    return "ordem_servico"


@app.before_request
def _controle_acesso():
    if request.path.startswith("/static/"):
        return
    perfil = session.get("perfil")
    if not perfil or perfil == "administrador":
        return                       # não logado (rotas tratam) ou admin (tudo)
    if request.path in _SEMPRE_LIBERADO:
        return
    # Lista de mecânicos: liberada a qualquer usuário logado (só nomes)
    if request.path == "/api/os/mecanicos":
        return

    # A tela de Permissões é exclusiva do administrador.
    if request.path == "/permissoes" or request.path.startswith("/api/permissoes"):
        if request.path.startswith("/api/"):
            return jsonify({"erro": "Acesso não permitido"}), 403
        return redirect("/dashboard")

    # A página de Configurações é exclusiva do administrador (a leitura da API
    # de configurações continua liberada, pois o recibo/menu precisam dela).
    if request.path == "/configuracoes":
        return redirect("/dashboard")

    if request.path.startswith("/api/"):
        if request.path == "/api/os" or request.path.startswith("/api/os/"):
            modulo = _modulo_os(request.path, request.method)
        else:
            modulo = next((m for pref, m in _MODULO_API
                           if request.path == pref or request.path.startswith(pref + "/")), None)
        if modulo is None:
            return                   # rota não mapeada segue as travas próprias
        nivel = nivel_de(perfil, modulo)
        if nivel == 0:
            return jsonify({"erro": "Acesso não permitido para o seu perfil"}), 403
        if request.method in ("POST", "PUT", "DELETE", "PATCH") and nivel < 2:
            return jsonify({"erro": "Você só tem permissão de visualização aqui"}), 403
        return
    else:
        modulo = _MODULO_PAGINA.get(request.path.strip("/"))
        if modulo and nivel_de(perfil, modulo) == 0:
            return redirect("/dashboard")
        return


# -------------------------------------------------------------------------
# Servir páginas HTML
# -------------------------------------------------------------------------
@app.route("/")
def raiz():
    # Sem sessão -> login; com sessão -> dashboard
    if session.get("user_id"):
        return redirect("/dashboard")
    return redirect("/login")


@app.route("/<pagina>")
def pagina(pagina):
    """
    Serve pages/<pagina>.html. Todas exigem login, exceto a de login.
    O front carrega os dados via fetch() após a página abrir (SPA leve).
    """
    arquivo = f"{pagina}.html"
    caminho = os.path.join(PAGES_DIR, arquivo)
    if not os.path.exists(caminho):
        return "Página não encontrada", 404
    if pagina != "login" and not session.get("user_id"):
        return redirect("/login")
    return send_from_directory(PAGES_DIR, arquivo)


@app.route("/static/<path:caminho>")
def estaticos(caminho):
    """Serve CSS, JS, imagens da pasta static/."""
    return send_from_directory(STATIC_DIR, caminho)


# -------------------------------------------------------------------------
# Utilitários
# -------------------------------------------------------------------------
@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "hora": datetime.now().isoformat()})


@app.route("/api/backup", methods=["POST"])
@login_obrigatorio
@perfil_permitido("administrador")
def backup():
    """Copia o arquivo do banco para backup/ com carimbo de data/hora (SQLite)."""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    carimbo = datetime.now().strftime("%Y%m%d_%H%M%S")
    destino = os.path.join(BACKUP_DIR, f"banco_{carimbo}.db")
    if os.path.exists(SQLITE_PATH):
        shutil.copy2(SQLITE_PATH, destino)
        return jsonify({"ok": True, "arquivo": os.path.basename(destino)})
    return jsonify({"erro": "Banco não encontrado (modo PostgreSQL?)"}), 400


# -------------------------------------------------------------------------
# Inicialização
# -------------------------------------------------------------------------
# Cria as tabelas e o usuário admin (se necessário) já na importação do módulo.
# Isso é essencial em produção: servidores WSGI como o gunicorn importam
# "server:app" e NÃO executam o bloco __main__ abaixo.
init_db()

if __name__ == "__main__":
    # Execução local (servidor de desenvolvimento do Flask).
    porta = int(os.getenv("PORT", "5000"))
    debug = os.getenv("FLASK_DEBUG", "1") == "1"
    print("=" * 55)
    print(f" ERP Oficina rodando em http://localhost:{porta}")
    print(" Login padrão: admin@oficina.com  /  admin123")
    print("=" * 55)
    app.run(host="0.0.0.0", port=porta, debug=debug)
