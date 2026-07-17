"""
database.py — Camada de acesso ao banco de dados.

Objetivo:
    Centralizar TODA a comunicação com o banco. As regras de negócio (api/*.py)
    nunca abrem conexões diretamente: elas chamam as funções daqui.

Suporte a dois bancos, escolhido por variável de ambiente DB_ENGINE:
    - "sqlite"    -> desenvolvimento local (arquivo database/banco.db)
    - "postgres"  -> produção (usa DATABASE_URL ou variáveis PG*)

Como a sintaxe de placeholders difere (SQLite usa "?", PostgreSQL usa "%s"),
a função query() traduz automaticamente o "?" para o placeholder correto.
Assim o resto do sistema escreve SQL sempre com "?".
"""

import os
import sqlite3
from datetime import datetime

# -------------------------------------------------------------------------
# Configuração do motor de banco
# -------------------------------------------------------------------------
# O motor é escolhido por DB_ENGINE. Se ele não for definido mas existir uma
# DATABASE_URL no ambiente (padrão do Railway/Heroku ao adicionar Postgres),
# assumimos PostgreSQL automaticamente. Caso contrário, SQLite (dev local).
DB_ENGINE = (
    os.getenv("DB_ENGINE")
    or ("postgres" if os.getenv("DATABASE_URL") else "sqlite")
).lower()

# Caminho do arquivo SQLite (relativo a este arquivo)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SQLITE_PATH = os.path.join(BASE_DIR, "banco.db")

# psycopg2 só é importado se realmente for usar PostgreSQL (evita dependência
# obrigatória no ambiente de desenvolvimento).
if DB_ENGINE == "postgres":
    import psycopg2
    import psycopg2.extras


# -------------------------------------------------------------------------
# Conexão
# -------------------------------------------------------------------------
def get_connection():
    """Abre e retorna uma nova conexão de acordo com o motor configurado."""
    if DB_ENGINE == "postgres":
        dsn = os.getenv("DATABASE_URL")
        if dsn:
            return psycopg2.connect(dsn)
        return psycopg2.connect(
            host=os.getenv("PGHOST", "localhost"),
            port=os.getenv("PGPORT", "5432"),
            dbname=os.getenv("PGDATABASE", "oficina"),
            user=os.getenv("PGUSER", "postgres"),
            password=os.getenv("PGPASSWORD", ""),
        )
    # SQLite (padrão)
    conn = sqlite3.connect(SQLITE_PATH)
    conn.row_factory = sqlite3.Row          # permite acessar colunas por nome
    conn.execute("PRAGMA foreign_keys = ON")  # respeita chaves estrangeiras
    return conn


def _translate(sql: str) -> str:
    """Converte placeholders '?' para o formato do PostgreSQL ('%s')."""
    if DB_ENGINE == "postgres":
        return sql.replace("?", "%s")
    return sql


def _dict_cursor(conn):
    """Retorna um cursor que devolve linhas como dicionários."""
    if DB_ENGINE == "postgres":
        return conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    return conn.cursor()


# -------------------------------------------------------------------------
# Funções utilitárias de consulta
# -------------------------------------------------------------------------
def query(sql, params=(), fetchone=False, commit=False):
    """
    Executa um SQL e retorna o resultado como lista de dicionários (ou 1 dict).

    - fetchone=True  -> retorna apenas a primeira linha (ou None)
    - commit=True    -> confirma a transação (INSERT/UPDATE/DELETE)

    Para INSERT, retorna o ID gerado (lastrowid no SQLite / RETURNING no PG
    quando aplicável) através da chave especial "_lastid".
    """
    conn = get_connection()
    try:
        cur = _dict_cursor(conn)
        sql_final = _translate(sql)

        # No PostgreSQL não existe lastrowid: para recuperar o ID gerado em um
        # INSERT, anexamos "RETURNING id" e lemos o valor antes do commit.
        eh_insert = sql.lstrip().upper().startswith("INSERT")
        usa_returning = (
            commit and DB_ENGINE == "postgres"
            and eh_insert and "RETURNING" not in sql.upper()
        )
        if usa_returning:
            sql_final = sql_final.rstrip().rstrip(";") + " RETURNING id"

        cur.execute(sql_final, params)

        result = None
        if commit:
            last_id = None
            if DB_ENGINE == "sqlite":
                last_id = cur.lastrowid
            elif usa_returning:
                linha = cur.fetchone()
                if linha:
                    # RealDictCursor devolve dict; garante pegar a coluna "id".
                    last_id = linha["id"] if isinstance(linha, dict) else linha[0]
            conn.commit()
            result = {"_lastid": last_id, "rowcount": cur.rowcount}
        else:
            rows = cur.fetchall()
            # Normaliza para list[dict] em qualquer motor
            data = [dict(r) for r in rows]
            result = data[0] if (fetchone and data) else (None if fetchone else data)

        cur.close()
        return result
    finally:
        conn.close()


