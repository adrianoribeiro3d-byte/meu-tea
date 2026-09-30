// Leitura das planilhas da Secretaria de Inclusão (.xlsx ou .csv) com mapeamento flexível de colunas.
const ExcelJS = require('exceljs');
const { normalizar } = require('./seguranca');
const { SINONIMOS_CONDICAO } = require('./dominio');
const criancas = require('./criancas');

// Campo do sistema -> nomes de coluna aceitos (já normalizados)
const COLUNAS = {
  nome: ['nome', 'nome da crianca', 'nome completo', 'crianca', 'aluno', 'aluno(a)', 'estudante', 'nome do aluno', 'nome do estudante'],
  nascimento: ['data de nascimento', 'nascimento', 'data nascimento', 'dt nasc', 'dt. nasc.', 'data nasc', 'dn'],
  sexo: ['sexo', 'genero'],
  condicoes: ['condicao', 'condicoes', 'diagnostico', 'diagnosticos', 'transtorno', 'neurodivergencia', 'hipotese diagnostica', 'deficiencia/transtorno'],
  cid: ['cid', 'cid-10', 'cid 10', 'cid-11', 'cid 11'],
  nivel_suporte: ['nivel de suporte', 'nivel', 'suporte', 'grau de suporte', 'nivel tea'],
  laudo: ['laudo', 'possui laudo', 'tem laudo', 'situacao do laudo'],
  escola: ['escola', 'unidade escolar', 'instituicao', 'unidade', 'escola/creche'],
  serie: ['serie', 'ano', 'ano escolar', 'turma', 'ano/serie', 'serie/ano', 'etapa'],
  turno: ['turno', 'periodo'],
  regiao: ['bairro', 'regiao', 'distrito', 'zona', 'localidade'],
  aee: ['aee', 'sala de recursos', 'atendimento educacional especializado'],
  mediador: ['mediador', 'profissional de apoio', 'acompanhante', 'cuidador', 'monitor'],
  responsavel: ['responsavel', 'nome do responsavel', 'responsavel legal', 'mae', 'nome da mae', 'pai/mae'],
  telefone: ['telefone', 'contato', 'celular', 'whatsapp', 'telefone do responsavel', 'fone'],
  observacoes: ['observacoes', 'observacao', 'obs', 'obs.'],
  consentimento: ['consentimento', 'termo de consentimento', 'autorizacao', 'termo assinado', 'consentimento lgpd'],
  consentimento_data: ['data do consentimento', 'data consentimento', 'data do termo'],
};

const ROTULOS = {
  nome: 'Nome', nascimento: 'Data de nascimento', sexo: 'Sexo', condicoes: 'Condição / diagnóstico', cid: 'CID',
  nivel_suporte: 'Nível de suporte', laudo: 'Laudo', escola: 'Escola', serie: 'Série / ano', turno: 'Turno',
  regiao: 'Bairro / região', aee: 'AEE', mediador: 'Mediador', responsavel: 'Responsável', telefone: 'Telefone',
  observacoes: 'Observações', consentimento: 'Consentimento', consentimento_data: 'Data do consentimento',
};

function mapearCabecalho(cabecalhos) {
  const mapa = {};
  cabecalhos.forEach((c, i) => {
    const n = normalizar(c).replace(/[:*]/g, '').trim();
    for (const [campo, nomes] of Object.entries(COLUNAS)) {
      if (!(campo in mapa) && nomes.includes(n)) { mapa[campo] = i; break; }
    }
  });
  return mapa;
}

function textoCelula(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return textoCelula(v.result);
    if (v.text) return String(v.text);
    return '';
  }
  return typeof v === 'number' ? v : String(v).trim();
}

