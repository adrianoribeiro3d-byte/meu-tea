const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const auth = require('../auth');
const { hashSenha } = require('../seguranca');
const { PERFIS } = require('../dominio');

const r = express.Router();
r.use(auth.exigir('administrar'));

// Senha provisória legível; o usuário é obrigado a trocá-la no primeiro acesso
function senhaProvisoria() {
  const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 8; i++) s += letras[crypto.randomInt(letras.length)];
  return s + crypto.randomInt(1000, 9999);
}

const listar = () => db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM vinculos v WHERE v.usuario_id = u.id) AS criancas,
  (SELECT MAX(criado_em) FROM auditoria a WHERE a.usuario_id = u.id AND a.acao = 'login') AS ultimo_login
  FROM usuarios u ORDER BY u.ativo DESC, u.nome`).all();

r.get('/', (req, res) => res.render('usuarios', { usuarios: listar(), erro: null, senhaGerada: null, form: {} }));

r.post('/', (req, res) => {
  const nome = String(req.body.nome || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const perfil = req.body.perfil;
  const registro = String(req.body.registro_profissional || '').trim().slice(0, 40) || null;
  let erro = null;
  if (nome.length < 3) erro = 'Informe o nome completo.';
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) erro = 'E-mail inválido.';
  else if (!(perfil in PERFIS)) erro = 'Selecione o perfil.';
  else if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email)) erro = 'Já existe um usuário com este e-mail.';
  if (erro) return res.status(400).render('usuarios', { usuarios: listar(), erro, senhaGerada: null, form: req.body });

  const senha = senhaProvisoria();
  const info = db.prepare('INSERT INTO usuarios (nome, email, senha_hash, perfil, registro_profissional) VALUES (?,?,?,?,?)')
    .run(nome, email, hashSenha(senha), perfil, registro);
  auth.auditar(req, 'criou_usuario', { entidade: 'usuario', entidadeId: Number(info.lastInsertRowid), detalhes: { perfil } });
  res.render('usuarios', { usuarios: listar(), erro: null, senhaGerada: { email, senha }, form: {} });
});

r.post('/:id/ativo', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.usuario.id) return res.redirect('/usuarios');
  const ativo = req.body.ativo === '1' ? 1 : 0;
  db.prepare('UPDATE usuarios SET ativo = ? WHERE id = ?').run(ativo, id);
  if (!ativo) db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(id);
  auth.auditar(req, ativo ? 'reativou_usuario' : 'desativou_usuario', { entidade: 'usuario', entidadeId: id });
  res.redirect('/usuarios');
});

r.post('/:id/senha', (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT email FROM usuarios WHERE id = ?').get(id);
  if (!u) return res.redirect('/usuarios');
  const senha = senhaProvisoria();
  db.prepare('UPDATE usuarios SET senha_hash = ?, trocar_senha = 1, tentativas_falhas = 0, bloqueado_ate = NULL WHERE id = ?').run(hashSenha(senha), id);
  db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(id);
  auth.auditar(req, 'redefiniu_senha', { entidade: 'usuario', entidadeId: id });
  res.render('usuarios', { usuarios: listar(), erro: null, senhaGerada: { email: u.email, senha }, form: {} });
});

module.exports = r;
