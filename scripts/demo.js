// Popula o banco com dados FICTÍCIOS para demonstração. Uso: npm run demo
// Não use em produção: cria usuários com senha conhecida.
const db = require('../src/db');
const { hashSenha, cifrar } = require('../src/seguranca');
const criancas = require('../src/criancas');
const { CONDICOES } = require('../src/dominio');

if (db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n && !process.argv.includes('--forcar')) {
  console.error('O banco já possui dados. Use "npm run demo -- --forcar" para adicionar dados de demonstração mesmo assim.');
  process.exit(1);
}

let semente = 42;
const rnd = () => ((semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648);
const escolher = (l) => l[Math.floor(rnd() * l.length)];
const ponderado = (pares) => { let r = rnd() * pares.reduce((s, [, p]) => s + p, 0); for (const [v, p] of pares) { if ((r -= p) <= 0) return v; } return pares[0][0]; };

const SENHA = 'demo12345678';
const usuarios = [
  ['Ana Secretaria (demo)', 'admin@meutea.demo', 'admin', null],
  ['Gustavo Gestor (demo)', 'gestor@meutea.demo', 'gestor', null],
  ['Beatriz Neuropedagoga (demo)', 'neuro@meutea.demo', 'neuropedagogo', 'ABPp 0000'],
  ['Carlos Psicólogo (demo)', 'psico@meutea.demo', 'psicologo', 'CRP 00/00000'],
  ['Daniela Fonoaudióloga (demo)', 'fono@meutea.demo', 'fonoaudiologo', 'CRFa 0-00000'],
  ['Eduardo Nutricionista (demo)', 'nutri@meutea.demo', 'nutricionista', 'CRN-0 00000'],
  ['Fernanda Terapeuta Ocupacional (demo)', 'to@meutea.demo', 'terapeuta_ocupacional', 'CREFITO 00000-TO'],
  ['Helena Psicopedagoga (demo)', 'psicoped@meutea.demo', 'psicopedagogo', 'ABPp 0001'],
  ['Igor Professor AEE (demo)', 'aee@meutea.demo', 'professor_aee', null],
];
const idsUsuario = {};
for (const [nome, email, perfil, reg] of usuarios) {
  const r = db.prepare(`INSERT INTO usuarios (nome, email, senha_hash, perfil, registro_profissional, trocar_senha) VALUES (?,?,?,?,?,0)`)
    .run(nome, email, hashSenha(SENHA), perfil, reg);
  idsUsuario[perfil] = Number(r.lastInsertRowid);
}

const nomes = ['Miguel', 'Arthur', 'Gael', 'Heitor', 'Theo', 'Davi', 'Gabriel', 'Bernardo', 'Samuel', 'João', 'Pedro', 'Lucas', 'Enzo', 'Rafael', 'Benício',
  'Helena', 'Alice', 'Laura', 'Maria', 'Valentina', 'Heloísa', 'Cecília', 'Sophia', 'Manuela', 'Júlia', 'Lívia', 'Isabela', 'Lorena', 'Clara', 'Beatriz'];
const sobrenomes = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Rodrigues', 'Ferreira', 'Alves', 'Pereira', 'Lima', 'Gomes', 'Costa', 'Ribeiro', 'Martins', 'Carvalho', 'Almeida', 'Lopes', 'Barbosa', 'Rocha'];
const bairros = [['Centro', 5], ['Jardim América', 4], ['Vila Nova', 4], ['São José', 3], ['Parque das Flores', 3], ['Santa Luzia', 2], ['Boa Vista', 2], ['Zona Rural', 1]];
const escolas = ['EM Monteiro Lobato', 'EM Cecília Meireles', 'EM Paulo Freire', 'EM Anísio Teixeira', 'CMEI Pequeno Príncipe', 'CMEI Sementinha',
  'EM Rui Barbosa', 'EM Castro Alves', 'EE Tiradentes', 'EM Clarice Lispector', 'EM Machado de Assis', 'CMEI Arco-Íris'];
const series = { 3: 'Maternal', 4: 'Pré I', 5: 'Pré II', 6: '1º ano', 7: '2º ano', 8: '3º ano', 9: '4º ano', 10: '5º ano', 11: '6º ano', 12: '7º ano', 13: '8º ano', 14: '9º ano', 15: '1º EM', 16: '2º EM', 17: '3º EM' };

const hoje = new Date();
const isoDias = (d) => { const x = new Date(hoje); x.setDate(x.getDate() - d); return x.toISOString().slice(0, 10); };
const [TEA, TDAH] = CONDICOES;

const TEXTOS = {
  neuropedagogo: ['Trabalhadas funções executivas com jogos de sequência e planejamento. Manteve atenção por períodos maiores que na sessão anterior.', 'Atividades de consciência fonológica com apoio visual. Demonstrou interesse e boa participação.'],
  psicologo: ['Sessão com foco em regulação emocional utilizando recursos visuais. Relatou situações de ansiedade na escola.', 'Orientação à família sobre rotina estruturada e antecipação de mudanças.'],
  fonoaudiologo: ['Estimulação de linguagem expressiva com comunicação alternativa (pranchas). Ampliou vocabulário funcional.', 'Trabalho de pragmática e turnos de conversa. Boa resposta a pistas visuais.'],
  nutricionista: ['Avaliação de seletividade alimentar. Aceita poucos alimentos de textura macia. Plano de exposição gradual iniciado.', 'Reavaliação antropométrica e revisão do diário alimentar com a família.'],
  terapeuta_ocupacional: ['Integração sensorial: atividades proprioceptivas e vestibulares. Melhor tolerância a estímulos táteis.', 'Treino de atividades de vida diária (vestir-se, higiene) com apoio de rotina visual.'],
  psicopedagogo: ['Intervenção em leitura e escrita com método multissensorial. Avanço na decodificação de sílabas complexas.', 'Estratégias de organização de material escolar e agenda.'],
  professor_aee: ['Elaboração do PEI com a professora regente. Definidas adaptações curriculares e de avaliação.', 'Atendimento na sala de recursos com atividades de comunicação e autonomia.'],
};

const insereAtend = db.prepare(`INSERT INTO acompanhamentos (crianca_id, profissional_id, especialidade, data, tipo, evolucao, objetivos_cifrado, descricao_cifrado, encaminhamentos_cifrado, sigiloso)
  VALUES (?,?,?,?,?,?,?,?,?,?)`);
const vincula = db.prepare('INSERT OR IGNORE INTO vinculos (crianca_id, usuario_id) VALUES (?, ?)');

db.transaction(() => {
  for (let i = 0; i < 186; i++) {
    const idade = Math.max(2, Math.min(17, Math.round(4 + rnd() * 9 + (rnd() - 0.5) * 6)));
    const nasc = new Date(hoje.getFullYear() - idade, Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 27));
    if (nasc > hoje) nasc.setFullYear(nasc.getFullYear() - 1);
    const principal = ponderado([[TEA, 52], [TDAH, 22], ['Dislexia', 7], ['Deficiência intelectual', 5], ['Síndrome de Down', 3], ['Altas habilidades / Superdotação', 3], ['Transtorno de linguagem', 4], ['TOD (Transtorno Opositivo Desafiador)', 2], ['Discalculia', 1], ['TDC / Dispraxia', 1]]);
    const conds = [principal];
    if (rnd() < 0.28) { const extra = ponderado([[TDAH, 5], ['Transtorno de processamento sensorial', 3], ['Transtorno de linguagem', 2], ['Dislexia', 1], [TEA, 1]]); if (!conds.includes(extra)) conds.push(extra); }
    const sexo = conds.includes(TEA) ? (rnd() < 0.76 ? 'M' : 'F') : (rnd() < 0.6 ? 'M' : 'F');
    const nome = `${escolher(nomes.filter((n, j) => (sexo === 'M' ? j < 15 : j >= 15)))} ${escolher(sobrenomes)} ${escolher(sobrenomes)}`;
    const dados = criancas.validar({
      nome, nascimento: nasc.toISOString().slice(0, 10), sexo, condicoes: conds,
      cid: conds.includes(TEA) ? 'F84.0' : conds.includes(TDAH) ? 'F90.0' : '',
      nivel_suporte: conds.includes(TEA) ? ponderado([['1', 50], ['2', 35], ['3', 15]]) : 'NA',
      laudo: ponderado([['sim', 68], ['em_avaliacao', 24], ['nao', 8]]),
      escola: idade < 6 ? escolher(escolas.filter((e) => e.startsWith('CMEI'))) : escolher(escolas.filter((e) => !e.startsWith('CMEI'))),
      serie: series[idade] || '', turno: escolher(['manha', 'tarde', 'manha', 'integral']), regiao: ponderado(bairros),
      aee: rnd() < 0.55, mediador: conds.includes(TEA) && rnd() < 0.4,
      responsavel: `${escolher(nomes.slice(15))} ${escolher(sobrenomes)} (fictício)`, telefone: `(00) 9${String(Math.floor(rnd() * 1e8)).padStart(8, '0')}`,
      consentimento: rnd() < 0.88, consentimento_data: isoDias(Math.floor(rnd() * 400)),
    }).dados;
    if (criancas.buscarPorIdentidade(dados.nome, dados.nascimento)) continue;
    const id = criancas.inserir(dados);

    // Equipe e histórico de atendimentos
    const equipe = new Set(['professor_aee']);
    if (conds.includes(TEA)) { equipe.add('fonoaudiologo'); equipe.add('terapeuta_ocupacional'); if (rnd() < 0.6) equipe.add('psicologo'); if (rnd() < 0.35) equipe.add('nutricionista'); }
    if (conds.some((c) => [TDAH, 'TOD (Transtorno Opositivo Desafiador)'].includes(c))) { equipe.add('psicologo'); equipe.add('neuropedagogo'); }
    if (conds.some((c) => ['Dislexia', 'Discalculia', 'Deficiência intelectual'].includes(c))) { equipe.add('psicopedagogo'); equipe.add('neuropedagogo'); }
    if (conds.includes('Síndrome de Down')) { equipe.add('fonoaudiologo'); equipe.add('nutricionista'); }
    if (conds.includes('Transtorno de linguagem')) equipe.add('fonoaudiologo');
    if (rnd() < 0.12) continue; // parte das crianças ainda sem equipe (fila de espera)

    for (const esp of equipe) {
      vincula.run(id, idsUsuario[esp]);
      const inicio = Math.floor(60 + rnd() * 360);
      const parou = rnd() < 0.15 ? Math.floor(95 + rnd() * 60) : 0;
      let d = inicio;
      let primeira = true;
      while (d > parou) {
        const tipo = primeira ? 'avaliacao' : ponderado([['sessao', 70], ['orientacao_familia', 10], ['reuniao_escola', 6], ['reavaliacao', 6], ['plano', 4], ['encaminhamento', 4]]);
        const evolucao = primeira ? 'nao_avaliado' : ponderado([['avancou', 45], ['manteve', 35], ['regrediu', 7], ['nao_avaliado', 13]]);
        const sig = esp === 'psicologo' && rnd() < 0.5 ? 1 : 0;
        insereAtend.run(id, idsUsuario[esp], esp, isoDias(d), tipo, evolucao,
          cifrar('Objetivos definidos no plano terapêutico individual.'), cifrar(escolher(TEXTOS[esp])),
          rnd() < 0.2 ? cifrar('Orientações entregues à família.') : null, sig);
        primeira = false;
        d -= Math.floor(esp === 'nutricionista' ? 45 + rnd() * 30 : 12 + rnd() * 25);
      }
    }
  }
})();

console.log(`Dados de demonstração criados (fictícios).
Usuários (senha: ${SENHA}):
${usuarios.map(([n, e, p]) => `  ${e.padEnd(24)} ${p}`).join('\n')}`);
