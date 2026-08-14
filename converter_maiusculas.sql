-- Converte fornecedores e produtos para MAIÚSCULAS
-- Colunas base da tabela + colunas adicionadas via _garantir_coluna

-- FORNECEDORES (base: nome, cnpj, telefone, email)
-- + garantir_coluna: nome_fantasia, ie, telefone2, contato, site,
--   endereco, numero, bairro, cidade, estado, cep, prazo_pagamento, observacoes
UPDATE fornecedores SET
  nome          = UPPER(nome),
  cnpj          = UPPER(cnpj),
  nome_fantasia = UPPER(COALESCE(nome_fantasia, '')),
  ie            = UPPER(COALESCE(ie, '')),
  telefone      = UPPER(COALESCE(telefone, '')),
  telefone2     = UPPER(COALESCE(telefone2, '')),
  contato       = UPPER(COALESCE(contato, '')),
  endereco      = UPPER(COALESCE(endereco, '')),
  numero        = UPPER(COALESCE(numero, '')),
  bairro        = UPPER(COALESCE(bairro, '')),
  cidade        = UPPER(COALESCE(cidade, '')),
  estado        = UPPER(COALESCE(estado, '')),
  cep           = UPPER(COALESCE(cep, '')),
  observacoes   = UPPER(COALESCE(observacoes, ''))
WHERE nome IS NOT NULL;

-- PRODUTOS (base + garantir_coluna: produto_pai_id, variacao_atributo, foto, etiqueta_impressa_em)
UPDATE produtos SET
  nome              = UPPER(nome),
  codigo            = UPPER(COALESCE(codigo, '')),
  codigo_barras     = UPPER(COALESCE(codigo_barras, '')),
  categoria         = UPPER(COALESCE(categoria, '')),
  marca             = UPPER(COALESCE(marca, '')),
  localizacao       = UPPER(COALESCE(localizacao, '')),
  ncm               = UPPER(COALESCE(ncm, '')),
  cfop              = UPPER(COALESCE(cfop, '')),
  cest              = UPPER(COALESCE(cest, '')),
  ean               = UPPER(COALESCE(ean, '')),
  variacao_atributo = UPPER(COALESCE(variacao_atributo, ''))
WHERE nome IS NOT NULL;
