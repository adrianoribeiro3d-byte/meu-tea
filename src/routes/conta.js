const express = require('express');
const db = require('../db');
const { conferirSenha, hashSenha, validarSenha, cifrar } = require('../seguranca');
const auth = require('../auth');
const crypto = require('crypto');
const config = require('../config');
const { versaoTermo, tokenInstalacao } = config;
const email = require('../email');
const contas = require('../contas');

const r = express.Router();
const MAX_TENTATIVAS = 5;
const BLOQUEIO_MIN = 15;

// Limite simples por IP contra força bruta, separado por tipo de formulário
const tentativasIp = new Map();
function limiteIp(ip, grupo = 'login', maximo = 30) {
  const chave = `${grupo}:${ip}`;
  const agora = Date.now();
  const t = (tentativasIp.get(chave) || []).filter((x) => agora - x < 15 * 60 * 1000);
  t.push(agora);
  tentativasIp.set(chave, t);
  return t.length > maximo;
}

const semUsuarios = () => !db.prepare('SELECT 1 FROM usuarios LIMIT 1').get();

// ---------- Página institucional (visitantes) ----------
// Só na instalação do domínio principal (NEUROSISTEMA_PAGINA_INICIAL=1). Quem já entrou segue para o
// painel; os demais veem a apresentação do produto. Nos subdomínios dos municípios, o endereço abre no login.
r.get('/', (req, res, next) => {
  if (req.usuario || !config.paginaInicial) return next();
  res.render('site', { enviado: req.query.enviado === '1', erro: null, form: {} });
});

