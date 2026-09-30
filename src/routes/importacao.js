const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const db = require('../db');
const auth = require('../auth');
const criancas = require('../criancas');
const importador = require('../importador');
const { token } = require('../seguranca');
const { CONDICOES } = require('../dominio');

const r = express.Router();
r.use(auth.exigir('importar'));

const upload = multer({
  storage: multer.memoryStorage(), // o arquivo nunca é gravado em disco
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, f, cb) => cb(null, /\.(xlsx|csv)$/i.test(f.originalname)),
});

// Prévias aguardando confirmação (em memória, expiram em 30 minutos)
const pendentes = new Map();
const EXPIRA_MS = 30 * 60 * 1000;
function limparPendentes() {
  const agora = Date.now();
  for (const [k, v] of pendentes) if (agora - v.criadoEm > EXPIRA_MS) pendentes.delete(k);
}

const historicoImportacoes = () => db.prepare(`SELECT i.*, u.nome AS usuario_nome FROM importacoes i
  JOIN usuarios u ON u.id = i.usuario_id ORDER BY i.id DESC LIMIT 20`).all();

r.get('/', (req, res) => {
  const ok = req.query.ok ? db.prepare('SELECT * FROM importacoes WHERE id = ?').get(Number(req.query.ok)) : null;
  res.render('importar', { historico: historicoImportacoes(), erro: null, previa: null, ok });
});

r.post('/', (req, res, next) => {
  // O token CSRF chega no corpo multipart, então a verificação acontece após o upload
  upload.single('planilha')(req, res, async (err) => {
    try {
      if (req.body?._csrf !== req.csrf) return res.status(403).render('erro', { titulo: 'Requisição recusada', mensagem: 'Token de segurança inválido.' });
      const historico = historicoImportacoes();
      if (err) return res.status(400).render('importar', { historico, ok: null, previa: null, erro: err.code === 'LIMIT_FILE_SIZE' ? 'Arquivo maior que 10 MB.' : 'Falha no envio do arquivo.' });
      if (!req.file) return res.status(400).render('importar', { historico, ok: null, previa: null, erro: 'Envie um arquivo .xlsx ou .csv.' });

      let previa;
      try {
        previa = await importador.preVisualizar(req.file.buffer, req.file.originalname);
      } catch (e) {
        return res.status(400).render('importar', { historico, ok: null, previa: null, erro: 'Não foi possível ler a planilha. Verifique se o arquivo é .xlsx ou .csv válido.' });
      }
      if (previa.erro) return res.status(400).render('importar', { historico, ok: null, previa: null, erro: previa.erro });

      limparPendentes();
      const chave = token(16);
      pendentes.set(chave, { usuarioId: req.usuario.id, arquivo: req.file.originalname.slice(0, 200), registros: previa.registros, criadoEm: Date.now() });
      auth.auditar(req, 'importacao_previa', { detalhes: { arquivo: req.file.originalname, linhas: previa.registros.length } });
      res.render('importar', { historico, ok: null, erro: null, previa: { ...previa, chave, arquivo: req.file.originalname } });
    } catch (e) { next(e); }
  });
});

r.post('/confirmar', (req, res) => {
  const p = pendentes.get(req.body.chave);
  if (!p || p.usuarioId !== req.usuario.id) {
    return res.status(400).render('erro', { titulo: 'Importação expirada', mensagem: 'A prévia expirou ou não pertence a você. Envie a planilha novamente.' });
  }
  pendentes.delete(req.body.chave);

  const resultado = db.transaction(() => {
    const imp = db.prepare('INSERT INTO importacoes (usuario_id, arquivo) VALUES (?, ?)').run(req.usuario.id, p.arquivo);
    const impId = Number(imp.lastInsertRowid);
    let inseridas = 0, atualizadas = 0, ignoradas = 0;
    for (const reg of p.registros) {
      if (reg.erros.length) { ignoradas++; continue; }
      // Reconsulta: a mesma criança pode aparecer duas vezes na planilha
      const existente = criancas.buscarPorIdentidade(reg.dados.nome, reg.dados.nascimento);
      if (existente) { criancas.atualizar(existente.id, reg.dados); atualizadas++; }
      else { criancas.inserir(reg.dados, impId); inseridas++; }
    }
    db.prepare('UPDATE importacoes SET total = ?, inseridas = ?, atualizadas = ?, ignoradas = ? WHERE id = ?')
      .run(p.registros.length, inseridas, atualizadas, ignoradas, impId);
    return { impId, inseridas, atualizadas, ignoradas };
  })();

  auth.auditar(req, 'importacao_concluida', { entidade: 'importacao', entidadeId: resultado.impId, detalhes: { arquivo: p.arquivo, ...resultado } });
  res.redirect('/importar?ok=' + resultado.impId);
});

r.get('/modelo.xlsx', async (req, res) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Meu TEA';
  const ws = wb.addWorksheet('Crianças');
  const cab = ['Nome da criança', 'Data de nascimento', 'Sexo', 'Condição', 'CID', 'Nível de suporte', 'Laudo', 'Escola',
    'Série/Ano', 'Turno', 'Bairro', 'AEE', 'Mediador', 'Responsável', 'Telefone', 'Consentimento', 'Data do consentimento', 'Observações'];
  ws.addRow(cab);
  ws.addRow(['Exemplo Fictício da Silva', '15/03/2018', 'M', 'TEA; TDAH', 'F84.0', '1', 'Sim', 'EM Exemplo', '2º ano', 'Manhã',
    'Centro', 'Sim', 'Não', 'Responsável Fictício', '(00) 00000-0000', 'Sim', '10/02/2026', 'Apagar esta linha de exemplo']);
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((c) => { c.width = 20; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const inst = wb.addWorksheet('Instruções');
  [
    ['Como preencher'],
    ['• Uma criança por linha. A primeira linha deve conter os títulos das colunas.'],
    ['• Obrigatórios: Nome da criança, Data de nascimento (dd/mm/aaaa) e Condição.'],
    ['• Condição: separe várias por ponto e vírgula. Aceitas: ' + CONDICOES.join(', ') + '.'],
    ['• Nível de suporte (TEA): 1, 2 ou 3. Laudo: Sim, Não ou Em avaliação. AEE / Mediador / Consentimento: Sim ou Não.'],
    ['• Nome + data de nascimento identificam a criança: reenviar a planilha atualiza o cadastro existente.'],
    [''],
    ['Proteção de dados (LGPD)'],
    ['• Este arquivo contém dados pessoais sensíveis de crianças. Não envie por e-mail ou aplicativos de mensagem.'],
    ['• Após a importação no Meu TEA, apague as cópias locais da planilha.'],
  ].forEach((l) => inst.addRow(l));
  inst.getColumn(1).width = 120;
  inst.getRow(1).font = { bold: true };
  inst.getRow(8).font = { bold: true };

  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', 'attachment; filename="modelo-planilha-meu-tea.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});

module.exports = r;
