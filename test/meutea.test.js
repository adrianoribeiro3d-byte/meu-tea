// Testes de ponta a ponta com banco temporário: node --test test/
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meutea-'));
process.env.MEUTEA_DADOS = tmp;
process.env.MEUTEA_DB = path.join(tmp, 'teste.db');
process.env.MEUTEA_MASTER_KEY = '11'.repeat(32);
process.env.LGPD_MIN_GRUPO = '3';

const db = require('../src/db');
const seg = require('../src/seguranca');
const criancas = require('../src/criancas');
const estatisticas = require('../src/estatisticas');
const importador = require('../src/importador');
const app = require('../src/server');

let servidor, base;
const SENHA = 'senhaTeste123';

function criarUsuario(email, perfil) {
  return Number(db.prepare('INSERT INTO usuarios (nome, email, senha_hash, perfil, trocar_senha, termo_versao) VALUES (?,?,?,?,0,?)')
    .run(email, email, seg.hashSenha(SENHA), perfil, '1.0').lastInsertRowid);
}

async function entrar(email) {
  const r = await fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, senha: SENHA }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const get = (url) => fetch(base + url, { headers: { cookie }, redirect: 'manual' });
  const pagina = await (await get('/conta/senha')).text();
  const csrf = pagina.match(/name="_csrf" value="([^"]+)"/)[1];
  const post = (url, dados) => fetch(base + url, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(dados) });
  return { get, post, csrf };
}

const dadosCrianca = (nome, extra = {}) => criancas.validar({ nome, nascimento: '2016-05-10', sexo: 'M', condicoes: ['TDAH'], regiao: 'Centro', ...extra }).dados;