r.post('/demonstracao', (req, res) => {
  if (!config.paginaInicial) return res.status(404).render('erro', { titulo: 'Página não encontrada', mensagem: 'O endereço acessado não existe.' });
  const t = (v, max) => String(v || '').trim().slice(0, max);
  const form = {
    nome: t(req.body.nome, 120), cargo: t(req.body.cargo, 80), instituicao: t(req.body.instituicao, 120), municipio: t(req.body.municipio, 80),
    email: t(req.body.email, 120).toLowerCase(), telefone: t(req.body.telefone, 30), mensagem: t(req.body.mensagem, 1000),
  };
  const falha = (erro) => res.status(400).render('site', { enviado: false, erro, form });
  if (req.body.site) return res.redirect(303, '/?enviado=1#demonstracao'); // campo-armadilha preenchido: robô
  if (limiteIp(auth.ipDe(req), 'demonstracao', 10)) return falha('Muitos envios em pouco tempo. Tente novamente mais tarde.');
  if (form.nome.length < 3) return falha('Informe seu nome completo.');
  if (form.instituicao.length < 3) return falha('Informe a instituição.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) return falha('Informe um e-mail válido.');
  if (req.body.consentimento !== 'sim') return falha('Para enviarmos o contato, marque a autorização de uso dos dados.');
  db.prepare(`INSERT INTO solicitacoes (nome_cifrado, email_cifrado, telefone_cifrado, cargo, instituicao, municipio, mensagem_cifrada)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(cifrar(form.nome), cifrar(form.email), cifrar(form.telefone), form.cargo || null, form.instituicao, form.municipio || null, cifrar(form.mensagem));
  // O aviso por e-mail não atrasa nem impede o registro do pedido; a falha fica no log, sem dados pessoais.
  email.avisarPedido(form).catch((e) => console.error('[Neuro Sistema] Falha ao enviar o aviso do pedido de demonstração por e-mail:', e.code || e.message));
  res.redirect(303, '/?enviado=1#demonstracao');
});

// ---------- Instalação: cria o primeiro administrador pelo navegador ----------
// Só funciona enquanto não existe nenhum usuário e exige a palavra-chave definida
// na variável NEUROSISTEMA_TOKEN_INSTALACAO (assim um visitante qualquer não toma o sistema).
function tokenConfere(enviado) {
  const a = Buffer.from(String(enviado || ''));
  const b = Buffer.from(tokenInstalacao);
  return b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

r.get('/instalacao', (req, res) => {
  if (!semUsuarios()) return res.redirect('/login');
  res.render('instalacao', { erro: null, form: {}, semToken: !tokenInstalacao });
});

r.post('/instalacao', (req, res) => {
  if (!semUsuarios()) return res.redirect('/login');
  const form = { nome: String(req.body.nome || '').trim(), email: String(req.body.email || '').trim().toLowerCase() };
  const falha = (erro) => res.status(400).render('instalacao', { erro, form, semToken: !tokenInstalacao });
  if (limiteIp(auth.ipDe(req))) return falha('Muitas tentativas. Aguarde alguns minutos.');
  if (!tokenConfere(req.body.token)) {
    auth.auditar(req, 'instalacao_token_invalido');
    return falha('Palavra-chave de instalação incorreta.');
  }
  if (form.nome.length < 3) return falha('Informe o nome completo.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) return falha('E-mail inválido.');
  if (req.body.senha !== req.body.confirmacao) return falha('A confirmação não confere com a senha.');
  const erroSenha = validarSenha(req.body.senha);
  if (erroSenha) return falha(erroSenha);
  const info = db.prepare(`INSERT INTO usuarios (nome, email, senha_hash, perfil, trocar_senha) VALUES (?, ?, ?, 'admin', 0)`)
    .run(form.nome, form.email, hashSenha(req.body.senha));
  auth.auditar(req, 'instalacao_concluida', { usuario: { id: Number(info.lastInsertRowid), nome: form.nome } });
  res.redirect('/login?instalado=1');
});

r.get('/login', (req, res) => {
  if (req.usuario) return res.redirect('/');
  if (semUsuarios()) return res.redirect('/instalacao');
  if (req.query.instalado) return res.render('login', { erro: null, email: '', aviso: 'Administrador criado. Entre com o e-mail e a senha que você definiu.' });
  if (req.query.redefinida) return res.render('login', { erro: null, email: '', aviso: 'Senha alterada. Entre com a senha nova.' });
  res.render('login', { erro: null, email: '' });
});

r.post('/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const senha = String(req.body.senha || '');
  const falha = (msg) => res.status(401).render('login', { erro: msg, email });

  if (limiteIp(auth.ipDe(req))) return falha('Muitas tentativas. Aguarde alguns minutos.');

  const u = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
  if (!u || !u.ativo || u.convite_pendente) {
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

// ---------- Esqueci minha senha / ativação do convite / redefinição (links de uso único por e-mail) ----------
r.get('/esqueci', (req, res) => res.render('esqueci', { emailAtivo: email.configurado(), enviado: false, erro: null }));

r.post('/esqueci', (req, res) => {
  const emailInformado = String(req.body.email || '').trim().toLowerCase().slice(0, 120);
  const pagina = (extra) => res.render('esqueci', { emailAtivo: email.configurado(), enviado: false, erro: null, ...extra });
  if (!email.configurado()) return pagina({});
  if (limiteIp(auth.ipDe(req), 'esqueci', 10)) return pagina({ erro: 'Muitas tentativas. Aguarde alguns minutos.' });
  // A resposta é sempre a mesma, exista ou não o e-mail, para não revelar quem tem acesso ao sistema.
  const u = db.prepare('SELECT * FROM usuarios WHERE email = ? AND ativo = 1 AND convite_pendente = 0').get(emailInformado);
  const recente = u && db.prepare(`SELECT 1 FROM tokens_conta WHERE usuario_id = ? AND tipo = 'redefinicao' AND criado_em > datetime('now', '-2 minutes')`).get(u.id);
  if (u && !recente) {
    auth.auditar(req, 'redefinicao_solicitada', { usuario: u });
    contas.enviarLink(u, 'redefinicao')
      .catch((e) => console.error('[Neuro Sistema] Falha ao enviar o link de redefinição de senha:', e.code || e.message));
  }
  pagina({ enviado: true });
});

function telaLink(tipo, titulo) {
  const exibir = (req, res, extra = {}) => {
    const v = contas.validar(req.params.token, tipo);
    res.status(v ? (extra.erro ? 400 : 200) : 410).render('definir-senha', {
      tipo, titulo, valido: !!v, nome: v?.usuario.nome, email: v?.usuario.email, erro: null, ...extra,
    });
    return v;
  };
  r.get(`/conta/${tipo === 'convite' ? 'ativar' : 'redefinir'}/:token`, (req, res) => { exibir(req, res); });
  r.post(`/conta/${tipo === 'convite' ? 'ativar' : 'redefinir'}/:token`, (req, res) => {
    if (limiteIp(auth.ipDe(req), 'link')) return exibir(req, res, { erro: 'Muitas tentativas. Aguarde alguns minutos.' });
    const v = contas.validar(req.params.token, tipo);
    if (!v) return exibir(req, res);
    const { senha, confirmacao } = req.body;
    const erro = senha !== confirmacao ? 'A confirmação não confere com a senha.' : validarSenha(senha);
    if (erro) return exibir(req, res, { erro });
    const u = v.usuario;
    db.prepare(`UPDATE usuarios SET senha_hash = ?, trocar_senha = 0, convite_pendente = 0, tentativas_falhas = 0, bloqueado_ate = NULL
                WHERE id = ?`).run(hashSenha(senha), u.id);
    contas.consumir(v.tokenId, u.id);
    db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(u.id);
    if (tipo === 'convite') {
      auth.auditar(req, 'conta_ativada', { usuario: u });
      auth.criarSessao(req, res, u);
      return res.redirect(303, '/'); // segue para o termo de confidencialidade
    }
    auth.auditar(req, 'senha_redefinida', { usuario: u });
    contas.avisarSenhaAlterada(u);
    res.redirect(303, '/login?redefinida=1');
  });
}
telaLink('convite', 'Ativar acesso');
telaLink('redefinicao', 'Criar senha nova');

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
  contas.avisarSenhaAlterada(req.usuario);
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
