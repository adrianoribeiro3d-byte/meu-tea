const express = require('express');
const db = require('../db');
const auth = require('../auth');
const contas = require('../contas');
const { PERFIS } = require('../dominio');

const r = express.Router();
r.use(auth.exigir('administrar'));

// O administrador nunca define nem conhece a senha de outra pessoa: o acesso é ativado
// pelo próprio profissional, com o link de uso único enviado ao e-mail cadastrado.
const listar = () => db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM vinculos v WHERE v.usuario_id = u.id) AS criancas,
  (SELECT COUNT(*) FROM acompanhamentos ac WHERE ac.profissional_id = u.id AND ac.data >= date('now', '-30 days')) AS atend30,
  (SELECT MAX(criado_em) FROM auditoria a WHERE a.usuario_id = u.id AND a.acao = 'login') AS ultimo_login,
  (SELECT MAX(expira_em) FROM tokens_conta t WHERE t.usuario_id = u.id AND t.tipo = 'convite' AND t.usado_em IS NULL
     AND t.expira_em > datetime('now')) AS convite_valido_ate
  FROM usuarios u ORDER BY u.ativo DESC, u.nome`).all();

const pagina = (res, extra = {}, status = 200) =>
  res.status(status).render('usuarios', { usuarios: listar(), erro: null, resultado: null, form: {}, ...extra });

// Endereço desta instalação visto pelo administrador; usado só para exibir o link quando o e-mail não está configurado
const baseDaRequisicao = (req) => `${req.protocol}://${req.get('host')}`;

async function mandarLink(req, res, u, tipo) {
  const acao = tipo === 'convite' ? 'convite' : 'redefinicao';
  try {
    const r2 = await contas.enviarLink(u, tipo, { baseReserva: baseDaRequisicao(req) });
    auth.auditar(req, r2.enviado ? `${acao}_enviado` : `${acao}_link_exibido`, { entidade: 'usuario', entidadeId: u.id });
    return { tipo, email: u.email, nome: u.nome, ...r2 };
  } catch (e) {
    console.error(`[Neuro Sistema] Falha ao enviar o e-mail de ${acao}:`, e.code || e.message);
    auth.auditar(req, `${acao}_falhou`, { entidade: 'usuario', entidadeId: u.id });
    return { tipo, email: u.email, nome: u.nome, falhou: true };
  }
}

r.get('/', (req, res) => pagina(res));

r.post('/', async (req, res, next) => {
  try {
    const nome = String(req.body.nome || '').trim().slice(0, 120);
    const email = String(req.body.email || '').trim().toLowerCase().slice(0, 120);
    const perfil = req.body.perfil;
    const registro = String(req.body.registro_profissional || '').trim().slice(0, 40) || null;
    let erro = null;
    if (nome.length < 3) erro = 'Informe o nome completo.';
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) erro = 'E-mail inválido.';
    else if (!(perfil in PERFIS)) erro = 'Selecione o perfil.';
    else if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email)) erro = 'Já existe um usuário com este e-mail.';
    if (erro) return pagina(res, { erro, form: req.body }, 400);

    // Sem senha utilizável até o profissional ativar o acesso pelo link
    const info = db.prepare(`INSERT INTO usuarios (nome, email, senha_hash, perfil, registro_profissional, trocar_senha, convite_pendente)
                             VALUES (?, ?, '!', ?, ?, 0, 1)`).run(nome, email, perfil, registro);
    const id = Number(info.lastInsertRowid);
    auth.auditar(req, 'criou_usuario', { entidade: 'usuario', entidadeId: id, detalhes: { perfil } });
    const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
    pagina(res, { resultado: await mandarLink(req, res, u, 'convite') });
  } catch (e) { next(e); }
});

r.post('/:id/ativo', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.usuario.id) return res.redirect('/usuarios');
  const ativo = req.body.ativo === '1' ? 1 : 0;
  db.prepare('UPDATE usuarios SET ativo = ? WHERE id = ?').run(ativo, id);
  if (!ativo) {
    db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(id);
    db.prepare('DELETE FROM tokens_conta WHERE usuario_id = ? AND usado_em IS NULL').run(id);
  }
  auth.auditar(req, ativo ? 'reativou_usuario' : 'desativou_usuario', { entidade: 'usuario', entidadeId: id });
  res.redirect('/usuarios');
});

// Reenvia o convite (conta ainda não ativada) ou envia um link de redefinição de senha (conta ativa)
r.post('/:id/link', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const u = db.prepare('SELECT * FROM usuarios WHERE id = ? AND ativo = 1').get(id);
    if (!u || id === req.usuario.id) return res.redirect('/usuarios');
    pagina(res, { resultado: await mandarLink(req, res, u, u.convite_pendente ? 'convite' : 'redefinicao') });
  } catch (e) { next(e); }
});

module.exports = r;