before(async () => {
  servidor = app.listen(0);
  await new Promise((ok) => servidor.once('listening', ok));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => { servidor.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('criptografia de campos e índice cego', () => {
  const c = seg.cifrar('Maria da Silva');
  assert.notStrictEqual(c, 'Maria da Silva');
  assert.notStrictEqual(seg.cifrar('Maria da Silva'), c, 'IV aleatório');
  assert.strictEqual(seg.decifrar(c), 'Maria da Silva');
  assert.strictEqual(seg.indiceCego('MARIA  da Silva', '2016-01-01'), seg.indiceCego('maria da silva', '2016-01-01'));
  assert.throws(() => seg.decifrar(c.slice(0, -4) + 'AAAA'));
});

test('nome da criança não fica em claro no banco', () => {
  const id = criancas.inserir(dadosCrianca('Joaquim Segredo'));
  const linha = db.prepare('SELECT * FROM criancas WHERE id = ?').get(id);
  assert.ok(!JSON.stringify(linha).includes('Joaquim'));
  assert.strictEqual(criancas.obter(id).nome, 'Joaquim Segredo');
});

test('validação rejeita datas inexistentes', () => {
  assert.ok(criancas.validar({ nome: 'Teste Data', nascimento: '2016-02-31', condicoes: ['TDAH'] }).erros.length);
  assert.ok(!criancas.validar({ nome: 'Teste Data', nascimento: '2016-02-29', condicoes: ['TDAH'] }).erros.length);
});

test('importação de CSV com cabeçalhos variados', async () => {
  const csv = 'Aluno;DN;Diagnóstico;Laudo;Bairro\nAna Teste;05/03/2017;Autismo, TDAH;sim;Centro\n;01/01/2015;TEA;;\nBeto Teste;31/02/2016;TEA;;\n';
  const p = await importador.preVisualizar(Buffer.from(csv), 'x.csv');
  assert.strictEqual(p.registros.length, 2);
  assert.deepStrictEqual(p.registros[0].dados.condicoes, ['TEA (Transtorno do Espectro Autista)', 'TDAH']);
  assert.strictEqual(p.registros[0].dados.nascimento, '2017-03-05');
  assert.strictEqual(p.registros[0].acao, 'inserir');
  assert.strictEqual(p.registros[1].acao, 'ignorar');
});

test('dashboard suprime grupos pequenos', () => {
  ['A', 'B', 'C'].forEach((n) => criancas.inserir(dadosCrianca(`Centro ${n}`)));
  criancas.inserir(dadosCrianca('Um Norte', { regiao: 'Norte' }));
  const est = estatisticas.calcular({});
  assert.ok(!est.porRegiao.some((r) => r.rotulo === 'Norte'), 'região com 1 criança não aparece');
  assert.strictEqual(estatisticas.calcular({ regiao: 'Norte' }).suprimido, true, 'filtro com 1 criança é suprimido');
  assert.ok(!estatisticas.opcoesFiltro().regioes.includes('Norte'));
});

test('controle de acesso por perfil e vínculo', async () => {
  const idPsico = criarUsuario('psico@t', 'psicologo');
  const idFono = criarUsuario('fono@t', 'fonoaudiologo');
  criarUsuario('gestor@t', 'gestor');
  const idC = criancas.inserir(dadosCrianca('Criança Vinculada'));
  db.prepare('INSERT INTO vinculos VALUES (?, ?, datetime())').run(idC, idPsico);
  db.prepare('INSERT INTO vinculos VALUES (?, ?, datetime())').run(idC, idFono);

  const gestor = await entrar('gestor@t');
  assert.strictEqual((await gestor.get('/')).status, 200);
  assert.strictEqual((await gestor.get('/criancas')).status, 403);

  const psico = await entrar('psico@t');
  assert.strictEqual((await psico.get(`/criancas/${idC}`)).status, 200);
  assert.strictEqual((await psico.get('/criancas/1')).status, 404, 'sem vínculo = sem acesso');

  // registro sigiloso: psicólogo vê, fono não
  let r = await psico.post(`/criancas/${idC}/acompanhamentos/novo`, { _csrf: psico.csrf, data: '2026-01-10', tipo: 'sessao', evolucao: 'avancou', descricao: 'Conteúdo clínico confidencial XYZ', sigiloso: '1' });
  assert.strictEqual(r.status, 302);
  r = await psico.post(`/criancas/${idC}/acompanhamentos/novo`, { data: '2026-01-10', tipo: 'sessao', descricao: 'sem token csrf aqui' });
  assert.strictEqual(r.status, 403, 'CSRF obrigatório');
  assert.ok((await (await psico.get(`/criancas/${idC}`)).text()).includes('confidencial XYZ'));
  const fono = await entrar('fono@t');
  const html = await (await fono.get(`/criancas/${idC}`)).text();
  assert.ok(!html.includes('confidencial XYZ'));
  assert.ok(html.includes('sigilo profissional'));

  // auditoria registra a visualização e não pode ser apagada
  assert.ok(db.prepare(`SELECT 1 FROM auditoria WHERE acao = 'visualizou_crianca' AND entidade_id = ?`).get(idC));
  assert.throws(() => db.prepare('DELETE FROM auditoria').run());
});

test('bloqueio após tentativas de login inválidas', async () => {
  criarUsuario('alvo@t', 'nutricionista');
  for (let i = 0; i < 5; i++) {
    await fetch(base + '/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=alvo@t&senha=errada' });
  }
  const r = await fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `email=alvo@t&senha=${SENHA}` });
  assert.strictEqual(r.status, 401, 'senha correta recusada durante o bloqueio');
});

test('anonimização remove identificação e mantém estatística', () => {
  const id = criancas.inserir(dadosCrianca('Para Anonimizar'));
  const antes = estatisticas.calcular({}).total;
  criancas.anonimizar(id);
  const l = db.prepare('SELECT * FROM criancas WHERE id = ?').get(id);
  assert.strictEqual(l.nome_cifrado, null);
  assert.strictEqual(l.telefone_cifrado, null);
  assert.strictEqual(estatisticas.calcular({}).total, antes);
});
