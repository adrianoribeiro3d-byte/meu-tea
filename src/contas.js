// Convites e redefinição de senha por e-mail, com links de uso único.
// - O banco guarda só o hash do link; o link em si existe apenas no e-mail.
// - Convite vale 48 horas; redefinição de senha, 30 minutos. Um link novo cancela os anteriores do mesmo tipo.
// - Os links usam o endereço configurado (NEUROSISTEMA_ENDERECO), nunca o cabeçalho Host da requisição.
const db = require('./db');
const config = require('./config');
const email = require('./email');
const { token, sha256 } = require('./seguranca');

const VALIDADE = { convite: '+48 hours', redefinicao: '+30 minutes' };
const CAMINHO = { convite: 'ativar', redefinicao: 'redefinir' };

function emitir(usuarioId, tipo) {
  const bruto = token(32);
  db.prepare('DELETE FROM tokens_conta WHERE usuario_id = ? AND tipo = ? AND usado_em IS NULL').run(usuarioId, tipo);
  const { expira } = db.prepare(`SELECT datetime('now', ?) AS expira`).get(VALIDADE[tipo]);
  db.prepare('INSERT INTO tokens_conta (usuario_id, tipo, token_hash, expira_em) VALUES (?, ?, ?, ?)')
    .run(usuarioId, tipo, sha256(bruto), expira);
  return { bruto, expira };
}

/** Confere um link recebido; devolve { tokenId, usuario } ou null (inexistente, usado, vencido ou usuário inativo). */
function validar(bruto, tipo) {
  if (!/^[0-9a-f]{64}$/.test(String(bruto || ''))) return null;
  const t = db.prepare(`SELECT t.id AS token_id, u.* FROM tokens_conta t JOIN usuarios u ON u.id = t.usuario_id
                        WHERE t.token_hash = ? AND t.tipo = ? AND t.usado_em IS NULL AND t.expira_em > datetime('now') AND u.ativo = 1`)
    .get(sha256(bruto), tipo);
  if (!t) return null;
  const { token_id: tokenId, senha_hash: _omitido, ...usuario } = t;
  return { tokenId, usuario };
}

/** Marca o link como usado e cancela os outros links pendentes do usuário. */
function consumir(tokenId, usuarioId) {
  db.prepare(`UPDATE tokens_conta SET usado_em = datetime('now') WHERE id = ?`).run(tokenId);
  db.prepare('DELETE FROM tokens_conta WHERE usuario_id = ? AND usado_em IS NULL').run(usuarioId);
}

const link = (base, tipo, bruto) => `${base}/conta/${CAMINHO[tipo]}/${bruto}`;

const TEXTOS = {
  convite: (u, url) => ({
    assunto: 'Seu acesso ao Neuro Sistema',
    texto: [
      `Olá, ${u.nome}.`,
      '',
      'A Secretaria cadastrou você no Neuro Sistema, o sistema de acompanhamento das crianças atendidas pela rede.',
      'Para ativar o seu acesso e criar a sua senha, abra o link abaixo:',
      '',
      url,
      '',
      'O link vale por 48 horas e só pode ser usado uma vez.',
      'Se você não esperava este convite, ignore este e-mail: nenhum acesso será criado.',
    ].join('\n'),
  }),
  redefinicao: (u, url) => ({
    assunto: 'Redefinição de senha do Neuro Sistema',
    texto: [
      `Olá, ${u.nome}.`,
      '',
      'Recebemos um pedido para redefinir a sua senha do Neuro Sistema. Para criar uma senha nova, abra o link abaixo:',
      '',
      url,
      '',
      'O link vale por 30 minutos e só pode ser usado uma vez.',
      'Se você não pediu a redefinição, ignore este e-mail: a sua senha atual continua valendo.',
    ].join('\n'),
  }),
};

/**
 * Gera o link e envia por e-mail. Sem e-mail configurado, devolve o link para o administrador
 * repassar por um canal seguro (só nas ações feitas pelo administrador).
 * @returns {Promise<{enviado: boolean, link?: string, expira: string}>}
 */
async function enviarLink(usuario, tipo, { baseReserva } = {}) {
  const { bruto, expira } = emitir(usuario.id, tipo);
  if (!email.configurado()) {
    return { enviado: false, link: baseReserva ? link(config.endereco || baseReserva, tipo, bruto) : undefined, expira };
  }
  const { assunto, texto } = TEXTOS[tipo](usuario, link(config.endereco, tipo, bruto));
  await email.enviar({ para: usuario.email, assunto, texto });
  return { enviado: true, expira };
}

/** Aviso ao próprio usuário sempre que a senha muda (ajuda a perceber um acesso indevido). */
function avisarSenhaAlterada(usuario) {
  if (!email.configurado()) return;
  email.enviar({
    para: usuario.email,
    assunto: 'Sua senha do Neuro Sistema foi alterada',
    texto: [
      `Olá, ${usuario.nome}.`,
      '',
      'A senha do seu acesso ao Neuro Sistema acabou de ser alterada.',
      'Se foi você, não é preciso fazer nada.',
      'Se não foi você, avise imediatamente o administrador do sistema na Secretaria.',
    ].join('\n'),
  }).catch((e) => console.error('[Neuro Sistema] Falha ao enviar o aviso de senha alterada:', e.code || e.message));
}

module.exports = { emitir, validar, consumir, enviarLink, avisarSenhaAlterada };
