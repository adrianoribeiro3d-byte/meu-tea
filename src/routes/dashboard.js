const express = require('express');
const estatisticas = require('../estatisticas');
const auth = require('../auth');
const painel = require('../painel');
const { ehProfissional } = require('../dominio');

const r = express.Router();

function lerFiltro(q) {
  const opcoes = estatisticas.opcoesFiltro();
  const f = {};
  if (opcoes.condicoes.includes(q.condicao)) f.condicao = q.condicao;
  if (opcoes.regioes.includes(q.regiao)) f.regiao = q.regiao;
  if (opcoes.faixas.includes(q.faixa)) f.faixa = q.faixa;
  if (q.sexo in opcoes.sexos) f.sexo = q.sexo;
  return { f, opcoes };
}

// Página inicial: profissional vê o próprio painel; Secretaria e gestores veem o panorama geral
r.get('/', (req, res) => {
  if (ehProfissional(req.usuario.perfil)) {
    auth.auditar(req, 'visualizou_painel');
    return res.render('painel', { p: painel.calcular(req.usuario.id) });
  }
  const { f, opcoes } = lerFiltro(req.query);
  res.render('dashboard', { est: estatisticas.calcular(f), filtro: f, opcoes, base: '/' });
});

// Panorama geral da rede (somente dados agregados e anônimos)
r.get('/panorama', (req, res) => {
  const { f, opcoes } = lerFiltro(req.query);
  res.render('dashboard', { est: estatisticas.calcular(f), filtro: f, opcoes, base: '/panorama' });
});

// Exportação somente dos dados agregados (já anonimizados)
r.get('/dashboard.csv', (req, res) => {
  const { f } = lerFiltro(req.query);
  const est = estatisticas.calcular(f);
  auth.auditar(req, 'exportou_agregados', { detalhes: f });
  const linhas = [['Indicador', 'Categoria', 'Valor']];
  if (est.suprimido) linhas.push(['Aviso', 'Filtro com menos crianças que o mínimo', `< ${est.minGrupo}`]);
  else {
    Object.entries(est.kpis).forEach(([k, v]) => linhas.push(['Resumo', k, v]));
    const blocos = { porCondicao: 'Condição', porFaixa: 'Faixa etária', porSexo: 'Sexo', porNivelTea: 'Nível de suporte (TEA)', porLaudo: 'Laudo', porRegiao: 'Região', porEscola: 'Escola', porTipo: 'Tipo de atendimento (12m)' };
    for (const [k, nome] of Object.entries(blocos)) {
      est[k].forEach((i) => linhas.push([nome, i.rotulo, i.oculto ? `< ${est.minGrupo}` : i.valor]));
    }
    est.cobertura.forEach((c) => linhas.push(['Cobertura por especialidade (%)', c.rotulo, c.valor]));
    est.atendimentosMensais.series.forEach((s) => s.valores.forEach((v, i) => linhas.push([`Atendimentos ${est.atendimentosMensais.meses[i]}`, s.rotulo, v])));
  }
  const csv = linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="meu-tea-indicadores.csv"');
  res.send('﻿' + csv);
});

module.exports = r;