function paraData(v) {
  if (!v && v !== 0) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') { // número de série do Excel
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    let ano = Number(m[3]);
    if (ano < 100) ano += ano > (new Date().getFullYear() % 100) ? 1900 : 2000;
    return `${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s;
}

const simNao = (v) => /^(s|sim|x|1|true|yes|verdadeiro|assinado|ok)$/.test(normalizar(v));

function paraSexo(v) {
  const n = normalizar(v);
  if (/^(f|fem|feminino|menina|mulher)/.test(n)) return 'F';
  if (/^(m|masc|masculino|menino|homem)/.test(n)) return 'M';
  return 'O';
}

function paraLaudo(v) {
  const n = normalizar(v);
  if (/avalia|investiga|aguard|processo/.test(n)) return 'em_avaliacao';
  if (/^(n|nao|sem)/.test(n)) return 'nao';
  if (simNao(n) || /^(sim|com)/.test(n)) return 'sim';
  return 'em_avaliacao';
}

function paraTurno(v) {
  const n = normalizar(v);
  if (/manh|matut/.test(n)) return 'manha';
  if (/tard|vesper/.test(n)) return 'tarde';
  if (/integr/.test(n)) return 'integral';
  if (/noit|notur/.test(n)) return 'noite';
  return null;
}

function paraCondicoes(v) {
  const reconhecidas = new Set();
  const desconhecidas = [];
  for (const parte of String(v || '').split(/[,;/+|\n]| e /)) {
    const n = normalizar(parte);
    if (!n) continue;
    const achou = SINONIMOS_CONDICAO.find(([re]) => re.test(n));
    if (achou) reconhecidas.add(achou[1]);
    else { reconhecidas.add('Outra'); desconhecidas.push(parte.trim()); }
  }
  return { condicoes: [...reconhecidas], desconhecidas };
}

function lerCsv(texto) {
  texto = texto.replace(/^﻿/, '');
  const primeira = texto.split(/\r?\n/, 1)[0];
  const sep = (primeira.match(/;/g) || []).length >= (primeira.match(/,/g) || []).length ? ';' : ',';
  const linhas = [];
  let linha = [], campo = '', aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') aspas = false;
      else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { linha.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo); linhas.push(linha); linha = []; campo = '';
    } else campo += ch;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

async function lerPlanilha(buffer, nomeArquivo) {
  if (/\.csv$/i.test(nomeArquivo)) return lerCsv(buffer.toString('utf8'));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
  if (!ws) return [];
  const linhas = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const valores = [];
    for (let c = 1; c <= ws.columnCount; c++) valores.push(textoCelula(row.getCell(c).value));
    linhas.push(valores);
  });
  return linhas;
}

/** Lê o arquivo e devolve a prévia da importação, sem gravar nada. */
async function preVisualizar(buffer, nomeArquivo) {
  const linhas = await lerPlanilha(buffer, nomeArquivo);
  // O cabeçalho é a primeira linha (entre as 10 primeiras) que contenha a coluna de nome
  let idxCab = linhas.slice(0, 10).findIndex((l) => 'nome' in mapearCabecalho(l.map(String)));
  if (idxCab < 0) {
    return { erro: 'Não encontramos a coluna de nome da criança. Use o modelo de planilha ou verifique o cabeçalho.' };
  }
  const cabecalho = linhas[idxCab].map(String);
  const mapa = mapearCabecalho(cabecalho);
  const ignoradas = cabecalho.filter((c, i) => c && !Object.values(mapa).includes(i));
  const faltando = ['nascimento', 'condicoes'].filter((c) => !(c in mapa)).map((c) => ROTULOS[c]);

  const registros = [];
  linhas.slice(idxCab + 1).forEach((l, i) => {
    const cel = (campo) => (campo in mapa ? l[mapa[campo]] : '');
    if (!String(cel('nome') || '').trim()) return;
    const { condicoes, desconhecidas } = paraCondicoes(cel('condicoes'));
    const nivel = String(cel('nivel_suporte') || '').match(/[123]/);
    const entrada = {
      nome: String(cel('nome')).replace(/\s+/g, ' '),
      nascimento: paraData(cel('nascimento')),
      sexo: paraSexo(cel('sexo')),
      condicoes,
      cid: cel('cid'),
      nivel_suporte: nivel ? nivel[0] : 'NA',
      laudo: paraLaudo(cel('laudo')),
      escola: cel('escola'),
      serie: String(cel('serie') || ''),
      turno: paraTurno(cel('turno')),
      regiao: cel('regiao'),
      aee: simNao(cel('aee')),
      mediador: simNao(cel('mediador')),
      responsavel: cel('responsavel'),
      telefone: String(cel('telefone') || ''),
      observacoes: cel('observacoes'),
      consentimento: simNao(cel('consentimento')),
      consentimento_data: paraData(cel('consentimento_data')),
    };
    const { dados, erros } = criancas.validar(entrada);
    const avisos = [];
    if (desconhecidas.length) avisos.push(`Condição não reconhecida, registrada como "Outra": ${desconhecidas.join(', ')}`);
    if (!dados.consentimento) avisos.push('Sem registro de consentimento do responsável.');
    const existente = !erros.length && criancas.buscarPorIdentidade(dados.nome, dados.nascimento);
    registros.push({ linha: idxCab + i + 2, dados, erros, avisos, acao: erros.length ? 'ignorar' : existente ? 'atualizar' : 'inserir', existenteId: existente?.id });
  });

  return {
    colunasReconhecidas: Object.keys(mapa).map((c) => `${ROTULOS[c]} ← “${cabecalho[mapa[c]]}”`),
    colunasIgnoradas: ignoradas,
    faltando,
    registros,
  };
}

module.exports = { preVisualizar, ROTULOS, COLUNAS };
