const express = require('express');
const db = require('../db');
const auth = require('../auth');
const criancas = require('../criancas');
const multer = require('multer');
const { gerarRelatorioPdf } = require('../relatorioPdf');
const { gerarCrachaPdf } = require('../crachaPdf');
const crachas = require('../crachas');
const config = require('../config');
const { cifrar, decifrar, normalizar } = require('../seguranca');
const { ESPECIALIDADES, TIPOS_ATENDIMENTO, EVOLUCAO, LAUDO, ehProfissional, CONDICAO_CURTA } = require('../dominio');

const r = express.Router();
r.use(auth.exigir('verCriancas'));

const POR_PAGINA = 30;

function naoEncontrada() {
  const e = new Error('Cadastro não encontrado ou sem permissão de acesso.');
  e.status = 404; e.expose = true;
  return e;
}

// Carrega a criança do parâmetro :id e verifica se o usuário pode acessá-la
r.param('id', (req, res, next, id) => {
  const c = criancas.obter(Number(id));
  if (!c || !auth.podeVerCrianca(req.usuario, c.id)) {
    auth.auditar(req, 'acesso_negado', { entidade: 'crianca', entidadeId: Number(id) || null });
    return next(naoEncontrada());
  }
  req.crianca = c;
  next();
});

function listarAcompanhamentos(usuario, criancaId, { inicio, fim, especialidade } = {}) {
  let sql = `SELECT a.*, u.nome AS profissional_nome, u.registro_profissional
             FROM acompanhamentos a JOIN usuarios u ON u.id = a.profissional_id WHERE a.crianca_id = ?`;
  const p = [criancaId];
  if (inicio) { sql += ' AND a.data >= ?'; p.push(inicio); }
  if (fim) { sql += ' AND a.data <= ?'; p.push(fim); }
  if (especialidade) { sql += ' AND a.especialidade = ?'; p.push(especialidade); }
  return db.prepare(sql + ' ORDER BY a.data DESC, a.id DESC').all(...p).map((a) => {
    const visivel = auth.podeVerRegistro(usuario, a);
    return {
      ...a,
      visivel,
      evolucao: visivel ? a.evolucao : 'nao_avaliado',
      objetivos: visivel ? decifrar(a.objetivos_cifrado) : '',
      descricao: visivel ? decifrar(a.descricao_cifrado) : '',
      encaminhamentos: visivel ? decifrar(a.encaminhamentos_cifrado) : '',
    };
  });
}

function equipe(criancaId) {
  return db.prepare(`SELECT u.id, u.nome, u.perfil, u.registro_profissional FROM vinculos v
                     JOIN usuarios u ON u.id = v.usuario_id WHERE v.crianca_id = ? ORDER BY u.nome`).all(criancaId);
}

// ---------- Lista ----------
r.get('/', (req, res) => {
  const u = req.usuario;
  const q = req.query;
  let linhas = u.perfil === 'admin'
    ? db.prepare('SELECT * FROM criancas ORDER BY id DESC').all()
    : db.prepare('SELECT c.* FROM criancas c JOIN vinculos v ON v.crianca_id = c.id WHERE v.usuario_id = ? ORDER BY c.id DESC').all(u.id);

  if (q.condicao) linhas = linhas.filter((c) => JSON.parse(c.condicoes).includes(q.condicao));
  if (q.laudo in LAUDO) linhas = linhas.filter((c) => c.laudo === q.laudo);
  if (q.consentimento === 'pendente') linhas = linhas.filter((c) => !c.consentimento && !c.anonimizada);

  let lista = linhas.map(criancas.paraExibicao);
  const busca = normalizar(q.busca);
  if (busca) lista = lista.filter((c) => normalizar(c.nome).includes(busca) || c.codigo.toLowerCase().includes(busca) || normalizar(c.escola).includes(busca));

  const ultimos = new Map(db.prepare('SELECT crianca_id, MAX(data) AS ultima, COUNT(*) AS n FROM acompanhamentos GROUP BY crianca_id').all().map((x) => [x.crianca_id, x]));
  const pagina = Math.max(1, Number(q.pagina) || 1);
  const total = lista.length;
  lista = lista.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA).map((c) => ({ ...c, atend: ultimos.get(c.id) }));

  auth.auditar(req, 'listou_criancas', { detalhes: { busca: q.busca ? '(busca por texto)' : undefined, pagina, resultados: total } });
  res.render('criancas/lista', { lista, total, pagina, paginas: Math.ceil(total / POR_PAGINA) || 1, q });
});

