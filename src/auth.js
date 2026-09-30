// Sessões, CSRF, controle de acesso por perfil e auditoria.
const db = require('./db');
const { token, sha256 } = require('./seguranca');
const { producao, sessaoMinutos, versaoTermo } = require('./config');
const { ehProfissional } = require('./dominio');

const COOKIE = producao ? '__Host-meutea' : 'meutea';

function ipDe(req) {
  return req.ip || req.socket?.remoteAddress || null;
}

function auditar(req, acao, { entidade = null, entidadeId = null, detalhes = null, usuario = null } = {}) {
  const u = usuario || req.usuario || null;
  db.prepare(`INSERT INTO auditoria (usuario_id, usuario_nome, acao, entidade, entidade_id, detalhes, ip)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(u?.id ?? null, u?.nome ?? null, acao, entidade, entidadeId,
      detalhes == null ? null : (typeof detalhes === 'string' ? detalhes : JSON.stringify(detalhes)), ipDe(req));
}

function lerCookie(req, nome) {
  const bruto = req.headers.cookie || '';
  for (const parte of bruto.split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nome) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return null;
}

function gravarCookie(res, valor, maxAgeSeg) {
  const attrs = [`${COOKIE}=${encodeURIComponent(valor)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (producao) attrs.push('Secure');
  if (maxAgeSeg !== undefined) attrs.push(`Max-Age=${maxAgeSeg}`);
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function criarSessao(req, res, usuario) {
  const bruto = token();
  db.prepare('INSERT INTO sessoes (id_hash, usuario_id, csrf, ip) VALUES (?, ?, ?, ?)')
    .run(sha256(bruto), usuario.id, token(16), ipDe(req));
  gravarCookie(res, bruto);
}

function encerrarSessao(req, res) {
  const bruto = lerCookie(req, COOKIE);
  if (bruto) db.prepare('DELETE FROM sessoes WHERE id_hash = ?').run(sha256(bruto));
  gravarCookie(res, '', 0);
}

/** Carrega req.usuario a partir do cookie; expira por inatividade. */
function carregarSessao(req, res, next) {
  db.prepare(`DELETE FROM sessoes WHERE ultimo_acesso < datetime('now', ?)`).run(`-${sessaoMinutos} minutes`);
  const bruto = lerCookie(req, COOKIE);
  if (bruto) {
    const s = db.prepare(`SELECT s.id_hash, s.csrf, u.* FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
                          WHERE s.id_hash = ? AND u.ativo = 1`).get(sha256(bruto));
    if (s) {
      db.prepare(`UPDATE sessoes SET ultimo_acesso = datetime('now') WHERE id_hash = ?`).run(s.id_hash);
      req.csrf = s.csrf;
      delete s.senha_hash;
      req.usuario = s;
    }
  }
  res.locals.usuario = req.usuario || null;
  res.locals.csrf = req.csrf || '';
  next();
}

/** Toda requisição que altera dados precisa do token CSRF da sessão. */
function verificarCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.usuario) return next(); // login: protegido por SameSite=Strict
  // Uploads multipart conferem o token na própria rota, depois que o corpo é lido (ver routes/importacao.js)
  if (req.is('multipart/form-data')) return next();
  const enviado = req.body?._csrf || req.get('x-csrf-token');
  if (enviado && enviado === req.csrf) return next();
  res.status(403).render('erro', { titulo: 'Requisição recusada', mensagem: 'Token de segurança inválido. Recarregue a página e tente novamente.' });
}

function exigirLogin(req, res, next) {
  if (!req.usuario) return res.redirect('/login');
  // Antes de qualquer acesso: troca de senha provisória e aceite do termo de confidencialidade
  const livre = ['/conta/senha', '/termo', '/sair', '/privacidade'];
  if (!livre.includes(req.path)) {
    if (req.usuario.trocar_senha) return res.redirect('/conta/senha');
    if (req.usuario.termo_versao !== versaoTermo) return res.redirect('/termo');
  }
  next();
}

const PERMISSOES = {
  dashboard: () => true,
  verCriancas: (u) => u.perfil === 'admin' || ehProfissional(u.perfil),
  editarCriancas: (u) => u.perfil === 'admin',
  importar: (u) => u.perfil === 'admin',
  registrarAcompanhamento: (u) => ehProfissional(u.perfil),
  relatorios: (u) => u.perfil === 'admin' || ehProfissional(u.perfil),
  administrar: (u) => u.perfil === 'admin',
};

const pode = (usuario, permissao) => !!usuario && PERMISSOES[permissao](usuario);

function exigir(permissao) {
  return (req, res, next) => {
    if (pode(req.usuario, permissao)) return next();
    auditar(req, 'acesso_negado', { detalhes: { rota: req.originalUrl, permissao } });
    res.status(403).render('erro', { titulo: 'Acesso restrito', mensagem: 'Seu perfil não tem permissão para acessar esta área.' });
  };
}

/** Profissionais só acessam crianças às quais estão vinculados; admin acessa todas. */
function podeVerCrianca(usuario, criancaId) {
  if (usuario.perfil === 'admin') return true;
  if (!ehProfissional(usuario.perfil)) return false;
  return !!db.prepare('SELECT 1 FROM vinculos WHERE crianca_id = ? AND usuario_id = ?').get(criancaId, usuario.id);
}

/** Registro sigiloso: visível ao autor e a profissionais da mesma especialidade. */
function podeVerRegistro(usuario, registro) {
  if (!registro.sigiloso) return true;
  return registro.profissional_id === usuario.id || registro.especialidade === usuario.perfil;
}

module.exports = {
  auditar, criarSessao, encerrarSessao, carregarSessao, verificarCsrf, exigirLogin, exigir, pode,
  podeVerCrianca, podeVerRegistro, ipDe,
};