def now():
    """Data/hora atual em formato ISO — usado para carimbos de criação."""
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# -------------------------------------------------------------------------
# Criação do schema (idempotente)
# -------------------------------------------------------------------------
# Observação: usamos tipos compatíveis com SQLite e PostgreSQL.
# AUTOINCREMENT do SQLite vira SERIAL no PostgreSQL; para manter simples e
# portável, usamos INTEGER PRIMARY KEY (SQLite) / SERIAL (PG) via ajuste.
def _pk():
    return "SERIAL PRIMARY KEY" if DB_ENGINE == "postgres" else "INTEGER PRIMARY KEY AUTOINCREMENT"


SCHEMA = None  # construído em init_db() para poder injetar o tipo de PK


def init_db():
    """Cria todas as tabelas caso ainda não existam e insere dados iniciais."""
    pk = _pk()
    stmts = [
        # ---------------- Usuários / acesso ----------------
        f"""CREATE TABLE IF NOT EXISTS usuarios (
            id {pk},
            nome TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            senha_hash TEXT NOT NULL,
            perfil TEXT NOT NULL DEFAULT 'atendente',  -- administrador, gerente, mecanico, atendente, financeiro, caixa
            ativo INTEGER NOT NULL DEFAULT 1,
            criado_em TEXT
        )""",

        # ---------------- Clientes ----------------
        f"""CREATE TABLE IF NOT EXISTS clientes (
            id {pk},
            tipo TEXT DEFAULT 'PF',            -- PF ou PJ
            cpf_cnpj TEXT,
            nome TEXT NOT NULL,
            telefone TEXT,
            whatsapp TEXT,
            email TEXT,
            cep TEXT,
            endereco TEXT,
            cidade TEXT,
            estado TEXT,
            observacoes TEXT,
            criado_em TEXT
        )""",

        # ---------------- Veículos ----------------
        f"""CREATE TABLE IF NOT EXISTS veiculos (
            id {pk},
            cliente_id INTEGER REFERENCES clientes(id),
            marca TEXT,
            modelo TEXT,
            ano TEXT,
            motor TEXT,
            combustivel TEXT,
            placa TEXT,
            renavam TEXT,
            cor TEXT,
            quilometragem INTEGER DEFAULT 0,
            chassi TEXT,
            criado_em TEXT
        )""",

        # ---------------- Fornecedores ----------------
        f"""CREATE TABLE IF NOT EXISTS fornecedores (
            id {pk},
            nome TEXT NOT NULL,
            cnpj TEXT,
            telefone TEXT,
            email TEXT,
            criado_em TEXT
        )""",

        # ---------------- Serviços ----------------
        f"""CREATE TABLE IF NOT EXISTS servicos (
            id {pk},
            descricao TEXT NOT NULL,
            tempo_medio TEXT,
            valor REAL DEFAULT 0,
            garantia TEXT,
            categoria TEXT,
            criado_em TEXT
        )""",

        # ---------------- Produtos ----------------
        f"""CREATE TABLE IF NOT EXISTS produtos (
            id {pk},
            codigo TEXT,
            codigo_barras TEXT,
            nome TEXT NOT NULL,
            categoria TEXT,
            marca TEXT,
            fornecedor_id INTEGER REFERENCES fornecedores(id),
            localizacao TEXT,
            preco_compra REAL DEFAULT 0,
            preco_venda REAL DEFAULT 0,
            estoque_atual REAL DEFAULT 0,
            estoque_minimo REAL DEFAULT 0,
            estoque_maximo REAL DEFAULT 0,
            ncm TEXT,
            cfop TEXT,
            cest TEXT,
            ean TEXT,
            criado_em TEXT
        )""",

        # ---------------- Movimentações de estoque ----------------
        f"""CREATE TABLE IF NOT EXISTS estoque_mov (
            id {pk},
            produto_id INTEGER REFERENCES produtos(id),
            tipo TEXT NOT NULL,               -- entrada, saida, ajuste, transferencia
            quantidade REAL NOT NULL,
            saldo_apos REAL,
            origem TEXT,                      -- xml, os, pdv, manual...
            documento TEXT,
            usuario_id INTEGER,
            criado_em TEXT
        )""",

        # ---------------- Ordens de Serviço ----------------
        f"""CREATE TABLE IF NOT EXISTS ordens_servico (
            id {pk},
            numero TEXT,
            cliente_id INTEGER REFERENCES clientes(id),
            veiculo_id INTEGER REFERENCES veiculos(id),
            mecanico_id INTEGER REFERENCES usuarios(id),
            data TEXT,
            previsao TEXT,
            status TEXT DEFAULT 'aberta',
            problema TEXT,
            diagnostico TEXT,
            horas_trabalhadas REAL DEFAULT 0,
            garantia TEXT,
            observacoes TEXT,
            eh_orcamento INTEGER DEFAULT 0,   -- 1 = orçamento, 0 = OS
            desconto REAL DEFAULT 0,
            total REAL DEFAULT 0,
            criado_em TEXT
        )""",

        # Itens da OS (produtos e serviços)
        f"""CREATE TABLE IF NOT EXISTS os_itens (
            id {pk},
            os_id INTEGER REFERENCES ordens_servico(id),
            tipo TEXT NOT NULL,               -- produto ou servico
            referencia_id INTEGER,            -- produto_id ou servico_id
            descricao TEXT,
            quantidade REAL DEFAULT 1,
            valor_unitario REAL DEFAULT 0,
            subtotal REAL DEFAULT 0
        )""",

        # ---------------- Financeiro ----------------
        f"""CREATE TABLE IF NOT EXISTS financeiro (
            id {pk},
            tipo TEXT NOT NULL,               -- receber ou pagar
            descricao TEXT,
            cliente_id INTEGER,
            fornecedor_id INTEGER,
            os_id INTEGER,
            valor REAL DEFAULT 0,
            valor_pago REAL DEFAULT 0,
            vencimento TEXT,
            pago_em TEXT,
            forma_pagamento TEXT,             -- pix, cartao, dinheiro, boleto, cheque, carne
            status TEXT DEFAULT 'aberto',     -- aberto, pago, atrasado
            juros REAL DEFAULT 0,
            multa REAL DEFAULT 0,
            criado_em TEXT
        )""",

        # ---------------- PDV: caixa e vendas ----------------
        f"""CREATE TABLE IF NOT EXISTS caixa (
            id {pk},
            usuario_id INTEGER,
            valor_abertura REAL DEFAULT 0,
            valor_fechamento REAL,
            aberto_em TEXT,
            fechado_em TEXT,
            status TEXT DEFAULT 'aberto'      -- aberto, fechado
        )""",

        f"""CREATE TABLE IF NOT EXISTS vendas (
            id {pk},
            caixa_id INTEGER REFERENCES caixa(id),
            cliente_id INTEGER,
            usuario_id INTEGER,
            total REAL DEFAULT 0,
            desconto REAL DEFAULT 0,
            forma_pagamento TEXT,
            criado_em TEXT
        )""",

        f"""CREATE TABLE IF NOT EXISTS venda_itens (
            id {pk},
            venda_id INTEGER REFERENCES vendas(id),
            produto_id INTEGER,
            descricao TEXT,
            quantidade REAL DEFAULT 1,
            valor_unitario REAL DEFAULT 0,
            subtotal REAL DEFAULT 0
        )""",

        # Movimentações de caixa (sangria / suprimento)
        f"""CREATE TABLE IF NOT EXISTS caixa_mov (
            id {pk},
            caixa_id INTEGER REFERENCES caixa(id),
            tipo TEXT,                        -- sangria, suprimento
            valor REAL,
            motivo TEXT,
            criado_em TEXT
        )""",

        # ---------------- Importações XML ----------------
        f"""CREATE TABLE IF NOT EXISTS xml_importacoes (
            id {pk},
            chave TEXT,
            fornecedor TEXT,
            qtd_produtos INTEGER,
            valor_total REAL,
            criado_em TEXT
        )""",

        # ---------------- Logs ----------------
        f"""CREATE TABLE IF NOT EXISTS logs (
            id {pk},
            usuario_id INTEGER,
            acao TEXT,
            detalhe TEXT,
            criado_em TEXT
        )""",
    ]

    conn = get_connection()
    try:
        cur = conn.cursor()
        for s in stmts:
            cur.execute(s)
        conn.commit()
        cur.close()
    finally:
        conn.close()

    _seed()


def _seed():
    """Insere um usuário administrador padrão se a tabela estiver vazia."""
    from werkzeug.security import generate_password_hash

    existe = query("SELECT COUNT(*) AS n FROM usuarios", fetchone=True)
    if existe and existe["n"] == 0:
        query(
            "INSERT INTO usuarios (nome, email, senha_hash, perfil, ativo, criado_em) "
            "VALUES (?,?,?,?,?,?)",
            ("Administrador", "admin@oficina.com",
             generate_password_hash("admin123"), "administrador", 1, now()),
            commit=True,
        )
        print(">> Usuário admin criado: admin@oficina.com / admin123")


def registrar_log(usuario_id, acao, detalhe=""):
    """Grava um log de operação importante."""
    query(
        "INSERT INTO logs (usuario_id, acao, detalhe, criado_em) VALUES (?,?,?,?)",
        (usuario_id, acao, detalhe, now()),
        commit=True,
    )