// ---------- Cadastro manual (admin) ----------
r.get('/nova', auth.exigir('editarCriancas'), (req, res) => {
  res.render('criancas/form', { c: { condicoes: [], sexo: 'O', nivel_suporte: 'NA', laudo: 'em_avaliacao' }, erros: [], novo: true });
});

r.post('/nova', auth.exigir('editarCriancas'), (req, res) => {
  const { dados, erros } = criancas.validar(req.body);
  if (!erros.length && criancas.buscarPorIdentidade(dados.nome, dados.nascimento)) erros.push('Já existe um cadastro com este nome e data de nascimento.');
  if (erros.length) return res.status(400).render('criancas/form', { c: dados, erros, novo: true });
  const id = criancas.inserir(dados);
  auth.auditar(req, 'criou_crianca', { entidade: 'crianca', entidadeId: id });
  res.redirect(`/criancas/${id}`);
});

// ---------- Detalhe ----------
r.get('/:id', (req, res) => {
  const c = req.crianca;
  auth.auditar(req, 'visualizou_crianca', { entidade: 'crianca', entidadeId: c.id });
  const profissionais = req.usuario.perfil === 'admin'
    ? db.prepare(`SELECT id, nome, perfil FROM usuarios WHERE ativo = 1 AND perfil NOT IN ('admin','gestor') ORDER BY nome`).all()
    : [];
  const todos = listarAcompanhamentos(req.usuario, c.id);
  const esp = req.query.esp in ESPECIALIDADES ? req.query.esp : '';
  const filtrados = esp ? todos.filter((a) => a.especialidade === esp) : todos;
  const limite = req.query.todos ? Infinity : 15;
  res.render('criancas/detalhe', {
    c,
    acompanhamentos: filtrados.slice(0, limite),
    totalFiltrado: filtrados.length,
    totalRegistros: todos.length,
    especialidadesHistorico: [...new Set(todos.map((a) => a.especialidade))],
    esp,
    equipe: equipe(c.id),
    profissionais,
    podeRegistrar: auth.pode(req.usuario, 'registrarAcompanhamento') && !c.anonimizada,
  });
});

// ---------- Edição (admin) ----------
r.get('/:id/editar', auth.exigir('editarCriancas'), (req, res) => {
  if (req.crianca.anonimizada) return res.redirect(`/criancas/${req.crianca.id}`);
  res.render('criancas/form', { c: req.crianca, erros: [], novo: false });
});

r.post('/:id/editar', auth.exigir('editarCriancas'), (req, res) => {
  const c = req.crianca;
  if (c.anonimizada) return res.redirect(`/criancas/${c.id}`);
  const { dados, erros } = criancas.validar(req.body);
  const outro = !erros.length && criancas.buscarPorIdentidade(dados.nome, dados.nascimento);
  if (outro && outro.id !== c.id) erros.push('Já existe outro cadastro com este nome e data de nascimento.');
  if (erros.length) return res.status(400).render('criancas/form', { c: { ...dados, id: c.id, codigo: c.codigo }, erros, novo: false });
  criancas.atualizar(c.id, dados);
  auth.auditar(req, 'editou_crianca', { entidade: 'crianca', entidadeId: c.id });
  res.redirect(`/criancas/${c.id}`);
});

