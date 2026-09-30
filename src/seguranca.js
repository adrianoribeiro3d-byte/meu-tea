// Criptografia de campos pessoais (AES-256-GCM), índice cego (HMAC) e senhas (scrypt).
const crypto = require('crypto');
const { chaveMestra } = require('./config');

const chaveCifra = Buffer.from(crypto.hkdfSync('sha256', chaveMestra, Buffer.alloc(0), 'meutea:cifra', 32));
const chaveIndice = Buffer.from(crypto.hkdfSync('sha256', chaveMestra, Buffer.alloc(0), 'meutea:indice', 32));

/** Criptografa texto -> "v1:iv:tag:dados" (base64). null/'' permanecem null. */
function cifrar(texto) {
  if (texto === null || texto === undefined || texto === '') return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', chaveCifra, iv);
  const dados = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), dados.toString('base64')].join(':');
}

function decifrar(valor) {
  if (!valor) return '';
  const [versao, iv, tag, dados] = valor.split(':');
  if (versao !== 'v1') throw new Error('Formato de dado criptografado desconhecido');
  const d = crypto.createDecipheriv('aes-256-gcm', chaveCifra, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(dados, 'base64')), d.final()]).toString('utf8');
}

/** Normaliza texto para comparação (sem acentos, minúsculo, espaços simples). */
function normalizar(t) {
  return String(t || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Índice cego: permite localizar duplicatas sem guardar o nome em claro. */
function indiceCego(...partes) {
  return crypto.createHmac('sha256', chaveIndice).update(partes.map(normalizar).join('|')).digest('hex');
}

function hashSenha(senha) {
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(senha, sal, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${sal.toString('base64')}$${h.toString('base64')}`;
}

function conferirSenha(senha, armazenado) {
  const [alg, sal, h] = String(armazenado || '').split('$');
  if (alg !== 'scrypt') return false;
  const esperado = Buffer.from(h, 'base64');
  const obtido = crypto.scryptSync(senha, Buffer.from(sal, 'base64'), esperado.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(esperado, obtido);
}

/** Política mínima de senha; retorna mensagem de erro ou null. */
function validarSenha(senha) {
  if (!senha || senha.length < 10) return 'A senha deve ter pelo menos 10 caracteres.';
  if (!/[a-zA-Z]/.test(senha) || !/[0-9]/.test(senha)) return 'A senha deve conter letras e números.';
  return null;
}

const token = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');
const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');

module.exports = { cifrar, decifrar, normalizar, indiceCego, hashSenha, conferirSenha, validarSenha, token, sha256 };
