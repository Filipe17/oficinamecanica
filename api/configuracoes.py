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
          "nfce_serie", "nfce_numero_inicial", "nfce_csc", "nfce_csc_id", "nfce_ativo",
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
# BACKUP DO BANCO DE DADOS (via psycopg2 — sem pg_dump)
# =========================================================================
import os, threading, time
from pathlib import Path
from datetime import datetime

BACKUP_DIR = Path("/app/backups")
BACKUP_DIR.mkdir(exist_ok=True)
BACKUP_RETENCAO = 7


def _split_sql(sql):
    """Divide SQL em statements sem depender do sqlparse."""
    statements, current, in_string, string_char = [], [], False, None
    for char in sql:
        if in_string:
            current.append(char)
            if char == string_char: in_string = False
        elif char in ("'", '"'):
            in_string, string_char = True, char
            current.append(char)
        elif char == ';':
            current.append(char)
            stmt = ''.join(current).strip()
            if stmt and not stmt.startswith('--'): statements.append(stmt)
            current = []
        else:
            current.append(char)
    stmt = ''.join(current).strip()
    if stmt and not stmt.startswith('--'): statements.append(stmt)
    return statements


def _gerar_backup():
    """
    Gera backup do PostgreSQL usando psycopg2 puro (sem pg_dump).
    Exporta todas as tabelas como INSERT INTO statements.
    """
    import urllib.parse as _up

    db_url = os.getenv("DATABASE_URL", "")
    if not db_url:
        return None, "DATABASE_URL não configurada"

    try:
        import psycopg2
    except ImportError:
        return None, "psycopg2 não instalado"

    agora = datetime.now().strftime("%Y%m%d_%H%M%S")
    arquivo = BACKUP_DIR / f"backup_{agora}.sql"

    try:
        p = _up.urlparse(db_url.replace("postgres://", "postgresql://"))
        conn = psycopg2.connect(
            host=p.hostname, port=p.port or 5432,
            user=p.username, password=p.password,
            dbname=p.path.lstrip("/"), connect_timeout=30,
        )
        cur = conn.cursor()

        with open(arquivo, "w", encoding="utf-8") as f:
            f.write(f"-- Backup DevSystem PRIME\n")
            f.write(f"-- Gerado em: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}\n\n")
            f.write("SET client_encoding = 'UTF8';\n")
            f.write("SET standard_conforming_strings = on;\n\n")

            cur.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
            tabelas = [r[0] for r in cur.fetchall()]

            for tabela in tabelas:
                cur.execute(f'SELECT COUNT(*) FROM "{tabela}"')
                if cur.fetchone()[0] == 0:
                    continue
                cur.execute(f'SELECT * FROM "{tabela}"')
                cols = [desc[0] for desc in cur.description]
                cols_str = ", ".join(f'"{c}"' for c in cols)
                f.write(f'\n-- {tabela}\nDELETE FROM "{tabela}";\n')
                batch = cur.fetchmany(500)
                while batch:
                    for row in batch:
                        vals = []
                        for v in row:
                            if v is None: vals.append("NULL")
                            elif isinstance(v, bool): vals.append("TRUE" if v else "FALSE")
                            elif isinstance(v, (int, float)): vals.append(str(v))
                            else: vals.append("'" + str(v).replace("'", "''") + "'")
                        f.write(f'INSERT INTO "{tabela}" ({cols_str}) VALUES ({", ".join(vals)});\n')
                    batch = cur.fetchmany(500)

            # Reseta sequências
            cur.execute("SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema='public'")
            f.write("\n-- Sequências\n")
            for (seq,) in cur.fetchall():
                cur.execute(f'SELECT last_value FROM "{seq}"')
                lv = cur.fetchone()[0]
                f.write(f"SELECT setval('{seq}', {lv}, true);\n")

        cur.close(); conn.close()
        # Remove backups antigos
        backups = sorted(BACKUP_DIR.glob("backup_*.sql"), key=lambda f: f.stat().st_mtime)
        for antigo in backups[:-BACKUP_RETENCAO]:
            antigo.unlink(missing_ok=True)
        return str(arquivo), None

    except Exception as e:
        if arquivo.exists(): arquivo.unlink(missing_ok=True)
        return None, str(e)