// ---------- Equipe (vínculo de profissionais) ----------
r.post('/:id/equipe', auth.exigir('editarCriancas'), (req, res) => {
  const c = req.crianca;
  const uid = Number(req.body.usuario_id);
  const prof = db.prepare('SELECT id, perfil FROM usuarios WHERE id = ? AND ativo = 1').get(uid);
  if (prof && ehProfissional(prof.perfil)) {
    if (req.body.acao === 'remover') {
      db.prepare('DELETE FROM vinculos WHERE crianca_id = ? AND usuario_id = ?').run(c.id, uid);
      auth.auditar(req, 'removeu_vinculo', { entidade: 'crianca', entidadeId: c.id, detalhes: { profissional: uid } });
    } else if (!c.anonimizada) {
      db.prepare('INSERT OR IGNORE INTO vinculos (crianca_id, usuario_id) VALUES (?, ?)').run(c.id, uid);
      auth.auditar(req, 'adicionou_vinculo', { entidade: 'crianca', entidadeId: c.id, detalhes: { profissional: uid } });
    }
  }
  res.redirect(`/criancas/${c.id}#equipe`);
});

// ---------- Acompanhamentos ----------
r.get('/:id/acompanhamentos/novo', auth.exigir('registrarAcompanhamento'), (req, res) => {
  res.render('criancas/acompanhamento', { c: req.crianca, a: { data: new Date().toISOString().slice(0, 10), tipo: 'sessao', evolucao: 'nao_avaliado' }, erros: [] });
});

