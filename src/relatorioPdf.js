// Geração do relatório de acompanhamento em PDF (A4), com marca d'água e rodapé de confidencialidade.
const PDFDocument = require('pdfkit');
const { ESPECIALIDADES, TIPOS_ATENDIMENTO, EVOLUCAO, NIVEIS_SUPORTE, LAUDO, SEXOS, TURNOS } = require('./dominio');

const COR = { tinta: '#14171c', suave: '#5b6270', linha: '#d9dde4', fundo: '#f1f3f6', primaria: '#2a5fb0', alerta: '#8a5a00' };
const LOGO = 'M24 24c-4-5-7-8-11-8a8 8 0 0 0 0 16c4 0 7-3 11-8zm0 0c4 5 7 8 11 8a8 8 0 0 0 0-16c-4 0-7 3-11 8z';

// As fontes padrão do PDF usam a codificação WinAnsi: troca o que ela não representa (ex.: emojis)
const EXTRAS = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const limpar = (t) => String(t ?? '').replace(/[^\n\x20-\xff]/g, (ch) => (EXTRAS.includes(ch) ? ch : '?'));
const fmtData = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');

/**
 * Escreve o PDF no stream `destino`.
 * @param {object} d { c, registros, resumo, filtro, equipe, usuario, adm, geradoEm }
 */
