const express = require('express');
const db = require('../db');
const auth = require('../auth');

const r = express.Router();
r.use(auth.exigir('administrar'));

const POR_PAGINA = 50;

r.get('/', (req, res) => {
  const q = req.query;
  const onde = [];
  const p = [];
  if (q.usuario) { onde.push('usuario_id = ?'); p.push(Number(q.usuario)); }
  if (q.acao) { onde.push('acao = ?'); p.push(q.acao); }
  if (q.crianca) { onde.push(`entidade = 'crianca' AND entidade_id = ?`); p.push(Number(q.crianca)); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.inicio || '')) { onde.push('criado_em >= ?'); p.push(q.inicio); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.fim || '')) { onde.push('criado_em < date(?, \'+1 day\')'); p.push(q.fim); }
  const where = onde.length ? 'WHERE ' + onde.join(' AND ') : '';
  const pagina = Math.max(1, Number(q.pagina) || 1);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM auditoria ${where}`).get(...p).n;
  const registros = db.prepare(`SELECT * FROM auditoria ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...p, POR_PAGINA, (pagina - 1) * POR_PAGINA);
  const codigos = new Map(db.prepare('SELECT id, codigo FROM criancas').all().map((c) => [c.id, c.codigo]));
  res.render('auditoria', {
    registros: registros.map((r2) => ({ ...r2, codigo: r2.entidade === 'crianca' ? codigos.get(r2.entidade_id) : null })),
    usuarios: db.prepare('SELECT id, nome FROM usuarios ORDER BY nome').all(),
    acoes: db.prepare('SELECT DISTINCT acao FROM auditoria ORDER BY acao').all().map((a) => a.acao),
    q, pagina, paginas: Math.ceil(total / POR_PAGINA) || 1, total,
  });
});

module.exports = r;
