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
          "smtp_ssl", "smtp_email_remetente", "smtp_nome_remetente",
          # Impressora de etiquetas
          "etiqueta_tipo", "etiqueta_mostrar_preco", "etiqueta_mostrar_barras",
          "etiqueta_mostrar_local", "etiqueta_mostrar_empresa"]

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


# =========================================================================
# BACKUP DO BANCO DE DADOS
# =========================================================================
import os, subprocess, threading, time
from pathlib import Path
from datetime import datetime

# Pasta onde os backups ficam salvos no servidor
BACKUP_DIR = Path("/app/backups")
BACKUP_DIR.mkdir(exist_ok=True)
# Mantém os últimos 7 backups (apaga os mais antigos)
BACKUP_RETENCAO = 7


def _gerar_backup():
    """
    Executa pg_dump e salva o arquivo .sql na pasta de backups.
    Retorna o caminho do arquivo gerado ou None em caso de erro.
    """
    from database.database import DB_ENGINE
    if DB_ENGINE != "postgres":
        return None, "Backup automático disponível apenas para PostgreSQL"

    import urllib.parse as _up
    db_url = os.getenv("DATABASE_URL", "")
    if not db_url:
        return None, "DATABASE_URL não configurada"

    # Parse da URL postgres://user:pass@host:port/dbname
    p = _up.urlparse(db_url.replace("postgres://", "postgresql://"))
    env = {
        **os.environ,
        "PGPASSWORD": p.password or "",
        "PGCONNECT_TIMEOUT": "30",
    }
    agora = datetime.now().strftime("%Y%m%d_%H%M%S")
    arquivo = BACKUP_DIR / f"backup_{agora}.sql"

    cmd = [
        "pg_dump",
        "-h", p.hostname,
        "-p", str(p.port or 5432),
        "-U", p.username,
        "-d", p.path.lstrip("/"),
        "-F", "p",          # formato plain SQL
        "--no-password",
        "-f", str(arquivo),
    ]
    try:
        result = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            return None, result.stderr.strip()
        # Remove backups antigos (mantém os últimos BACKUP_RETENCAO)
        backups = sorted(BACKUP_DIR.glob("backup_*.sql"), key=lambda f: f.stat().st_mtime)
        for antigo in backups[:-BACKUP_RETENCAO]:
            antigo.unlink(missing_ok=True)
        return str(arquivo), None
    except FileNotFoundError:
        return None, "pg_dump não encontrado no servidor"
    except subprocess.TimeoutExpired:
        return None, "Timeout ao gerar backup"
    except Exception as e:
        return None, str(e)


def _agendar_backup_diario():
    """Thread que espera até 23h e gera o backup diariamente."""
    def _loop():
        while True:
            agora = datetime.now()
            # Calcula segundos até às 23:00 de hoje (ou amanhã se já passou)
            alvo = agora.replace(hour=23, minute=0, second=0, microsecond=0)
            if agora >= alvo:
                # Já passou das 23h — agenda para amanhã
                from datetime import timedelta
                alvo = alvo + timedelta(days=1)
            espera = (alvo - agora).total_seconds()
            time.sleep(espera)
            caminho, erro = _gerar_backup()
            if caminho:
                print(f"[BACKUP] Backup gerado: {caminho}")
            else:
                print(f"[BACKUP] Erro ao gerar backup: {erro}")
    t = threading.Thread(target=_loop, daemon=True, name="backup-diario")
    t.start()


# Inicia o agendador quando o módulo é carregado
_agendar_backup_diario()


@configuracoes_bp.route("/api/backup/gerar", methods=["POST"])
@login_obrigatorio
@perfil_permitido("administrador")
def gerar_backup_manual():
    """Gera um backup imediato (manual)."""
    caminho, erro = _gerar_backup()
    if erro:
        return jsonify({"erro": erro}), 500
    tamanho = Path(caminho).stat().st_size
    return jsonify({
        "ok": True,
        "arquivo": Path(caminho).name,
        "tamanho_bytes": tamanho,
        "tamanho": f"{tamanho / 1024 / 1024:.2f} MB" if tamanho > 1024*1024 else f"{tamanho / 1024:.1f} KB",
    })


@configuracoes_bp.route("/api/backup/listar", methods=["GET"])
@login_obrigatorio
@perfil_permitido("administrador")
def listar_backups():
    """Lista os backups disponíveis no servidor."""
    backups = sorted(BACKUP_DIR.glob("backup_*.sql"),
                     key=lambda f: f.stat().st_mtime, reverse=True)
    return jsonify({
        "backups": [{
            "arquivo": f.name,
            "tamanho": f"{f.stat().st_size / 1024 / 1024:.2f} MB" if f.stat().st_size > 1024*1024 else f"{f.stat().st_size / 1024:.1f} KB",
            "tamanho_bytes": f.stat().st_size,
            "criado_em": datetime.fromtimestamp(f.stat().st_mtime).strftime("%d/%m/%Y %H:%M"),
        } for f in backups],
        "total": len(backups),
    })


@configuracoes_bp.route("/api/backup/baixar/<nome>", methods=["GET"])
@login_obrigatorio
@perfil_permitido("administrador")
def baixar_backup(nome):
    """Baixa um arquivo de backup específico."""
    from flask import send_file
    # Segurança: só permite nomes no formato backup_YYYYMMDD_HHMMSS.sql
    import re
    if not re.match(r"^backup_\d{8}_\d{6}\.sql$", nome):
        return jsonify({"erro": "Arquivo inválido"}), 400
    caminho = BACKUP_DIR / nome
    if not caminho.exists():
        return jsonify({"erro": "Arquivo não encontrado"}), 404
    return send_file(str(caminho), as_attachment=True, download_name=nome,
                     mimetype="application/octet-stream")
