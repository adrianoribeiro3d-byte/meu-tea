// Testes de ponta a ponta com banco temporário: node --test test/
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neuro-sistema-'));
process.env.NEUROSISTEMA_DADOS = tmp;
process.env.NEUROSISTEMA_DB = path.join(tmp, 'teste.db');
process.env.NEUROSISTEMA_MASTER_KEY = '11'.repeat(32);
process.env.LGPD_MIN_GRUPO = '3';
process.env.NEUROSISTEMA_TOKEN_INSTALACAO = 'palavra-secreta-teste';
process.env.NEUROSISTEMA_PAGINA_INICIAL = '1';

const db = require('../src/db');
const seg = require('../src/seguranca');
const criancas = require('../src/criancas');
const estatisticas = require('../src/estatisticas');
const importador = require('../src/importador');
const app = require('../src/server');
const config = require('../src/config');
const email = require('../src/email');

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

test('instalação cria o primeiro administrador uma única vez', async () => {
  const form = (dados) => fetch(base + '/instalacao', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(dados) });
  let r = await fetch(base + '/login', { redirect: 'manual' });
  assert.strictEqual(r.headers.get('location'), '/instalacao', 'sem usuários, o login leva à instalação');
  const dados = { token: 'errada', nome: 'Admin Teste', email: 'primeiro@teste.gov', senha: 'SenhaForte123', confirmacao: 'SenhaForte123' };
  r = await form(dados);
  assert.strictEqual(r.status, 400, 'palavra-chave errada é recusada');
  r = await form({ ...dados, token: 'palavra-secreta-teste' });
  assert.strictEqual(r.status, 302);
  assert.strictEqual(db.prepare(`SELECT perfil FROM usuarios WHERE email = 'primeiro@teste.gov'`).get().perfil, 'admin');
  r = await form({ ...dados, token: 'palavra-secreta-teste', email: 'segundo@teste.gov' });
  assert.strictEqual(r.headers.get('location'), '/login', 'depois do primeiro usuário a instalação fica bloqueada');
  assert.ok(!db.prepare(`SELECT 1 FROM usuarios WHERE email = 'segundo@teste.gov'`).get());
});

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

test('Secretaria não vê conteúdo dos acompanhamentos', async () => {
  criarUsuario('adm@t', 'admin');
  const idProf = criarUsuario('to@t', 'terapeuta_ocupacional');
  const idC = criancas.inserir(dadosCrianca('Criança Conteúdo'));
  db.prepare('INSERT INTO vinculos VALUES (?, ?, datetime())').run(idC, idProf);
  const to = await entrar('to@t');
  await to.post(`/criancas/${idC}/acompanhamentos/novo`, { _csrf: to.csrf, data: '2026-02-01', tipo: 'sessao', evolucao: 'avancou', descricao: 'Texto aberto para a equipe ABC' });
  assert.ok((await (await to.get(`/criancas/${idC}`)).text()).includes('Texto aberto para a equipe ABC'));

  const adm = await entrar('adm@t');
  const ficha = await (await adm.get(`/criancas/${idC}`)).text();
  assert.ok(!ficha.includes('Texto aberto para a equipe ABC'));
  assert.ok(ficha.includes('restrito aos profissionais da equipe'));
  assert.ok(!ficha.includes('Avançou'), 'evolução também é ocultada');
  assert.ok(!(await (await adm.get(`/criancas/${idC}/relatorio`)).text()).includes('Texto aberto para a equipe ABC'));
  assert.ok(!(await (await adm.get(`/criancas/${idC}/exportar`)).text()).includes('Texto aberto para a equipe ABC'));
});

test('painel individual mostra só as crianças e registros do próprio profissional', async () => {
  const idA = criarUsuario('nutriA@t', 'nutricionista');
  const idB = criarUsuario('nutriB@t', 'nutricionista');
  const cA = criancas.inserir(dadosCrianca('Criança Do Painel A'));
  const cB = criancas.inserir(dadosCrianca('Criança Do Painel B'));
  db.prepare('INSERT INTO vinculos VALUES (?, ?, datetime())').run(cA, idA);
  db.prepare('INSERT INTO vinculos VALUES (?, ?, datetime())').run(cB, idB);
  const a = await entrar('nutriA@t');
  const html = await (await a.get('/')).text();
  assert.ok(html.includes('Meu painel') && html.includes('Criança Do Painel A'));
  assert.ok(!html.includes('Criança Do Painel B'));
  assert.strictEqual((await a.get(`/criancas/${cB}`)).status, 404);
  assert.strictEqual((await a.get('/panorama')).status, 200, 'panorama anônimo continua disponível');
});

