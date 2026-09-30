// Gera exemplos/planilha-exemplo.xlsx (dados fictícios) com cabeçalhos "reais" de secretaria, para testar a importação.
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

(async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Levantamento 2026');
  ws.addRow(['SECRETARIA MUNICIPAL DE INCLUSÃO — LEVANTAMENTO DE ESTUDANTES (DADOS FICTÍCIOS)']);
  ws.addRow([]);
  ws.addRow(['Aluno', 'DN', 'Gênero', 'Diagnóstico', 'CID', 'Nível', 'Possui laudo', 'Unidade escolar', 'Ano/Série', 'Período', 'Bairro', 'Sala de recursos', 'Profissional de apoio', 'Nome da mãe', 'Celular', 'Termo assinado', 'Coluna extra']);
  const linhas = [
    ['Otávio Fictício Nunes', '12/04/2017', 'Masculino', 'Autismo', 'F84.0', 'Nível 2', 'Sim', 'EM Paulo Freire', '3º ano', 'Manhã', 'Centro', 'Sim', 'Sim', 'Joana Fictícia', '(00) 90000-0001', 'Sim', 'x'],
    ['Lara Exemplo Prado', '03/09/2015', 'Feminino', 'TDAH, Dislexia', 'F90.0', '', 'Em avaliação', 'EM Rui Barbosa', '5º ano', 'Tarde', 'Vila Nova', 'Não', 'Não', 'Rita Exemplo', '(00) 90000-0002', 'Não', ''],
    ['Caio Teste Moreira', '21/01/2019', 'M', 'TEA / Transtorno de linguagem', 'F84.0', '1', 'S', 'CMEI Sementinha', 'Pré II', 'Integral', 'Jardim América', 'Sim', 'Não', 'Paula Teste', '(00) 90000-0003', 'S', ''],
    ['Nina Amostra Reis', new Date(Date.UTC(2014, 6, 30)), 'F', 'Altas habilidades', '', '', 'Sim', 'EM Castro Alves', '6º ano', 'Manhã', 'São José', 'Sim', 'Não', 'Clara Amostra', '(00) 90000-0004', 'Sim', ''],
    ['Téo Simulado Luz', '07/11/2016', 'Masc', 'Síndrome de Down', 'Q90', '', 'Sim', 'EM Monteiro Lobato', '4º ano', 'Tarde', 'Boa Vista', 'Sim', 'Sim', 'Lúcia Simulada', '(00) 90000-0005', 'Sim', ''],
    ['Bia Hipotética Sol', '15/05/2018', 'Fem', 'Transtorno de ansiedade', '', '', 'Não', 'EM Paulo Freire', '2º ano', 'Manhã', 'Centro', 'Não', 'Não', 'Vera Hipotética', '', 'Não', ''],
    ['Sem Data Válida', '31/02/2016', 'M', 'TEA', '', '', '', 'EM Rui Barbosa', '', '', 'Centro', '', '', '', '', '', ''],
    ['', '10/10/2010', 'M', 'TEA', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ];
  linhas.forEach((l) => ws.addRow(l));
  ws.getRow(3).font = { bold: true };
  const destino = path.join(__dirname, '..', 'exemplos', 'planilha-exemplo.xlsx');
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  await wb.xlsx.writeFile(destino);
  console.log('Gerado', destino);
})();