def _agendar_backup_diario():
    def _loop():
        while True:
            from datetime import timedelta
            agora = datetime.now()
            alvo = agora.replace(hour=23, minute=0, second=0, microsecond=0)
            if agora >= alvo:
                alvo += timedelta(days=1)
            time.sleep((alvo - agora).total_seconds())
            caminho, erro = _gerar_backup()
            print(f"[BACKUP] {'OK: ' + caminho if caminho else 'Erro: ' + erro}")
    threading.Thread(target=_loop, daemon=True, name="backup-diario").start()

_agendar_backup_diario()


@configuracoes_bp.route("/api/backup/gerar", methods=["POST"])
@login_obrigatorio
@perfil_permitido("administrador")
def gerar_backup_manual():
    caminho, erro = _gerar_backup()
    if erro:
        return jsonify({"erro": erro}), 500
    tamanho = Path(caminho).stat().st_size
    return jsonify({
        "ok": True,
        "arquivo": Path(caminho).name,
        "tamanho": f"{tamanho/1024/1024:.2f} MB" if tamanho > 1024*1024 else f"{tamanho/1024:.1f} KB",
    })


@configuracoes_bp.route("/api/backup/listar", methods=["GET"])
@login_obrigatorio
@perfil_permitido("administrador")
def listar_backups():
    backups = sorted(BACKUP_DIR.glob("backup_*.sql"), key=lambda f: f.stat().st_mtime, reverse=True)
    return jsonify({"backups": [{
        "arquivo": f.name,
        "tamanho": f"{f.stat().st_size/1024/1024:.2f} MB" if f.stat().st_size > 1024*1024 else f"{f.stat().st_size/1024:.1f} KB",
        "criado_em": datetime.fromtimestamp(f.stat().st_mtime).strftime("%d/%m/%Y %H:%M"),
    } for f in backups], "total": len(backups)})


@configuracoes_bp.route("/api/backup/baixar/<nome>", methods=["GET"])
@login_obrigatorio
@perfil_permitido("administrador")
def baixar_backup(nome):
    from flask import send_file
    import re
    if not re.match(r"^backup_\d{8}_\d{6}\.sql$", nome):
        return jsonify({"erro": "Arquivo inválido"}), 400
    caminho = BACKUP_DIR / nome
    if not caminho.exists():
        return jsonify({"erro": "Arquivo não encontrado"}), 404
    return send_file(str(caminho), as_attachment=True, download_name=nome,
                     mimetype="application/octet-stream")


@configuracoes_bp.route("/api/backup/restaurar/<nome>", methods=["POST"])
@login_obrigatorio
@perfil_permitido("administrador")
def restaurar_backup(nome):
    """
    Restaura o banco a partir de um arquivo de backup.
    ATENÇÃO: apaga os dados atuais e reinsere os do backup.
    Antes de restaurar, gera automaticamente um backup dos dados atuais.
    """
    import re, urllib.parse as _up

    # Valida nome do arquivo
    if not re.match(r"^backup_\d{8}_\d{6}\.sql$", nome):
        return jsonify({"erro": "Arquivo inválido"}), 400

    caminho = BACKUP_DIR / nome
    if not caminho.exists():
        return jsonify({"erro": "Arquivo de backup não encontrado"}), 404

    db_url = os.getenv("DATABASE_URL", "")
    if not db_url:
        return jsonify({"erro": "DATABASE_URL não configurada"}), 500

    try:
        import psycopg2
    except ImportError:
        return jsonify({"erro": "psycopg2 não instalado"}), 500

    # 1) Gera backup de segurança dos dados atuais ANTES de restaurar
    backup_seguranca, erro_seg = _gerar_backup()
    if not backup_seguranca:
        return jsonify({"erro": f"Falha ao gerar backup de segurança antes de restaurar: {erro_seg}"}), 500

    # 2) Lê o arquivo SQL
    try:
        sql_content = caminho.read_text(encoding="utf-8")
    except Exception as e:
        return jsonify({"erro": f"Erro ao ler arquivo de backup: {e}"}), 500

    # 3) Executa o SQL no banco
    try:
        p = _up.urlparse(db_url.replace("postgres://", "postgresql://"))
        conn = psycopg2.connect(
            host=p.hostname, port=p.port or 5432,
            user=p.username, password=p.password,
            dbname=p.path.lstrip("/"), connect_timeout=30,
        )
        conn.autocommit = False
        cur = conn.cursor()

        # Desativa constraints temporariamente para restaurar sem erro de FK
        cur.execute("SET session_replication_role = 'replica';")

        # Executa cada statement do SQL
        executados = 0
        for stmt in _split_sql(sql_content):
            stmt = stmt.strip()
            if not stmt or stmt.startswith("--"): continue
            try:
                cur.execute("SAVEPOINT sp;")
                cur.execute(stmt)
                cur.execute("RELEASE SAVEPOINT sp;")
                executados += 1
            except Exception:
                cur.execute("ROLLBACK TO SAVEPOINT sp;")

        # Reativa constraints
        cur.execute("SET session_replication_role = 'origin';")
        conn.commit()
        cur.close(); conn.close()

        registrar_log(session["user_id"], "restaurar_backup",
                      f"arquivo={nome} backup_seguranca={Path(backup_seguranca).name}")
        return jsonify({
            "ok": True,
            "arquivo_restaurado": nome,
            "backup_seguranca": Path(backup_seguranca).name,
            "statements_executados": executados,
        })

    except Exception as e:
        return jsonify({
            "erro": f"Falha na restauração: {e}",
            "backup_seguranca": Path(backup_seguranca).name if backup_seguranca else None,
        }), 500