test('relatório em PDF respeita o perfil de quem exporta', async () => {
  criarUsuario('admpdf@t', 'admin');
  const idProf = criarUsuario('fonopdf@t', 'fonoaudiologo');
  const idC = criancas.inserir(dadosCrianca('Criança Do PDF'));
  db.prepare('INSERT INTO vinculos VALUES (?, ?, datetime())').run(idC, idProf);
  const prof = await entrar('fonopdf@t');
  await prof.post(`/criancas/${idC}/acompanhamentos/novo`, { _csrf: prof.csrf, data: '2026-03-01', tipo: 'sessao', descricao: 'Texto clinico do PDF 123' });
  const r = await prof.get(`/criancas/${idC}/relatorio.pdf`);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('content-type'), 'application/pdf');
  assert.match(r.headers.get('content-disposition'), /attachment; filename="relatorio-NS-\d+-/);
  const bytes = Buffer.from(await r.arrayBuffer());
  assert.strictEqual(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.ok(db.prepare(`SELECT 1 FROM auditoria WHERE acao = 'exportou_relatorio_pdf' AND entidade_id = ?`).get(idC));
  const adm = await entrar('admpdf@t');
  assert.strictEqual((await adm.get(`/criancas/${idC}/relatorio.pdf`)).status, 200);
  criarUsuario('nutripdf@t', 'nutricionista');
  const semVinculo = await entrar('nutripdf@t');
  assert.strictEqual((await semVinculo.get(`/criancas/${idC}/relatorio.pdf`)).status, 404, 'sem vínculo não exporta');
});

test('página institucional e pedido de demonstração', async () => {
  let r = await fetch(base + '/', { redirect: 'manual' });
  assert.strictEqual(r.status, 200, 'visitante vê a página inicial');
  const html = await r.text();
  assert.ok(html.includes('Gestão e monitoramento do desenvolvimento') && !html.includes('href="/login"'), 'a página não leva ao login: cada município tem seu subdomínio');
  const enviar = (dados) => fetch(base + '/demonstracao', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(dados) });
  const dados = { nome: 'Maria Contato', instituicao: 'Secretaria de Educação', email: 'maria@prefeitura.gov.br', telefone: '(00) 90000-0000', consentimento: 'sim' };
  const enviados = [];
  email.definirTransporte({ sendMail: async (m) => { enviados.push(m); return {}; } });
  config.smtp.destino = 'contato@neurosistema.com.br';
  assert.strictEqual((await enviar({ ...dados, consentimento: '' })).status, 400, 'sem autorização não envia');
  assert.strictEqual(enviados.length, 0);
  r = await enviar({ ...dados, instituicao: 'Secretaria de Educação\r\nBcc: x@y.z' });
  assert.strictEqual(r.status, 303);
  assert.strictEqual(enviados.length, 1, 'pedido avisado por e-mail');
  assert.strictEqual(enviados[0].to, 'contato@neurosistema.com.br');
  assert.strictEqual(enviados[0].replyTo.address, 'maria@prefeitura.gov.br', 'responder vai para quem pediu');
  assert.ok(!/[\r\n]/.test(enviados[0].subject), 'assunto sem quebra de linha (sem injeção de cabeçalho)');
  assert.ok(enviados[0].text.includes('(00) 90000-0000'));
  email.definirTransporte({ sendMail: async () => { throw new Error('SMTP fora do ar'); } });
  const erroOriginal = console.error; console.error = () => {};
  r = await enviar(dados);
  await new Promise((ok) => setImmediate(ok));
  console.error = erroOriginal;
  assert.strictEqual(r.status, 303, 'falha no e-mail não impede o registro do pedido');
  email.definirTransporte(null);
  assert.strictEqual(r.status, 303);
  const linha = db.prepare('SELECT * FROM solicitacoes ORDER BY id DESC').get();
  assert.strictEqual(linha.instituicao, 'Secretaria de Educação');
  assert.ok(!JSON.stringify(linha).includes('maria@prefeitura'), 'contato gravado cifrado');
  const antes = db.prepare('SELECT COUNT(*) AS n FROM solicitacoes').get().n;
  await enviar({ ...dados, site: 'http://spam' });
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM solicitacoes').get().n, antes, 'robô (campo-armadilha) é ignorado');
  criarUsuario('admsite@t', 'admin');
  const adm = await entrar('admsite@t');
  assert.ok((await (await adm.get('/solicitacoes')).text()).includes('maria@prefeitura.gov.br'));
  const prof = await entrar('fono@t');
  assert.strictEqual((await prof.get('/solicitacoes')).status, 403);
});