function gerarRelatorioPdf(d, destino) {
  const { c, registros, resumo, filtro, equipe, usuario, adm } = d;
  const geradoEm = d.geradoEm || new Date();
  const emitido = geradoEm.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  const doc = new PDFDocument({
    size: 'A4', margins: { top: 50, bottom: 70, left: 50, right: 50 }, bufferPages: true,
    info: { Title: `Relatório de acompanhamento ${c.codigo}`, Author: 'Meu TEA', Subject: 'Documento confidencial (LGPD)' },
  });
  doc.pipe(destino);
  const L = doc.page.margins.left;
  const W = doc.page.width - L - doc.page.margins.right;
  const fimUtil = () => doc.page.height - doc.page.margins.bottom;
  const garantir = (altura) => { if (doc.y + altura > fimUtil()) doc.addPage(); };
  const texto = (t, opts = {}) => doc.text(limpar(t), opts);

  // ---- cabeçalho
  doc.save().translate(L, 46).scale(0.55).path(LOGO).lineWidth(4.5).strokeColor(COR.primaria).stroke().restore();
  doc.font('Helvetica-Bold').fontSize(14).fillColor(COR.tinta).text('Meu TEA', L + 32, 50);
  doc.font('Helvetica').fontSize(8.5).fillColor(COR.suave)
    .text(limpar(`Emitido em ${emitido}\npor ${usuario.nome}`), L, 50, { width: W, align: 'right' });
  doc.moveDown(1.6);
  doc.x = L;
  doc.font('Helvetica-Bold').fontSize(16).fillColor(COR.tinta)
    .text(adm ? 'Relatório de atendimentos (visão administrativa)' : 'Relatório de acompanhamento multiprofissional', L, doc.y, { width: W });
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(9.5).fillColor(COR.suave);
  texto(`Período: ${filtro.inicio ? fmtData(filtro.inicio) : 'início'} a ${filtro.fim ? fmtData(filtro.fim) : fmtData(geradoEm.toISOString())}  ·  `
    + `Especialidade: ${filtro.especialidade ? ESPECIALIDADES[filtro.especialidade] : 'todas'}`, { width: W });
  doc.moveDown(0.8);

  const secao = (titulo) => {
    garantir(40);
    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(12).fillColor(COR.tinta).text(titulo, L, doc.y, { width: W });
    const y = doc.y + 3;
    doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.7).strokeColor(COR.linha).stroke();
    doc.y = y + 8;
  };

  // ---- dados da criança (duas colunas)
  secao('Identificação');
  const campos = [
    ['Criança', c.nome], ['Código', c.codigo],
    ['Nascimento / idade', `${fmtData(c.nascimento)}${c.idade != null ? ` · ${c.idade} anos` : ''}`], ['Sexo', SEXOS[c.sexo]],
    ['Condições', c.condicoes.join(', ')], ['CID', c.cid || '—'],
    ['Nível de suporte / laudo', `${NIVEIS_SUPORTE[c.nivel_suporte]} · ${LAUDO[c.laudo]}`],
    ['Escola', [c.escola, c.serie, TURNOS[c.turno]].filter(Boolean).join(' · ') || '—'],
    ['Apoio escolar', [c.aee ? 'AEE' : null, c.mediador ? 'Mediador' : null].filter(Boolean).join(' · ') || '—'],
    ['Responsável', c.responsavel || '—'],
  ];
  const colW = (W - 20) / 2;
  for (let i = 0; i < campos.length; i += 2) {
    const par = campos.slice(i, i + 2);
    const alturas = par.map(([, v]) => doc.font('Helvetica').fontSize(10).heightOfString(limpar(v), { width: colW }));
    garantir(14 + Math.max(...alturas));
    const y0 = doc.y;
    par.forEach(([rot, v], j) => {
      const x = L + j * (colW + 20);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COR.suave).text(rot.toUpperCase(), x, y0, { width: colW, characterSpacing: 0.4 });
      doc.font('Helvetica').fontSize(10).fillColor(COR.tinta).text(limpar(v), x, y0 + 11, { width: colW });
    });
    doc.y = y0 + 14 + Math.max(...alturas) + 6;
  }

  // Tabela simples com cabeçalho cinza; quebra de página automática por linha
  const tabela = (cols) => {
    const larg = cols.map(([, f]) => f * W);
    return (valores, cabecalho) => {
      doc.font(cabecalho ? 'Helvetica-Bold' : 'Helvetica').fontSize(cabecalho ? 8 : 9);
      const h = Math.max(...valores.map((v, i) => doc.heightOfString(limpar(v), { width: larg[i] - 8 }))) + 8;
      garantir(h);
      const y = doc.y;
      if (cabecalho) doc.rect(L, y, W, h).fill(COR.fundo);
      let x = L;
      valores.forEach((v, i) => {
        doc.fillColor(cabecalho ? COR.suave : COR.tinta).text(limpar(v), x + 4, y + 4, { width: larg[i] - 8, align: cols[i][2] || 'left' });
        x += larg[i];
      });
      doc.moveTo(L, y + h).lineTo(L + W, y + h).lineWidth(0.5).strokeColor(COR.linha).stroke();
      doc.y = y + h;
    };
  };

  // ---- resumo por especialidade (tabela)
  secao('Resumo por especialidade');
  const esp = Object.entries(resumo);
  if (!esp.length) {
    doc.font('Helvetica').fontSize(10).fillColor(COR.suave).text('Sem registros no período.', L, doc.y);
  } else {
    const cols = adm
      ? [['Especialidade', 0.26], ['Registros', 0.12, 'right'], ['Primeiro', 0.14], ['Último', 0.14], ['Profissional(is)', 0.34]]
      : [['Especialidade', 0.2], ['Registros', 0.1, 'right'], ['Primeiro', 0.12], ['Último', 0.12], ['Evolução registrada', 0.22], ['Profissional(is)', 0.24]];
    const linha = tabela(cols);
    linha(cols.map(([n]) => n), true);
    for (const [k, s] of esp) {
      const profs = equipe.filter((e) => e.perfil === k).map((e) => e.nome).join(', ') || '—';
      const ev = Object.entries(s.evolucao).map(([e, n]) => `${EVOLUCAO[e]}: ${n}`).join(' · ') || '—';
      linha(adm
        ? [ESPECIALIDADES[k] || k, String(s.total), fmtData(s.primeira), fmtData(s.ultima), profs]
        : [ESPECIALIDADES[k] || k, String(s.total), fmtData(s.primeira), fmtData(s.ultima), ev, profs]);
    }
  }

  // ---- histórico (ordem cronológica)
  secao(adm ? 'Atendimentos realizados' : 'Histórico detalhado');
  if (adm) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(COR.suave)
      .text('Visão da Secretaria: o conteúdo clínico e a evolução são visíveis somente aos profissionais da equipe.', L, doc.y, { width: W });
    doc.moveDown(0.5);
  }
  if (!registros.length) doc.font('Helvetica').fontSize(10).fillColor(COR.suave).text('Nenhum acompanhamento no período.', L, doc.y);
  else if (adm) {
    const cols = [['Data', 0.14], ['Especialidade', 0.24], ['Tipo', 0.26], ['Profissional', 0.36]];
    const linha = tabela(cols);
    linha(cols.map(([n]) => n), true);
    for (const a of registros.slice().reverse()) {
      linha([fmtData(a.data), ESPECIALIDADES[a.especialidade] || a.especialidade, TIPOS_ATENDIMENTO[a.tipo] || a.tipo,
        `${a.profissional_nome}${a.registro_profissional ? ` (${a.registro_profissional})` : ''}`]);
    }
  }
  for (const a of adm ? [] : registros.slice().reverse()) {
    const titulo = `${fmtData(a.data)}  ·  ${ESPECIALIDADES[a.especialidade] || a.especialidade}  ·  ${TIPOS_ATENDIMENTO[a.tipo] || a.tipo}`;
    const meta = [`${a.profissional_nome}${a.registro_profissional ? ` (${a.registro_profissional})` : ''}`,
      a.evolucao !== 'nao_avaliado' ? `Evolução: ${EVOLUCAO[a.evolucao]}` : null, a.sigiloso ? 'Registro sigiloso' : null].filter(Boolean).join('  ·  ');
    const blocos = a.visivel
      ? [['Objetivos', a.objetivos], ['Descrição / evolução', a.descricao], ['Encaminhamentos / orientações', a.encaminhamentos]].filter(([, v]) => v)
      : [[null, adm ? 'Conteúdo restrito aos profissionais da equipe de acompanhamento.' : `Conteúdo restrito à especialidade ${ESPECIALIDADES[a.especialidade]} (sigilo profissional).`]];
    // Mantém cada registro inteiro na mesma página quando possível
    doc.fontSize(9.5);
    const altura = 30 + blocos.reduce((s, [r, v]) => s + (r ? 11 : 0) + doc.heightOfString(limpar(v), { width: W - 12 }) + 4, 0);
    garantir(Math.min(altura, 220));
    const y0 = doc.y;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COR.tinta).text(limpar(titulo), L + 12, y0, { width: W - 12 });
    doc.font('Helvetica').fontSize(8.5).fillColor(COR.suave).text(limpar(meta), L + 12, doc.y + 1, { width: W - 12 });
    doc.moveDown(0.3);
    for (const [rot, v] of blocos) {
      if (rot) doc.font('Helvetica-Bold').fontSize(8).fillColor(COR.suave).text(rot, L + 12, doc.y + 2, { width: W - 12 });
      doc.font(rot ? 'Helvetica' : 'Helvetica-Oblique').fontSize(9.5).fillColor(rot ? COR.tinta : COR.suave).text(limpar(v), L + 12, doc.y + 1, { width: W - 12 });
    }
    // Filete à esquerda marca o registro (cinza para conteúdo restrito)
    const yFim = doc.y;
    if (yFim > y0) doc.moveTo(L + 2, y0 + 2).lineTo(L + 2, yFim).lineWidth(2).strokeColor(a.visivel ? COR.primaria : COR.linha).stroke();
    doc.y = yFim + 12;
  }

  // ---- aviso final
  garantir(50);
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(8).fillColor(COR.suave).text(
    'Documento confidencial contendo dados pessoais sensíveis de criança (LGPD, arts. 11 e 14). Uso restrito à equipe de acompanhamento e ao '
    + 'responsável legal. Proibida a reprodução ou o compartilhamento fora dessa finalidade. Emissão registrada na trilha de auditoria.', L, doc.y, { width: W });

  // ---- marca d'água e rodapé em todas as páginas
  const { start, count } = doc.bufferedPageRange();
  for (let i = start; i < start + count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // permite escrever o rodapé sem criar página nova
    const cx = doc.page.width / 2, cy = doc.page.height / 2;
    doc.save().rotate(-35, { origin: [cx, cy] }).font('Helvetica-Bold').fontSize(60).fillColor('#000000').fillOpacity(0.05)
      .text('CONFIDENCIAL', cx - 250, cy - 30, { width: 500, align: 'center', lineBreak: false }).restore();
    doc.fillOpacity(1);
    const yR = doc.page.height - 45;
    doc.moveTo(L, yR - 6).lineTo(L + W, yR - 6).lineWidth(0.5).strokeColor(COR.linha).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor(COR.suave);
    doc.text(limpar(`Meu TEA · ${c.codigo} · Documento confidencial (LGPD) · Emitido por ${usuario.nome} em ${emitido}`), L, yR, { width: W - 70, lineBreak: false });
    doc.text(`Página ${i - start + 1} de ${count}`, L, yR, { width: W, align: 'right', lineBreak: false });
  }
  doc.end();
}

module.exports = { gerarRelatorioPdf };
