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
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('MEUTEA_MASTER_KEY deve ter 64 caracteres hexadecimais (32 bytes).');
    return Buffer.from(hex, 'hex');
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
};
