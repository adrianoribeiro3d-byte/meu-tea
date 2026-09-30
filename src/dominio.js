// Vocabulário do domínio: perfis, condições, especialidades e opções de cadastro.

const PERFIS = {
  admin: 'Administrador — Secretaria de Inclusão',
  gestor: 'Gestor (somente dados agregados)',
  neuropedagogo: 'Neuropedagogo(a)',
  psicopedagogo: 'Psicopedagogo(a)',
  psicologo: 'Psicólogo(a)',
  fonoaudiologo: 'Fonoaudiólogo(a)',
  nutricionista: 'Nutricionista',
  terapeuta_ocupacional: 'Terapeuta ocupacional',
  fisioterapeuta: 'Fisioterapeuta',
  medico: 'Médico(a)',
  assistente_social: 'Assistente social',
  professor_aee: 'Professor(a) de AEE',
  outro_profissional: 'Outro profissional',
};

// Perfis que realizam acompanhamento (a especialidade do registro = perfil do autor)
const ESPECIALIDADES = Object.fromEntries(
  Object.entries(PERFIS).filter(([k]) => !['admin', 'gestor'].includes(k)),
);

const ehProfissional = (perfil) => perfil in ESPECIALIDADES;

const CONDICOES = [
  'TEA (Transtorno do Espectro Autista)',
  'TDAH',
  'Dislexia',
  'Discalculia',
  'Disgrafia',
  'TOD (Transtorno Opositivo Desafiador)',
  'Deficiência intelectual',
  'Altas habilidades / Superdotação',
  'Síndrome de Down',
  'TDC / Dispraxia',
  'Transtorno de linguagem',
  'Transtorno de processamento sensorial',
  'Síndrome de Tourette',
  'Outra',
];

// Rótulos curtos para gráficos e sinônimos aceitos nas planilhas
const CONDICAO_CURTA = {
  'TEA (Transtorno do Espectro Autista)': 'TEA',
  'TOD (Transtorno Opositivo Desafiador)': 'TOD',
  'Altas habilidades / Superdotação': 'Altas habilidades',
  'Transtorno de processamento sensorial': 'Proc. sensorial',
};
const SINONIMOS_CONDICAO = [
  [/autis|\btea\b|espectro|asperger/, 'TEA (Transtorno do Espectro Autista)'],
  [/tdah|deficit de atencao|hiperativ/, 'TDAH'],
  [/dislexi/, 'Dislexia'],
  [/discalculi/, 'Discalculia'],
  [/disgrafi|disortograf/, 'Disgrafia'],
  [/\btod\b|opositor/, 'TOD (Transtorno Opositivo Desafiador)'],
  [/deficiencia intelectual|\bdi\b|retardo mental/, 'Deficiência intelectual'],
  [/altas habilidades|superdota|\bah\/?sd\b/, 'Altas habilidades / Superdotação'],
  [/down|trissomia/, 'Síndrome de Down'],
  [/dispraxi|\btdc\b|coordenacao/, 'TDC / Dispraxia'],
  [/linguagem|\btdl\b|fala/, 'Transtorno de linguagem'],
  [/sensorial/, 'Transtorno de processamento sensorial'],
  [/tourette|tique/, 'Síndrome de Tourette'],
];

const SEXOS = { F: 'Feminino', M: 'Masculino', O: 'Outro / não informado' };
const NIVEIS_SUPORTE = { '1': 'Nível 1', '2': 'Nível 2', '3': 'Nível 3', NA: 'Não se aplica / não informado' };
const LAUDO = { sim: 'Com laudo', em_avaliacao: 'Em avaliação', nao: 'Sem laudo' };
const TURNOS = { manha: 'Manhã', tarde: 'Tarde', integral: 'Integral', noite: 'Noite' };

const TIPOS_ATENDIMENTO = {
  avaliacao: 'Avaliação inicial',
  sessao: 'Sessão / atendimento',
  reavaliacao: 'Reavaliação',
  orientacao_familia: 'Orientação à família',
  reuniao_escola: 'Reunião com a escola',
  encaminhamento: 'Encaminhamento',
  plano: 'Plano terapêutico / PEI',
};

const EVOLUCAO = {
  avancou: 'Avançou',
  manteve: 'Manteve',
  regrediu: 'Regrediu',
  nao_avaliado: 'Não avaliado',
};

const FAIXAS_ETARIAS = [
  ['0–3 anos', 0, 3],
  ['4–5 anos', 4, 5],
  ['6–8 anos', 6, 8],
  ['9–11 anos', 9, 11],
  ['12–14 anos', 12, 14],
  ['15–17 anos', 15, 17],
  ['18+ anos', 18, 200],
];

module.exports = {
  PERFIS, ESPECIALIDADES, ehProfissional, CONDICOES, CONDICAO_CURTA, SINONIMOS_CONDICAO,
  SEXOS, NIVEIS_SUPORTE, LAUDO, TURNOS, TIPOS_ATENDIMENTO, EVOLUCAO, FAIXAS_ETARIAS,
};