test('nos subdomínios dos municípios o endereço abre direto no login', async () => {
  config.paginaInicial = false;
  try {
    let r = await fetch(base + '/', { redirect: 'manual' });
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.get('location'), '/login');
    r = await fetch(base + '/login');
    assert.ok(!(await r.text()).includes('Voltar ao site'));
    r = await fetch(base + '/demonstracao', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'nome=Fulano&instituicao=Teste&email=a@b.cd&consentimento=sim' });
    assert.strictEqual(r.status, 404, 'sem página inicial não recebe pedidos');
  } finally {
    config.paginaInicial = true;
  }
});

test('convite por e-mail: o profissional ativa o acesso e cria a própria senha', async () => {
  const enviados = [];
  email.definirTransporte({ sendMail: async (m) => { enviados.push(m); return {}; } });
  config.endereco = 'https://municipio.exemplo.gov.br';
  try {
    criarUsuario('admconvite@t', 'admin');
    const adm = await entrar('admconvite@t');
    let r = await adm.post('/usuarios', { _csrf: adm.csrf, nome: 'Paula Fono', email: 'paula@prefeitura.gov.br', perfil: 'fonoaudiologo' });
    let html = await r.text();
    assert.strictEqual(r.status, 200);
    assert.ok(html.includes('Convite') && html.includes('paula@prefeitura.gov.br'), 'admin vê a confirmação do envio');
    assert.strictEqual(enviados.length, 1);
    assert.strictEqual(enviados[0].to, 'paula@prefeitura.gov.br');
    const link = enviados[0].text.match(/https:\/\/municipio\.exemplo\.gov\.br(\/conta\/ativar\/[0-9a-f]{64})/);
    assert.ok(link, 'o link usa o endereço configurado, não o cabeçalho Host');
    assert.ok(!html.includes(link[1]), 'o administrador não vê o link quando o e-mail é enviado');
    const u = db.prepare(`SELECT * FROM usuarios WHERE email = 'paula@prefeitura.gov.br'`).get();
    assert.strictEqual(u.convite_pendente, 1);
    assert.ok(!db.prepare('SELECT 1 FROM tokens_conta WHERE token_hash = ?').get(link[1].split('/').pop()), 'o banco guarda só o hash do link');

    // Antes de ativar, não há senha que funcione
    r = await fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=paula@prefeitura.gov.br&senha=!' });
    assert.strictEqual(r.status, 401);

    const ativar = (dados) => fetch(base + link[1], { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(dados) });
    assert.strictEqual((await fetch(base + link[1])).status, 200);
    assert.strictEqual((await ativar({ senha: 'curta', confirmacao: 'curta' })).status, 400, 'política de senha vale na ativação');
    r = await ativar({ senha: 'SenhaDaPaula123', confirmacao: 'SenhaDaPaula123' });
    assert.strictEqual(r.status, 303);
    assert.ok(r.headers.get('set-cookie'), 'ativação já abre a sessão (segue para o termo)');
    assert.strictEqual(db.prepare('SELECT convite_pendente FROM usuarios WHERE id = ?').get(u.id).convite_pendente, 0);
    assert.strictEqual((await ativar({ senha: 'OutraSenha123', confirmacao: 'OutraSenha123' })).status, 410, 'link de uso único');
    r = await fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=paula@prefeitura.gov.br&senha=SenhaDaPaula123' });
    assert.strictEqual(r.status, 302, 'entra com a senha que ela mesma criou');
    const acoes = db.prepare('SELECT acao FROM auditoria WHERE entidade_id = ? OR usuario_id = ?').all(u.id, u.id).map((a) => a.acao);
    assert.ok(acoes.includes('convite_enviado') && acoes.includes('conta_ativada'));

    // Convite vencido não ativa
    await adm.post('/usuarios', { _csrf: adm.csrf, nome: 'Rui Psico', email: 'rui@prefeitura.gov.br', perfil: 'psicologo' });
    const linkRui = enviados.at(-1).text.match(/\/conta\/ativar\/[0-9a-f]{64}/)[0];
    db.prepare(`UPDATE tokens_conta SET expira_em = datetime('now', '-1 minute') WHERE usuario_id = (SELECT id FROM usuarios WHERE email = 'rui@prefeitura.gov.br')`).run();
    assert.strictEqual((await fetch(base + linkRui)).status, 410);
    html = await (await adm.get('/usuarios')).text();
    assert.ok(html.includes('convite expirado') && html.includes('Reenviar convite'));
  } finally {
    email.definirTransporte(null);
    config.endereco = '';
  }
});

