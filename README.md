# Oficina ERP

Sistema de gestão para oficinas mecânicas — backend em **Python/Flask**, frontend em **HTML + CSS + JavaScript puro** (sem frameworks), banco **SQLite** (local) com suporte a **PostgreSQL** (produção).

## Como rodar

```bash
pip install -r requirements.txt
python server.py
```

Acesse **http://localhost:5000**

**Login de teste:** `admin@oficina.com` / `admin123`

## Estrutura

```
Oficina/
├── server.py            # Ponto de entrada Flask (registra rotas e serve as páginas)
├── requirements.txt
├── database/
│   └── database.py      # Camada de acesso ao banco + criação do schema (init_db)
├── api/                 # Blueprints REST (rotas → regras → banco)
│   ├── usuarios.py      # login/logout + CRUD de usuários e permissões
│   ├── clientes.py  veiculos.py  produtos.py  estoque.py
│   ├── ordem_servico.py financeiro.py  pdv.py  xml.py  relatorios.py
├── pages/               # HTML de cada tela (login + páginas autenticadas)
└── static/
    ├── css/             # style.css (design system) + CSS por módulo
    └── js/              # app.js (base), crud.js (genérico) + JS por página
```

## Banco de dados

Padrão: SQLite em `database/banco.db` (criado automaticamente no 1º start).

Para PostgreSQL, defina variáveis de ambiente antes de rodar:

```bash
export DB_ENGINE=postgres
export DB_HOST=localhost DB_NAME=oficina DB_USER=postgres DB_PASSWORD=senha
# e descomente psycopg2-binary no requirements.txt
```

## Perfis de acesso

administrador · gerente · mecanico · atendente · financeiro · caixa

---

## Deploy no Railway (com Git)

O projeto já vem pronto para o Railway: `Procfile`, `gunicorn`, leitura da porta
via `$PORT` e detecção automática de PostgreSQL quando existe `DATABASE_URL`.

### 1. Subir para o Git

```bash
git init
git add .
git commit -m "ERP Oficina - versão inicial"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/SEU_REPO.git
git push -u origin main
```

> O `.gitignore` já evita versionar o banco SQLite local, cache e segredos.

### 2. Criar o projeto no Railway

1. Acesse railway.app → **New Project** → **Deploy from GitHub repo** → escolha o repositório.
2. O Railway detecta Python pelo `requirements.txt` e usa o `Procfile` para subir.

### 3. Adicionar o banco PostgreSQL

No projeto do Railway: **New** → **Database** → **Add PostgreSQL**.
Isso cria a variável `DATABASE_URL` automaticamente e o app passa a usá-la
(não precisa configurar `DB_ENGINE`; ele detecta sozinho).

> **Importante:** em produção use PostgreSQL. O SQLite não serve no Railway
> porque o disco é efêmero — os dados seriam apagados a cada novo deploy.

### 4. Definir variáveis de ambiente

Em **Variables**, adicione:

| Variável      | Valor                                  |
|---------------|----------------------------------------|
| `SECRET_KEY`  | uma string longa e aleatória           |
| `FLASK_DEBUG` | `0`                                    |

`DATABASE_URL` e `PORT` são fornecidas pelo próprio Railway.

### 5. Publicar

O Railway faz o deploy e gera uma URL pública. No primeiro start, as tabelas e o
usuário admin (`admin@oficina.com` / `admin123`) são criados automaticamente.

> **Troque a senha do admin** logo após o primeiro acesso.

### Backup em produção (PostgreSQL)

O botão de backup interno do sistema copia o arquivo do SQLite e por isso só
funciona em desenvolvimento. Em produção, use os **backups automáticos do
PostgreSQL do Railway** (aba do banco → Backups), que é a forma recomendada.

> Testado de ponta a ponta contra PostgreSQL real: cadastros, Ordem de Serviço
> com baixa de estoque, PDV, financeiro, importação de XML e relatórios.
