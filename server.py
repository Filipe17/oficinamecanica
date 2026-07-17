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
import shutil
from datetime import datetime, timedelta

from flask import Flask, send_from_directory, jsonify, session, redirect

from database.database import init_db, SQLITE_PATH
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
           os_bp, financeiro_bp, pdv_bp, xml_bp, relatorios_bp):
    app.register_blueprint(bp)


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
