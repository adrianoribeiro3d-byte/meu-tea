const express = require('express');
const db = require('../db');
const auth = require('../auth');
const { decifrar } = require('../seguranca');

const r = express.Router();
r.use(auth.exigir('administrar'));

r.get('/', (req, res) => {
  const lista = db.prepare('SELECT * FROM solicitacoes ORDER BY atendida, id DESC').all().map((s) => ({
    ...s, nome: decifrar(s.nome_cifrado), email: decifrar(s.email_cifrado), telefone: decifrar(s.telefone_cifrado), mensagem: decifrar(s.mensagem_cifrada),
  }));
  auth.auditar(req, 'listou_solicitacoes', { detalhes: { total: lista.length } });
  res.render('solicitacoes', { lista });
});

r.post('/:id/atendida', (req, res) => {
  const id = Number(req.params.id);
  const atendida = req.body.atendida === '1' ? 1 : 0;
  db.prepare('UPDATE solicitacoes SET atendida = ? WHERE id = ?').run(atendida, id);
  auth.auditar(req, atendida ? 'marcou_solicitacao_atendida' : 'reabriu_solicitacao', { entidade: 'solicitacao', entidadeId: id });
  res.redirect('/solicitacoes');
});

module.exports = r;
