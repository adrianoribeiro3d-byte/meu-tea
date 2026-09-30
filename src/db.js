const path = require('path');
const Database = require('better-sqlite3');
const { PASTA_DADOS } = require('./config');

const db = new Database(process.env.MEUTEA_DB || path.join(PASTA_DADOS, 'meutea.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash TEXT NOT NULL,
  perfil TEXT NOT NULL,
  registro_profissional TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  trocar_senha INTEGER NOT NULL DEFAULT 1,
  termo_versao TEXT,
  termo_aceito_em TEXT,
  tentativas_falhas INTEGER NOT NULL DEFAULT 0,
  bloqueado_ate TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessoes (
  id_hash TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  ultimo_acesso TEXT NOT NULL DEFAULT (datetime('now')),
  ip TEXT
);

-- Dados pessoais identificáveis ficam criptografados (*_cifrado).
-- Campos em claro são apenas os necessários às estatísticas agregadas.
CREATE TABLE IF NOT EXISTS criancas (
  id INTEGER PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  nome_cifrado TEXT,
  indice_identidade TEXT UNIQUE,
  nascimento_cifrado TEXT,
  nascimento_ym TEXT,
  sexo TEXT,
  condicoes TEXT NOT NULL DEFAULT '[]',
  cid TEXT,
  nivel_suporte TEXT,
  laudo TEXT,
  escola TEXT,
  serie TEXT,
  turno TEXT,
  regiao TEXT,
  aee INTEGER NOT NULL DEFAULT 0,
  mediador INTEGER NOT NULL DEFAULT 0,
  responsavel_cifrado TEXT,
  telefone_cifrado TEXT,
  observacoes_cifrado TEXT,
  consentimento INTEGER NOT NULL DEFAULT 0,
  consentimento_data TEXT,
  anonimizada INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  importacao_id INTEGER,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Equipe: quais profissionais podem ver cada criança (princípio da necessidade)
CREATE TABLE IF NOT EXISTS vinculos (
  crianca_id INTEGER NOT NULL REFERENCES criancas(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (crianca_id, usuario_id)
);

CREATE TABLE IF NOT EXISTS acompanhamentos (
  id INTEGER PRIMARY KEY,
  crianca_id INTEGER NOT NULL REFERENCES criancas(id) ON DELETE CASCADE,
  profissional_id INTEGER NOT NULL REFERENCES usuarios(id),
  especialidade TEXT NOT NULL,
  data TEXT NOT NULL,
  tipo TEXT NOT NULL,
  evolucao TEXT NOT NULL DEFAULT 'nao_avaliado',
  objetivos_cifrado TEXT,
  descricao_cifrado TEXT,
  encaminhamentos_cifrado TEXT,
  sigiloso INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_acomp_crianca ON acompanhamentos(crianca_id, data);
CREATE INDEX IF NOT EXISTS ix_acomp_data ON acompanhamentos(data);

CREATE TABLE IF NOT EXISTS importacoes (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  arquivo TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  inseridas INTEGER NOT NULL DEFAULT 0,
  atualizadas INTEGER NOT NULL DEFAULT 0,
  ignoradas INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Trilha de auditoria (LGPD art. 37): somente inserção
CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER,
  usuario_nome TEXT,
  acao TEXT NOT NULL,
  entidade TEXT,
  entidade_id INTEGER,
  detalhes TEXT,
  ip TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_auditoria_data ON auditoria(criado_em);
CREATE TRIGGER IF NOT EXISTS auditoria_sem_update BEFORE UPDATE ON auditoria
BEGIN SELECT RAISE(ABORT, 'A trilha de auditoria não pode ser alterada'); END;
CREATE TRIGGER IF NOT EXISTS auditoria_sem_delete BEFORE DELETE ON auditoria
BEGIN SELECT RAISE(ABORT, 'A trilha de auditoria não pode ser apagada'); END;
`);

module.exports = db;
