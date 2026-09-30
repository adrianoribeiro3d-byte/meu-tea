// Estatísticas agregadas e anonimizadas para o dashboard.
// Nenhum dado identificável sai daqui: apenas contagens, com supressão de grupos pequenos.
const db = require('./db');
const { minGrupo } = require('./config');
const {
  CONDICAO_CURTA, SEXOS, NIVEIS_SUPORTE, LAUDO, ESPECIALIDADES, EVOLUCAO, FAIXAS_ETARIAS, TIPOS_ATENDIMENTO,
} = require('./dominio');
const { idadeDe } = require('./criancas');

const curta = (c) => CONDICAO_CURTA[c] || c;
const faixaDe = (idade) => (idade == null ? null : FAIXAS_ETARIAS.find(([, a, b]) => idade >= a && idade <= b)?.[0]);
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

function contar(itens, chave) {
  const m = new Map();
  for (const it of itens) for (const k of [].concat(chave(it))) if (k != null && k !== '') m.set(k, (m.get(k) || 0) + 1);
  return m;
}

/** Categorias nominais: ordena por tamanho e junta grupos menores que o limite em "Outros". */
function nominal(mapa, { max = 10, rotulo = (k) => k } = {}) {
  let outros = 0;
  const itens = [];
  for (const [k, v] of [...mapa].sort((a, b) => b[1] - a[1])) {
    if ((minGrupo && v < minGrupo) || itens.length >= max) outros += v;
    else itens.push({ rotulo: rotulo(k), valor: v });
  }
  if (outros) itens.push({ rotulo: minGrupo ? `Outros / grupos pequenos` : 'Outros', valor: outros, agrupado: true });
  return itens;
}

/** Categorias ordenadas (faixas etárias, níveis): mantém a ordem e oculta valores abaixo do limite. */
function ordinal(mapa, chaves, rotulo = (k) => k) {
  return chaves.map((k) => {
    const v = mapa.get(k) || 0;
    const oculto = minGrupo && v > 0 && v < minGrupo;
    return { rotulo: rotulo(k), valor: oculto ? null : v, oculto };
  });
}

function opcoesFiltro() {
  const linhas = db.prepare('SELECT condicoes, regiao FROM criancas').all();
  const condicoes = new Set();
  const regioes = new Map();
  for (const l of linhas) {
    JSON.parse(l.condicoes).forEach((c) => condicoes.add(c));
    if (l.regiao) regioes.set(l.regiao, (regioes.get(l.regiao) || 0) + 1);
  }
  return {
    condicoes: [...condicoes].sort(),
    // Só oferece regiões com crianças suficientes para não expor grupos pequenos
    regioes: [...regioes].filter(([, n]) => n >= minGrupo).map(([r]) => r).sort(),
    faixas: FAIXAS_ETARIAS.map(([f]) => f),
    sexos: SEXOS,
  };
}