r.post('/:id/acompanhamentos/novo', auth.exigir('registrarAcompanhamento'), (req, res) => {
  const c = req.crianca;
  if (c.anonimizada) return res.redirect(`/criancas/${c.id}`);
  const b = req.body;
  const a = {
    data: String(b.data || ''),
    tipo: b.tipo in TIPOS_ATENDIMENTO ? b.tipo : null,
    evolucao: b.evolucao in EVOLUCAO ? b.evolucao : 'nao_avaliado',
    objetivos: String(b.objetivos || '').trim().slice(0, 4000),
    descricao: String(b.descricao || '').trim().slice(0, 10000),
    encaminhamentos: String(b.encaminhamentos || '').trim().slice(0, 4000),
    sigiloso: b.sigiloso ? 1 : 0,
  };
  const erros = [];
  if (!criancas.dataValida(a.data) || a.data > new Date().toISOString().slice(0, 10)) erros.push('Informe uma data válida (não futura).');
  if (!a.tipo) erros.push('Selecione o tipo de atendimento.');
  if (a.descricao.length < 10) erros.push('Descreva o atendimento (mínimo de 10 caracteres).');
  if (erros.length) return res.status(400).render('criancas/acompanhamento', { c, a, erros });

  const info = db.prepare(`INSERT INTO acompanhamentos (crianca_id, profissional_id, especialidade, data, tipo, evolucao,
      objetivos_cifrado, descricao_cifrado, encaminhamentos_cifrado, sigiloso) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(c.id, req.usuario.id, req.usuario.perfil, a.data, a.tipo, a.evolucao,
      cifrar(a.objetivos), cifrar(a.descricao), cifrar(a.encaminhamentos), a.sigiloso);
  auth.auditar(req, 'registrou_acompanhamento', { entidade: 'crianca', entidadeId: c.id, detalhes: { acompanhamento: Number(info.lastInsertRowid) } });
  res.redirect(`/criancas/${c.id}#historico`);
});

// ---------- Relatório de acompanhamento (tela, impressão e PDF) ----------
function montarRelatorio(req) {
  const c = req.crianca;
  const q = req.query;
  const filtro = {
    inicio: criancas.dataValida(q.inicio) ? q.inicio : '',
    fim: criancas.dataValida(q.fim) ? q.fim : '',
    especialidade: q.especialidade in ESPECIALIDADES ? q.especialidade : '',
  };
  const registros = listarAcompanhamentos(req.usuario, c.id, filtro);
  const resumo = {};
  for (const a of registros) {
    const s = (resumo[a.especialidade] ||= { total: 0, primeira: a.data, ultima: a.data, evolucao: {} });
    s.total++;
    if (a.data < s.primeira) s.primeira = a.data;
    if (a.data > s.ultima) s.ultima = a.data;
    if (a.evolucao !== 'nao_avaliado') s.evolucao[a.evolucao] = (s.evolucao[a.evolucao] || 0) + 1;
  }
  return { c, registros, resumo, filtro, equipe: equipe(c.id), geradoEm: new Date() };
}

r.get('/:id/relatorio', auth.exigir('relatorios'), (req, res) => {
  const dados = montarRelatorio(req);
  auth.auditar(req, 'gerou_relatorio', { entidade: 'crianca', entidadeId: dados.c.id, detalhes: dados.filtro });
  res.render('criancas/relatorio', { ...dados, qsPdf: new URLSearchParams(Object.entries(dados.filtro).filter(([, v]) => v)).toString() });
});

r.get('/:id/relatorio.pdf', auth.exigir('relatorios'), (req, res) => {
  const dados = montarRelatorio(req);
  auth.auditar(req, 'exportou_relatorio_pdf', { entidade: 'crianca', entidadeId: dados.c.id, detalhes: dados.filtro });
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="relatorio-${dados.c.codigo}-${new Date().toISOString().slice(0, 10)}.pdf"`);
  gerarRelatorioPdf({ ...dados, usuario: req.usuario, adm: !ehProfissional(req.usuario.perfil) }, res);
});

// ---------- Crachá de identificação (PDF no tamanho de cartão de PVC) ----------
// A foto é lida em memória só para montar o PDF e não fica gravada no servidor.
const uploadFoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 20 },
});
const ehImagem = (b) => b && b.length > 8 && ((b[0] === 0xff && b[1] === 0xd8) || b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
const destaquePadrao = (c) => c.condicoes.map((x) => CONDICAO_CURTA[x] || x).join(' · ');
const t = (v, max) => String(v || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);

function formCracha(c) {
  return {
    nome_cracha: crachas.nomeCurto(c.nome), condicao: destaquePadrao(c), mostrar_condicao: '1', cid: c.cid || '', mostrar_cid: '',
    contato1_nome: c.responsavel ? `${c.responsavel} (responsável)` : '', contato1_tel: c.telefone || '', contato2_nome: '', contato2_tel: '',
  };
}

r.get('/:id/cracha', auth.exigir('editarCriancas'), (req, res) => {
  const c = req.crianca;
  if (c.anonimizada) return res.redirect(`/criancas/${c.id}`);
  res.render('criancas/cracha', { c, form: formCracha(c), erro: null, ultima: crachas.ultimaEmissao(c.id) });
});

r.post('/:id/cracha', auth.exigir('editarCriancas'), (req, res, next) => {
  const c = req.crianca;
  if (c.anonimizada) return res.redirect(`/criancas/${c.id}`);
  uploadFoto.single('foto')(req, res, (err) => {
    try {
      // O token CSRF chega no corpo multipart, então a verificação acontece após o upload
      if (req.body?._csrf !== req.csrf) return res.status(403).render('erro', { titulo: 'Requisição recusada', mensagem: 'Token de segurança inválido.' });
      const b = req.body;
      const form = {
        nome_cracha: t(b.nome_cracha, 40), condicao: t(b.condicao, 40), mostrar_condicao: b.mostrar_condicao === '1' ? '1' : '',
        cid: t(b.cid, 20), mostrar_cid: b.mostrar_cid === '1' ? '1' : '',
        contato1_nome: t(b.contato1_nome, 50), contato1_tel: t(b.contato1_tel, 25), contato2_nome: t(b.contato2_nome, 50), contato2_tel: t(b.contato2_tel, 25),
      };
      const falha = (erro) => res.status(400).render('criancas/cracha', { c, form, erro, ultima: crachas.ultimaEmissao(c.id) });
      if (err) return falha(err.code === 'LIMIT_FILE_SIZE' ? 'A foto deve ter no máximo 8 MB.' : 'Falha no envio da foto.');
      if (req.file && !ehImagem(req.file.buffer)) return falha('A foto deve ser um arquivo JPG ou PNG.');
      if (form.nome_cracha.length < 2) return falha('Informe o nome que vai na frente do crachá.');
      if (!form.contato1_tel) return falha('Informe ao menos um telefone de emergência.');
      if (b.autorizacao !== '1') return falha('Confirme que o responsável pediu o crachá e autorizou os dados impressos.');

      const destaque = [form.mostrar_condicao && form.condicao, form.mostrar_cid && form.cid && `CID ${form.cid}`].filter(Boolean).join(' · ');
      const bruto = crachas.registrar(c.id, form.nome_cracha, req.usuario.id);
      const base = config.endereco || `${req.protocol}://${req.get('host')}`;
      auth.auditar(req, 'emitiu_cracha', { entidade: 'crianca', entidadeId: c.id, detalhes: { condicao: !!form.mostrar_condicao, cid: !!(form.mostrar_cid && form.cid), foto: !!req.file } });
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="cracha-${c.codigo}.pdf"`);
      gerarCrachaPdf({
        nomeCracha: form.nome_cracha,
        nomeCompleto: c.nome,
        nascimento: c.nascimento ? c.nascimento.split('-').reverse().join('/') : '—',
        destaque,
        contatos: [[form.contato1_nome, form.contato1_tel], [form.contato2_nome, form.contato2_tel]].filter(([, tel]) => tel).map(([nome, telefone]) => ({ nome, telefone })),
        codigo: c.codigo,
        emitidoEm: new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
        foto: req.file?.buffer,
        urlVerificacao: `${base}/v/${bruto}`,
      }, res);
    } catch (e) { next(e); }
  });
});

// ---------- Direitos do titular (LGPD art. 18) ----------
r.get('/:id/exportar', auth.exigir('administrar'), (req, res) => {
  const c = req.crianca;
  const dados = {
    exportado_em: new Date().toISOString(),
    aviso: 'Dados pessoais sensíveis (LGPD art. 11). Entregar somente ao responsável legal da criança.',
    crianca: {
      codigo: c.codigo, nome: c.nome, nascimento: c.nascimento, sexo: c.sexo, condicoes: c.condicoes, cid: c.cid,
      nivel_suporte: c.nivel_suporte, laudo: c.laudo, escola: c.escola, serie: c.serie, turno: c.turno, regiao: c.regiao,
      aee: !!c.aee, mediador: !!c.mediador, responsavel: c.responsavel, telefone: c.telefone, observacoes: c.observacoes,
      consentimento: !!c.consentimento, consentimento_data: c.consentimento_data,
    },
    equipe: equipe(c.id).map((e) => ({ nome: e.nome, especialidade: ESPECIALIDADES[e.perfil] })),
    // A Secretaria não acessa o conteúdo clínico: o conteúdo é fornecido pelos profissionais (relatório de acompanhamento)
    acompanhamentos_aviso: 'O conteúdo dos atendimentos é mantido pelos profissionais da equipe e deve ser solicitado a eles.',
    acompanhamentos: listarAcompanhamentos(req.usuario, c.id).map((a) => ({
      data: a.data, especialidade: ESPECIALIDADES[a.especialidade], tipo: TIPOS_ATENDIMENTO[a.tipo], profissional: a.profissional_nome,
    })),
  };
  auth.auditar(req, 'exportou_dados_titular', { entidade: 'crianca', entidadeId: c.id });
  res.set('Content-Disposition', `attachment; filename="${c.codigo}-dados.json"`);
  res.json(dados);
});

r.post('/:id/anonimizar', auth.exigir('administrar'), (req, res) => {
  const c = req.crianca;
  if (req.body.confirmacao !== c.codigo) {
    const e = new Error('Para anonimizar, digite o código do cadastro exatamente como exibido.');
    e.status = 400; e.expose = true;
    throw e;
  }
  criancas.anonimizar(c.id);
  auth.auditar(req, 'anonimizou_crianca', { entidade: 'crianca', entidadeId: c.id });
  res.redirect(`/criancas/${c.id}`);
});

module.exports = r;
