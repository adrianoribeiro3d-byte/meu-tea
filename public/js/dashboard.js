/* global Chart */
(function () {
  const bruto = document.getElementById('dados-dashboard');
  if (!bruto || !window.Chart) return;
  const est = JSON.parse(bruto.textContent);

  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const tema = () => ({
    tinta2: css('--tinta-2'), tinta3: css('--tinta-3'), grade: css('--grafico-grade'), eixo: css('--grafico-eixo'),
    superficie: css('--grafico-superficie'),
    serie: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => css('--s' + i)),
    ordinal: [1, 2, 3, 4, 5].map((i) => css('--ord-' + i)),
  });

  Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.animation = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 300 };

  const fmt = (n) => (n == null ? '< ' + (est.minGrupo || 3) : Number(n).toLocaleString('pt-BR'));
  const graficos = [];

  function base(t, { horizontal = false, empilhado = false, legenda = false } = {}) {
    const eixoValor = {
      beginAtZero: true, stacked: empilhado,
      grid: { color: t.grade, drawTicks: false }, border: { display: false },
      ticks: { color: t.tinta3, precision: 0, padding: 6, callback: (v) => Number(v).toLocaleString('pt-BR') },
    };
    const eixoCategoria = {
      stacked: empilhado, grid: { display: false }, border: { color: t.eixo },
      ticks: { color: t.tinta2, autoSkip: false, maxRotation: 0 },
    };
    return {
      responsive: true, maintainAspectRatio: false,
      indexAxis: horizontal ? 'y' : 'x',
      interaction: { mode: empilhado ? 'index' : 'nearest', intersect: !empilhado, axis: horizontal ? 'y' : 'x' },
      scales: horizontal ? { x: eixoValor, y: eixoCategoria } : { x: eixoCategoria, y: eixoValor },
      plugins: {
        legend: legenda ? {
          position: 'bottom', labels: { color: t.tinta2, boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3, padding: 14 },
        } : { display: false },
        tooltip: {
          backgroundColor: t.superficie, titleColor: css('--tinta'), bodyColor: t.tinta2, borderColor: t.eixo, borderWidth: 1,
          padding: 10, boxPadding: 4, usePointStyle: true,
          callbacks: { label: (c) => ` ${c.dataset.label ? c.dataset.label + ': ' : ''}${fmt(c.raw)}` },
        },
      },
    };
  }

  // Barras finas, cantos arredondados só na ponta, 2px de respiro entre marcas
  const barra = (cor, extra = {}) => ({
    backgroundColor: cor, hoverBackgroundColor: cor, borderRadius: { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 },
    borderSkipped: 'start', maxBarThickness: 24, borderColor: 'transparent', ...extra,
  });
  const barraH = (cor) => barra(cor, { borderRadius: { topRight: 4, bottomRight: 4, topLeft: 0, bottomLeft: 0 } });

  function criar(id, config) {
    const el = document.getElementById(id);
    if (!el) return;
    graficos.push({ el, config });
  }

  function desenhar() {
    const t = tema();
    graficos.forEach((g) => { if (g.chart) g.chart.destroy(); g.chart = new Chart(g.el, g.config(t)); });
  }

  const rotulos = (itens) => itens.map((i) => i.rotulo);
  const valores = (itens) => itens.map((i) => i.valor);

  // Condições: uma série só -> uma cor
  criar('g-condicao', (t) => ({
    type: 'bar',
    data: { labels: rotulos(est.porCondicao), datasets: [{ label: 'Crianças', data: valores(est.porCondicao), ...barraH(t.serie[0]) }] },
    options: base(t, { horizontal: true }),
  }));

  // Faixa etária: categorias ordenadas, uma série
  criar('g-faixa', (t) => ({
    type: 'bar',
    data: { labels: est.porFaixa.map((i) => i.rotulo.replace(' anos', '')), datasets: [{ label: 'Crianças', data: valores(est.porFaixa), ...barra(t.serie[0]) }] },
    options: (() => { const o = base(t); o.scales.x.title = { display: true, text: 'anos', color: t.tinta3 }; return o; })(),
  }));

  // Atendimentos mensais empilhados por especialidade (máx. 8 cores, na ordem fixa)
  criar('g-mensal', (t) => {
    const nomesMes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const labels = est.atendimentosMensais.meses.map((m) => `${nomesMes[Number(m.slice(5)) - 1]}/${m.slice(2, 4)}`);
    const n = est.atendimentosMensais.series.length;
    return {
      type: 'bar',
      data: {
        labels,
        datasets: est.atendimentosMensais.series.map((s, i) => ({
          label: s.rotulo, data: s.valores,
          ...barra(t.serie[i % 8], {
            borderColor: t.superficie, borderWidth: { top: 2, bottom: 0, left: 0, right: 0 },
            borderRadius: i === n - 1 ? { topLeft: 4, topRight: 4 } : 0, maxBarThickness: 28,
          }),
        })),
      },
      options: base(t, { empilhado: true, legenda: true }),
    };
  });

  criar('g-nivel', (t) => ({
    type: 'bar',
    data: {
      labels: est.porNivelTea.map((i) => (i.rotulo.startsWith('Nível') ? i.rotulo : 'Não informado')),
      datasets: [{ label: 'Crianças com TEA', data: valores(est.porNivelTea), ...barra([t.ordinal[1], t.ordinal[2], t.ordinal[4], css('--tinta-3')]) }],
    },
    options: base(t),
  }));

  criar('g-regiao', (t) => ({
    type: 'bar',
    data: { labels: rotulos(est.porRegiao), datasets: [{ label: 'Crianças', data: valores(est.porRegiao), ...barraH(t.serie[0]) }] },
    options: base(t, { horizontal: true }),
  }));

  criar('g-escola', (t) => ({
    type: 'bar',
    data: { labels: rotulos(est.porEscola), datasets: [{ label: 'Crianças', data: valores(est.porEscola), ...barraH(t.serie[0]) }] },
    options: base(t, { horizontal: true }),
  }));

  // Painel individual do profissional
  const nomesMes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  if (est.meuMensal) {
    criar('g-meu-mensal', (t) => ({
      type: 'bar',
      data: {
        labels: est.meuMensal.meses.map((m) => `${nomesMes[Number(m.slice(5)) - 1]}/${m.slice(2, 4)}`),
        datasets: [{ label: 'Meus atendimentos', data: est.meuMensal.valores, ...barra(t.serie[0]) }],
      },
      options: (() => { const o = base(t); o.scales.x.ticks.autoSkip = true; return o; })(),
    }));
  }
  if (est.minhasCondicoes) {
    criar('g-minhas-condicoes', (t) => ({
      type: 'bar',
      data: { labels: rotulos(est.minhasCondicoes), datasets: [{ label: 'Crianças', data: valores(est.minhasCondicoes), ...barraH(t.serie[0]) }] },
      options: base(t, { horizontal: true }),
    }));
  }

  desenhar();
  // Redesenha ao alternar tema claro/escuro do sistema
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', desenhar);
})();