function calcular(filtro = {}) {
  const hoje = new Date();
  let base = db.prepare('SELECT * FROM criancas').all().map((c) => ({
    ...c,
    condicoes: JSON.parse(c.condicoes),
    idade: idadeDe(c.nascimento_ym, hoje),
  }));
  base = base.map((c) => ({ ...c, faixa: faixaDe(c.idade) }));
  if (filtro.condicao) base = base.filter((c) => c.condicoes.includes(filtro.condicao));
  if (filtro.regiao) base = base.filter((c) => c.regiao === filtro.regiao);
  if (filtro.faixa) base = base.filter((c) => c.faixa === filtro.faixa);
  if (filtro.sexo) base = base.filter((c) => c.sexo === filtro.sexo);

  const total = base.length;
  if (minGrupo && total > 0 && total < minGrupo) {
    return { total, suprimido: true, minGrupo };
  }

  const ids = new Set(base.map((c) => c.id));
  const doze = new Date(hoje); doze.setMonth(doze.getMonth() - 11, 1);
  const inicio12m = doze.toISOString().slice(0, 7) + '-01';
  const atend = db.prepare('SELECT crianca_id, especialidade, data, tipo, evolucao FROM acompanhamentos WHERE data >= ? ORDER BY data')
    .all(inicio12m).filter((a) => ids.has(a.crianca_id));

  const dias = (n) => { const d = new Date(hoje); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  const ultimoAtend = new Map(
    db.prepare('SELECT crianca_id, MAX(data) AS ultima FROM acompanhamentos GROUP BY crianca_id').all().map((r) => [r.crianca_id, r.ultima]),
  );
  const semAcompanhamento90 = base.filter((c) => !c.anonimizada && (ultimoAtend.get(c.id) || '') < dias(90)).length;

  // Série mensal por especialidade (as 7 mais frequentes + "Outras")
  const meses = [];
  for (let i = 0; i < 12; i++) { const d = new Date(doze); d.setMonth(doze.getMonth() + i); meses.push(d.toISOString().slice(0, 7)); }
  const porEsp = contar(atend, (a) => a.especialidade);
  const principais = [...porEsp].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([k]) => k);
  const series = principais.map((esp) => ({
    rotulo: ESPECIALIDADES[esp] || esp,
    chave: esp,
    valores: meses.map((m) => atend.filter((a) => a.especialidade === esp && a.data.startsWith(m)).length),
  }));
  const restantes = atend.filter((a) => !principais.includes(a.especialidade));
  if (restantes.length) {
    series.push({ rotulo: 'Outras especialidades', chave: 'outras', valores: meses.map((m) => restantes.filter((a) => a.data.startsWith(m)).length) });
  }

  // Cobertura: % das crianças atendidas por cada especialidade nos últimos 12 meses
  const atendidasPorEsp = new Map();
  for (const a of atend) {
    if (!atendidasPorEsp.has(a.especialidade)) atendidasPorEsp.set(a.especialidade, new Set());
    atendidasPorEsp.get(a.especialidade).add(a.crianca_id);
  }
  const cobertura = [...atendidasPorEsp]
    .map(([esp, s]) => ({ rotulo: ESPECIALIDADES[esp] || esp, valor: pct(s.size, total), criancas: s.size }))
    .filter((c) => !minGrupo || c.criancas >= minGrupo)
    .sort((a, b) => b.valor - a.valor);

  const avaliados = atend.filter((a) => a.data >= dias(180) && a.evolucao !== 'nao_avaliado');
  const evolucao = ['avancou', 'manteve', 'regrediu'].map((k) => {
    const n = avaliados.filter((a) => a.evolucao === k).length;
    return { chave: k, rotulo: EVOLUCAO[k], valor: n, pct: pct(n, avaliados.length) };
  });

  const tea = base.filter((c) => c.condicoes.includes('TEA (Transtorno do Espectro Autista)'));

  return {
    total,
    minGrupo,
    kpis: {
      total,
      comLaudo: base.filter((c) => c.laudo === 'sim').length,
      emAvaliacao: base.filter((c) => c.laudo === 'em_avaliacao').length,
      comorbidade: base.filter((c) => c.condicoes.length > 1).length,
      aee: base.filter((c) => c.aee).length,
      mediador: base.filter((c) => c.mediador).length,
      semConsentimento: base.filter((c) => !c.consentimento && !c.anonimizada).length,
      atendimentos30d: atend.filter((a) => a.data >= dias(30)).length,
      semAcompanhamento90,
      idadeMedia: total ? Math.round((base.reduce((s, c) => s + (c.idade || 0), 0) / total) * 10) / 10 : 0,
    },
    porCondicao: nominal(contar(base, (c) => c.condicoes), { max: 12, rotulo: curta }),
    porFaixa: ordinal(contar(base, (c) => c.faixa), FAIXAS_ETARIAS.map(([f]) => f)),
    porSexo: ordinal(contar(base, (c) => c.sexo), Object.keys(SEXOS), (k) => SEXOS[k]),
    porNivelTea: ordinal(contar(tea, (c) => c.nivel_suporte), Object.keys(NIVEIS_SUPORTE), (k) => NIVEIS_SUPORTE[k]),
    porLaudo: ordinal(contar(base, (c) => c.laudo), Object.keys(LAUDO), (k) => LAUDO[k]),
    porRegiao: nominal(contar(base, (c) => c.regiao || 'Não informado'), { max: 10 }),
    porEscola: nominal(contar(base, (c) => c.escola || 'Não informada'), { max: 10 }),
    atendimentosMensais: { meses, series },
    porTipo: nominal(contar(atend, (a) => a.tipo), { rotulo: (k) => TIPOS_ATENDIMENTO[k] || k }),
    cobertura,
    evolucao,
    totalAvaliados: avaliados.length,
  };
}

module.exports = { calcular, opcoesFiltro };
