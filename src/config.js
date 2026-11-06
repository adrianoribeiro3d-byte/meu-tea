const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.join(__dirname, '..');

// Carrega .env simples (CHAVE=valor) sem dependências externas
const arquivoEnv = path.join(RAIZ, '.env');
if (fs.existsSync(arquivoEnv)) {
  for (const linha of fs.readFileSync(arquivoEnv, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const producao = process.env.NODE_ENV === 'production';

// Variáveis de ambiente usam o prefixo NEUROSISTEMA_; o prefixo antigo NEUROSISTEMA_ continua aceito.
const variavel = (nome) => process.env[`NEUROSISTEMA_${nome}`] ?? process.env[`MEUTEA_${nome}`];

// Em produção os dados ficam FORA da pasta do sistema (na pasta pessoal do usuário do servidor),
// para não serem apagados quando a hospedagem reinstala o código a cada atualização.
function pastaProducao() {
  const nova = path.join(os.homedir(), 'neuro-sistema-dados');
  const antiga = path.join(os.homedir(), 'meutea-dados'); // instalações feitas antes da troca de nome
  return !fs.existsSync(nova) && fs.existsSync(antiga) ? antiga : nova;
}
const PASTA_DADOS = variavel('DADOS') || (producao ? pastaProducao() : path.join(RAIZ, 'data'));
fs.mkdirSync(PASTA_DADOS, { recursive: true, mode: 0o700 });

function carregarChaveMestra() {
  const hex = variavel('MASTER_KEY');
  if (hex) {
    if (/^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
    // Aceita também segredos gerados por provedores de hospedagem (ex.: Render), com ao menos 32 caracteres
    if (hex.length < 32) throw new Error('NEUROSISTEMA_MASTER_KEY deve ter 64 caracteres hexadecimais ou um segredo aleatório de 32+ caracteres.');
    return crypto.createHash('sha256').update(hex).digest();
  }
  // Sem a variável: gera uma chave e guarda na pasta de dados (fora da pasta do sistema).
  // Quem puder deve preferir NEUROSISTEMA_MASTER_KEY, para manter chave e banco em lugares separados.
  const arq = path.join(PASTA_DADOS, producao ? '.chave-mestra' : '.chave-dev');
  if (!fs.existsSync(arq)) {
    fs.writeFileSync(arq, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    console.warn('[Neuro Sistema] NEUROSISTEMA_MASTER_KEY não definida — chave criada em', arq, '(guarde uma cópia em local seguro).');
  }
  return Buffer.from(fs.readFileSync(arq, 'utf8').trim(), 'hex');
}

module.exports = {
  variavel,
  RAIZ,
  PASTA_DADOS,
  producao,
  porta: Number(process.env.PORT) || 3000,
  chaveMestra: carregarChaveMestra(),
  minGrupo: Math.max(0, Number(process.env.LGPD_MIN_GRUPO ?? 3) || 0),
  sessaoMinutos: Number(process.env.SESSAO_MINUTOS) || 30,
  versaoTermo: '1.0',
  // Palavra-chave que libera a página /instalacao (criação do primeiro administrador)
  tokenInstalacao: variavel('TOKEN_INSTALACAO') || '',
  // Ambiente de demonstração: cria dados fictícios automaticamente e exibe aviso em todas as páginas
  demo: variavel('DEMO') === '1',
  demoSenha: variavel('DEMO_SENHA') || 'demo12345678',
  // Atrás de um proxy/hospedagem (Render, Railway…) use TRUST_PROXY=1 para registrar o IP real
  trustProxy: process.env.TRUST_PROXY ? (/^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY) : 'loopback',
};
