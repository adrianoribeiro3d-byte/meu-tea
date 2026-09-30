// Acesso aos cadastros de crianças: gravação cifrada e leitura decifrada.
const db = require('./db');
const { cifrar, decifrar, indiceCego } = require('./seguranca');
const { CONDICOES, SEXOS, NIVEIS_SUPORTE, LAUDO, TURNOS } = require('./dominio');

function idadeDe(nascimentoYm, ref = new Date()) {
  if (!nascimentoYm) return null;
  const [a, m] = nascimentoYm.split('-').map(Number);
  let idade = ref.getFullYear() - a;
  if (ref.getMonth() + 1 < m) idade -= 1;
  return idade;
}

/** Aceita somente AAAA-MM-DD existente no calendário (rejeita 31/02, por exemplo). */
function dataValida(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return false;
  const d = new Date(iso + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso && d.getUTCFullYear() >= 1900;
}

function proximoCodigo() {
  const ultimo = db.prepare(`SELECT codigo FROM criancas ORDER BY id DESC LIMIT 1`).get();
  const n = ultimo ? Number(ultimo.codigo.replace(/\D/g, '')) + 1 : 1;
  return `MT-${String(n).padStart(5, '0')}`;
}

/** Valida e normaliza os dados vindos de formulário ou planilha. Retorna { dados, erros }. */
function validar(entrada) {
  const erros = [];
  const nome = String(entrada.nome || '').trim();
  const nascimento = String(entrada.nascimento || '').trim();
  if (nome.length < 3) erros.push('Nome é obrigatório.');
  if (!dataValida(nascimento)) erros.push('Data de nascimento inválida.');
  else if (new Date(nascimento) > new Date()) erros.push('Data de nascimento no futuro.');

  let condicoes = entrada.condicoes || [];
  if (!Array.isArray(condicoes)) condicoes = [condicoes];
  condicoes = [...new Set(condicoes.filter((c) => CONDICOES.includes(c)))];
  if (!condicoes.length) erros.push('Informe ao menos uma condição.');

  const opcao = (valor, lista, padrao) => (valor in lista ? valor : padrao);
  return {
    erros,
    dados: {
      nome,
      nascimento,
      sexo: opcao(entrada.sexo, SEXOS, 'O'),
      condicoes,
      cid: String(entrada.cid || '').trim().toUpperCase().slice(0, 40) || null,
      nivel_suporte: opcao(String(entrada.nivel_suporte || ''), NIVEIS_SUPORTE, 'NA'),
      laudo: opcao(entrada.laudo, LAUDO, 'em_avaliacao'),
      escola: String(entrada.escola || '').trim().slice(0, 120) || null,
      serie: String(entrada.serie || '').trim().slice(0, 40) || null,
      turno: opcao(entrada.turno, TURNOS, null),
      regiao: String(entrada.regiao || '').trim().slice(0, 80) || null,
      aee: entrada.aee ? 1 : 0,
      mediador: entrada.mediador ? 1 : 0,
      responsavel: String(entrada.responsavel || '').trim().slice(0, 120),
      telefone: String(entrada.telefone || '').trim().slice(0, 30),
      observacoes: String(entrada.observacoes || '').trim().slice(0, 4000),
      consentimento: entrada.consentimento ? 1 : 0,
      consentimento_data: dataValida(entrada.consentimento_data) ? entrada.consentimento_data : null,
    },
  };
}

function colunas(d) {
  return {
    nome_cifrado: cifrar(d.nome),
    indice_identidade: indiceCego(d.nome, d.nascimento),
    nascimento_cifrado: cifrar(d.nascimento),
    nascimento_ym: d.nascimento.slice(0, 7),
    sexo: d.sexo,
    condicoes: JSON.stringify(d.condicoes),
    cid: d.cid,
    nivel_suporte: d.nivel_suporte,
    laudo: d.laudo,
    escola: d.escola,
    serie: d.serie,
    turno: d.turno,
    regiao: d.regiao,
    aee: d.aee,
    mediador: d.mediador,
    responsavel_cifrado: cifrar(d.responsavel),
    telefone_cifrado: cifrar(d.telefone),
    observacoes_cifrado: cifrar(d.observacoes),
    consentimento: d.consentimento,
    consentimento_data: d.consentimento ? (d.consentimento_data || new Date().toISOString().slice(0, 10)) : null,
  };
}

function inserir(d, importacaoId = null) {
  const c = { ...colunas(d), codigo: proximoCodigo(), importacao_id: importacaoId };
  const campos = Object.keys(c);
  const r = db.prepare(`INSERT INTO criancas (${campos.join(',')}) VALUES (${campos.map((k) => '@' + k).join(',')})`).run(c);
  return Number(r.lastInsertRowid);
}

function atualizar(id, d) {
  const c = colunas(d);
  const sets = Object.keys(c).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE criancas SET ${sets}, atualizado_em = datetime('now') WHERE id = @id`).run({ ...c, id });
}

function buscarPorIdentidade(nome, nascimento) {
  return db.prepare('SELECT id FROM criancas WHERE indice_identidade = ?').get(indiceCego(nome, nascimento));
}

/** Converte a linha do banco para exibição (decifra os dados pessoais). */
function paraExibicao(linha) {
  if (!linha) return null;
  return {
    ...linha,
    nome: linha.anonimizada ? `(anonimizada) ${linha.codigo}` : decifrar(linha.nome_cifrado),
    nascimento: decifrar(linha.nascimento_cifrado),
    responsavel: decifrar(linha.responsavel_cifrado),
    telefone: decifrar(linha.telefone_cifrado),
    observacoes: decifrar(linha.observacoes_cifrado),
    condicoes: JSON.parse(linha.condicoes || '[]'),
    idade: idadeDe(linha.nascimento_ym),
  };
}

function obter(id) {
  return paraExibicao(db.prepare('SELECT * FROM criancas WHERE id = ?').get(id));
}

/** Anonimização (LGPD art. 16/18): remove identificação e mantém apenas dados estatísticos. */
function anonimizar(id) {
  db.prepare(`UPDATE criancas SET nome_cifrado = NULL, indice_identidade = NULL, nascimento_cifrado = NULL,
    responsavel_cifrado = NULL, telefone_cifrado = NULL, observacoes_cifrado = NULL, cid = NULL,
    anonimizada = 1, ativo = 0, atualizado_em = datetime('now') WHERE id = ?`).run(id);
  db.prepare(`UPDATE acompanhamentos SET objetivos_cifrado = NULL, descricao_cifrado = NULL,
    encaminhamentos_cifrado = NULL WHERE crianca_id = ?`).run(id);
  db.prepare('DELETE FROM vinculos WHERE crianca_id = ?').run(id);
}

module.exports = { dataValida, idadeDe, validar, inserir, atualizar, buscarPorIdentidade, paraExibicao, obter, anonimizar };