@configuracoes_bp.route("/api/backup/restaurar-upload", methods=["POST"])
@login_obrigatorio
@perfil_permitido("administrador")
def restaurar_backup_upload():
    """
    Restaura o banco a partir de um arquivo .sql enviado pelo usuário
    (upload da máquina local). Igual ao restaurar_backup, mas recebe
    o arquivo via multipart/form-data em vez de buscar no servidor.
    """
    import re, urllib.parse as _up

    if "arquivo" not in request.files:
        return jsonify({"erro": "Nenhum arquivo enviado"}), 400

    arq = request.files["arquivo"]
    if not arq.filename.endswith(".sql"):
        return jsonify({"erro": "Apenas arquivos .sql são aceitos"}), 400

    db_url = os.getenv("DATABASE_URL", "")
    if not db_url:
        return jsonify({"erro": "DATABASE_URL não configurada"}), 500

    try:
        import psycopg2
    except ImportError:
        return jsonify({"erro": "psycopg2 não instalado"}), 500

    # 1) Salva o arquivo enviado temporariamente
    from datetime import datetime as _dt
    agora = _dt.now().strftime("%Y%m%d_%H%M%S")
    tmp = BACKUP_DIR / f"upload_{agora}.sql"
    arq.save(str(tmp))

    # 2) Gera backup de segurança antes de restaurar
    backup_seguranca, erro_seg = _gerar_backup()
    if not backup_seguranca:
        tmp.unlink(missing_ok=True)
        return jsonify({"erro": f"Falha ao gerar backup de segurança: {erro_seg}"}), 500

    # 3) Lê e executa o SQL
    try:
        sql_content = tmp.read_text(encoding="utf-8")
    except Exception as e:
        tmp.unlink(missing_ok=True)
        return jsonify({"erro": f"Erro ao ler arquivo: {e}"}), 500

    try:
        p = _up.urlparse(db_url.replace("postgres://", "postgresql://"))
        conn = psycopg2.connect(
            host=p.hostname, port=p.port or 5432,
            user=p.username, password=p.password,
            dbname=p.path.lstrip("/"), connect_timeout=30,
        )
        conn.autocommit = False
        cur = conn.cursor()
        cur.execute("SET session_replication_role = 'replica';")

        executados = 0
        for stmt in _split_sql(sql_content):
            stmt = stmt.strip()
            if not stmt or stmt.startswith("--"): continue
            try:
                cur.execute("SAVEPOINT sp;")
                cur.execute(stmt)
                cur.execute("RELEASE SAVEPOINT sp;")
                executados += 1
            except Exception:
                cur.execute("ROLLBACK TO SAVEPOINT sp;")

        cur.execute("SET session_replication_role = 'origin';")
        conn.commit()
        cur.close(); conn.close()
        tmp.unlink(missing_ok=True)

        registrar_log(session["user_id"], "restaurar_backup_upload",
                      f"arquivo={arq.filename} backup_seguranca={Path(backup_seguranca).name}")
        return jsonify({
            "ok": True,
            "arquivo_restaurado": arq.filename,
            "backup_seguranca": Path(backup_seguranca).name,
            "statements_executados": executados,
        })
    except Exception as e:
        tmp.unlink(missing_ok=True)
        return jsonify({
            "erro": f"Falha na restauração: {e}",
            "backup_seguranca": Path(backup_seguranca).name if backup_seguranca else None,
        }), 500
