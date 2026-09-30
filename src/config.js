const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.join(__dirname, '..');
const PASTA_DADOS = process.env.MEUTEA_DADOS || path.join(RAIZ, 'data');
fs.mkdirSync(PASTA_DADOS, { recursive: true });

// Carrega .env simples (CHAVE=valor) sem dependências externas
const arquivoEnv = path.join(RAIZ, '.env');
if (fs.existsSync(arquivoEnv)) {
  for (const linha of fs.readFileSync(arquivoEnv, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const producao = process.env.NODE_ENV === 'production';

function carregarChaveMestra() {
  const hex = process.env.MEUTEA_MASTER_KEY;
  if (hex) {
    if (/^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
    // Aceita também segredos gerados por provedores de hospedagem (ex.: Render), com ao menos 32 caracteres
    if (hex.length < 32) throw new Error('MEUTEA_MASTER_KEY deve ter 64 caracteres hexadecimais ou um segredo aleatório de 32+ caracteres.');
    return crypto.createHash('sha256').update(hex).digest();
  }
  if (producao) throw new Error('Defina MEUTEA_MASTER_KEY no ambiente de produção.');
  // Desenvolvimento: gera e guarda uma chave local
  const arq = path.join(PASTA_DADOS, '.chave-dev');
  if (!fs.existsSync(arq)) {
    fs.writeFileSync(arq, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    console.warn('[Meu TEA] MEUTEA_MASTER_KEY não definida — chave de desenvolvimento criada em', arq);
  }
  return Buffer.from(fs.readFileSync(arq, 'utf8').trim(), 'hex');
}

module.exports = {
  RAIZ,
  PASTA_DADOS,
  producao,
  porta: Number(process.env.PORT) || 3000,
  chaveMestra: carregarChaveMestra(),
  minGrupo: Math.max(0, Number(process.env.LGPD_MIN_GRUPO ?? 3) || 0),
  sessaoMinutos: Number(process.env.SESSAO_MINUTOS) || 30,
  versaoTermo: '1.0',
  // Ambiente de demonstração: cria dados fictícios automaticamente e exibe aviso em todas as páginas
  demo: process.env.MEUTEA_DEMO === '1',
  demoSenha: process.env.MEUTEA_DEMO_SENHA || 'demo12345678',
  // Atrás de um proxy/hospedagem (Render, Railway…) use TRUST_PROXY=1 para registrar o IP real
  trustProxy: process.env.TRUST_PROXY ? (/^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY) : 'loopback',
};
