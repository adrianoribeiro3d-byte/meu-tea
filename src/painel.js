// Painel individual do profissional: somente as crianças vinculadas a ele e os atendimentos que ele registrou.
const db = require('./db');
const criancas = require('./criancas');
const { CONDICAO_CURTA, TIPOS_ATENDIMENTO, EVOLUCAO } = require('./dominio');

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const hojeIso = () => new Date().toISOString().slice(0, 10);
const diasAtras = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const diasEntre = (iso) => Math.floor((Date.parse(hojeIso()) - Date.parse(iso)) / 86400000);

function calcular(usuarioId) {
  const minhas = db.prepare(`SELECT c.* FROM criancas c JOIN vinculos v ON v.crianca_id = c.id
                             WHERE v.usuario_id = ? AND c.anonimizada = 0`).all(usuarioId).map(criancas.paraExibicao);
  const ids = new Set(minhas.map((c) => c.id));

  const doze = new Date(); doze.setMonth(doze.getMonth() - 11, 1);
  const meses = [];
  for (let i = 0; i < 12; i++) { const d = new Date(doze); d.setMonth(doze.getMonth() + i); meses.push(d.toISOString().slice(0, 7)); }

  // Apenas os registros do próprio profissional
  const meus = db.prepare(`SELECT id, crianca_id, data, tipo, evolucao FROM acompanhamentos
                           WHERE profissional_id = ? ORDER BY data DESC, id DESC`).all(usuarioId);
  const ultimoPorCrianca = new Map();
  const totalPorCrianca = new Map();
  for (const a of meus) {
    if (!ultimoPorCrianca.has(a.crianca_id)) ultimoPorCrianca.set(a.crianca_id, a.data);
    totalPorCrianca.set(a.crianca_id, (totalPorCrianca.get(a.crianca_id) || 0) + 1);
  }

  const mesAtual = hojeIso().slice(0, 7);
  const semAvaliacao = minhas.filter((c) => !ultimoPorCrianca.has(c.id));
  const atrasadas = minhas
    .filter((c) => ultimoPorCrianca.has(c.id) && ultimoPorCrianca.get(c.id) < diasAtras(30))
    .map((c) => ({ ...c, ultima: ultimoPorCrianca.get(c.id), dias: diasEntre(ultimoPorCrianca.get(c.id)) }))
    .sort((a, b) => b.dias - a.dias);

  const avaliados = meus.filter((a) => a.data >= diasAtras(180) && a.evolucao !== 'nao_avaliado');
  const condicoes = new Map();
  minhas.forEach((c) => c.condicoes.forEach((x) => condicoes.set(x, (condicoes.get(x) || 0) + 1)));
  const ultimos12 = meus.filter((a) => a.data >= meses[0] + '-01');
  const tipos = new Map();
  ultimos12.forEach((a) => tipos.set(a.tipo, (tipos.get(a.tipo) || 0) + 1));

  const nomes = new Map(minhas.map((c) => [c.id, c]));
  return {
    kpis: {
      criancas: minhas.length,
      atendimentosMes: meus.filter((a) => a.data.startsWith(mesAtual)).length,
      atendimentos30d: meus.filter((a) => a.data >= diasAtras(30)).length,
      atrasadas: atrasadas.length,
      semAvaliacao: semAvaliacao.length,
      semConsentimento: minhas.filter((c) => !c.consentimento).length,
    },
    atencao: [
      ...semAvaliacao.map((c) => ({ ...c, motivo: 'Sem avaliação inicial', dias: null })),
      ...atrasadas.map((c) => ({ ...c, motivo: `Último atendimento há ${c.dias} dias` })),
    ],
    mensal: { meses, valores: meses.map((m) => meus.filter((a) => a.data.startsWith(m)).length) },
    evolucao: ['avancou', 'manteve', 'regrediu'].map((k) => {
      const n = avaliados.filter((a) => a.evolucao === k).length;
      return { chave: k, rotulo: EVOLUCAO[k], valor: n, pct: pct(n, avaliados.length) };
    }),
    totalAvaliados: avaliados.length,
    porCondicao: [...condicoes].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ rotulo: CONDICAO_CURTA[k] || k, valor: v })),
    porTipo: [...tipos].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ rotulo: TIPOS_ATENDIMENTO[k] || k, valor: v, pct: pct(v, ultimos12.length) })),
    recentes: meus.filter((a) => ids.has(a.crianca_id)).slice(0, 8).map((a) => ({ ...a, crianca: nomes.get(a.crianca_id) })),
    atendidas12m: new Set(ultimos12.map((a) => a.crianca_id)).size,
    totalPorCrianca,
  };
}

module.exports = { calcular };