test('sem e-mail configurado, o administrador recebe o link para repassar', async () => {
  criarUsuario('admsememail@t', 'admin');
  const adm = await entrar('admsememail@t');
  const r = await adm.post('/usuarios', { _csrf: adm.csrf, nome: 'Ana Nutri', email: 'ana@prefeitura.gov.br', perfil: 'nutricionista' });
  const html = await r.text();
  assert.ok(/\/conta\/ativar\/[0-9a-f]{64}/.test(html), 'link exibido uma única vez');
  assert.ok(!/Senha provisória/i.test(html), 'não existe mais senha provisória definida pelo administrador');
});

test('esqueci minha senha: link de uso único, sem revelar quem tem cadastro', async () => {
  const enviados = [];
  email.definirTransporte({ sendMail: async (m) => { enviados.push(m); return {}; } });
  config.endereco = 'https://municipio.exemplo.gov.br';
  try {
    criarUsuario('esqueceu@prefeitura.gov.br', 'psicologo');
    const sessaoAntiga = await entrar('esqueceu@prefeitura.gov.br');
    const pedir = (e) => fetch(base + '/esqueci', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: e }) }).then((x) => x.text());
    const existe = await pedir('esqueceu@prefeitura.gov.br');
    const naoExiste = await pedir('ninguem@prefeitura.gov.br');
    assert.strictEqual(existe, naoExiste, 'mesma resposta para e-mail cadastrado ou não');
    await new Promise((ok) => setImmediate(ok));
    assert.strictEqual(enviados.length, 1, 'só o e-mail cadastrado recebe o link');
    await pedir('esqueceu@prefeitura.gov.br');
    assert.strictEqual(enviados.length, 1, 'não reenvia em sequência (evita bombardear a caixa de alguém)');
    const link = enviados[0].text.match(/\/conta\/redefinir\/[0-9a-f]{64}/)[0];
    const redefinir = (dados) => fetch(base + link, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(dados) });
    let r = await redefinir({ senha: 'NovaSenha2026', confirmacao: 'NovaSenha2026' });
    assert.strictEqual(r.status, 303);
    assert.strictEqual(r.headers.get('location'), '/login?redefinida=1');
    assert.strictEqual((await sessaoAntiga.get('/conta/senha')).headers.get('location'), '/login', 'sessões abertas antes da troca são encerradas');
    assert.strictEqual((await redefinir({ senha: 'OutraSenha2026', confirmacao: 'OutraSenha2026' })).status, 410, 'link de uso único');
    assert.ok(enviados.some((m) => /foi alterada/.test(m.subject)), 'avisa o dono da conta que a senha mudou');
    r = await fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=esqueceu@prefeitura.gov.br&senha=NovaSenha2026' });
    assert.strictEqual(r.status, 302);
    assert.strictEqual((await fetch(base + '/conta/redefinir/abc')).status, 410, 'link malformado');
  } finally {
    email.definirTransporte(null);
    config.endereco = '';
  }
});
