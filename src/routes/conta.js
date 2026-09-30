const express = require('express');
const db = require('../db');
const { conferirSenha, hashSenha, validarSenha } = require('../seguranca');
const auth = require('../auth');
const { versaoTermo } = require('../config');

const r = express.Router();
const MAX_TENTATIVAS = 5;
const BLOQUEIO_MIN = 15;

// Limite simples por IP contra força bruta
const tentativasIp = new Map();
function limiteIp(ip) {
  const agora = Date.now();
  const t = (tentativasIp.get(ip) || []).filter((x) => agora - x < 15 * 60 * 1000);
  t.push(agora);
  tentativasIp.set(ip, t);
  return t.length > 30;
}

r.get('/login', (req, res) => {
  if (req.usuario) return res.redirect('/');
  res.render('login', { erro: null, email: '' });
});

r.post('/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const senha = String(req.body.senha || '');
  const falha = (msg) => res.status(401).render('login', { erro: msg, email });

  if (limiteIp(auth.ipDe(req))) return falha('Muitas tentativas. Aguarde alguns minutos.');

  const u = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
  if (!u || !u.ativo) {
    auth.auditar(req, 'login_falhou', { detalhes: { email } });
    return falha('E-mail ou senha inválidos.');
  }
  if (u.bloqueado_ate && u.bloqueado_ate > new Date().toISOString()) {
    auth.auditar(req, 'login_bloqueado', { usuario: u });
    return falha(`Conta temporariamente bloqueada por excesso de tentativas. Tente após ${BLOQUEIO_MIN} minutos.`);
  }
  if (!conferirSenha(senha, u.senha_hash)) {
    const tent = u.tentativas_falhas + 1;
    const bloqueio = tent >= MAX_TENTATIVAS ? new Date(Date.now() + BLOQUEIO_MIN * 60000).toISOString() : null;
    db.prepare('UPDATE usuarios SET tentativas_falhas = ?, bloqueado_ate = ? WHERE id = ?').run(bloqueio ? 0 : tent, bloqueio, u.id);
    auth.auditar(req, 'login_falhou', { usuario: u, detalhes: { tentativa: tent } });
    return falha('E-mail ou senha inválidos.');
  }
  db.prepare('UPDATE usuarios SET tentativas_falhas = 0, bloqueado_ate = NULL WHERE id = ?').run(u.id);
  auth.criarSessao(req, res, u);
  auth.auditar(req, 'login', { usuario: u });
  res.redirect('/');
});

r.post('/sair', (req, res) => {
  if (req.usuario) auth.auditar(req, 'logout');
  auth.encerrarSessao(req, res);
  res.redirect('/login');
});

r.get('/privacidade', (req, res) => res.render('privacidade'));

r.get('/conta/senha', auth.exigirLogin, (req, res) => res.render('senha', { erro: null, ok: false }));

r.post('/conta/senha', auth.exigirLogin, (req, res) => {
  const { atual, nova, confirmacao } = req.body;
  const u = db.prepare('SELECT senha_hash FROM usuarios WHERE id = ?').get(req.usuario.id);
  let erro = null;
  if (!conferirSenha(String(atual || ''), u.senha_hash)) erro = 'Senha atual incorreta.';
  else if (nova !== confirmacao) erro = 'A confirmação não confere com a nova senha.';
  else if (nova === atual) erro = 'A nova senha deve ser diferente da atual.';
  else erro = validarSenha(nova);
  if (erro) return res.status(400).render('senha', { erro, ok: false });
  db.prepare('UPDATE usuarios SET senha_hash = ?, trocar_senha = 0 WHERE id = ?').run(hashSenha(nova), req.usuario.id);
  // Encerra as outras sessões do usuário
  db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(req.usuario.id);
  auth.auditar(req, 'senha_alterada');
  auth.criarSessao(req, res, req.usuario);
  res.redirect('/');
});

r.get('/termo', auth.exigirLogin, (req, res) => res.render('termo', { versaoTermo, erro: null }));

r.post('/termo', auth.exigirLogin, (req, res) => {
  if (req.body.aceito !== 'sim') return res.status(400).render('termo', { versaoTermo, erro: 'É necessário aceitar o termo para utilizar o sistema.' });
  db.prepare(`UPDATE usuarios SET termo_versao = ?, termo_aceito_em = datetime('now') WHERE id = ?`).run(versaoTermo, req.usuario.id);
  auth.auditar(req, 'termo_aceito', { detalhes: { versao: versaoTermo } });
  res.redirect('/');
});

module.exports = r;
