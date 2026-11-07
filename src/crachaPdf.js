// Crachá de identificação da criança em PDF, no tamanho de cartão de PVC (CR80: 54 × 85,6 mm),
// com frente e verso em páginas separadas, nas cores do Neuro Sistema.
// A foto é usada só para montar o PDF: não é gravada no servidor.
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const MM = 72 / 25.4;
const LARG = 53.98 * MM;
const ALT = 85.6 * MM;
const COR = {
  marinho: '#004090', marinhoEscuro: '#002357', ceu: '#00A5FE', ceuSuave: '#e6f6ff',
  tinta: '#0f1d33', suave: '#5b6b85', branco: '#ffffff',
};
const ARCO_IRIS = ['#e5383b', '#f77f00', '#fcbf49', '#2bb673', '#00A5FE', '#4361ee', '#9b5de5'];

const EXTRAS = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const limpar = (t) => String(t ?? '').replace(/[^\n\x20-\xff]/g, (ch) => (EXTRAS.includes(ch) ? ch : '?')).trim();

/** Maior corpo de fonte (até `max`) em que o texto cabe na largura. */
function caber(doc, texto, fonte, max, min, largura) {
  doc.font(fonte);
  let t = max;
  while (t > min && doc.fontSize(t).widthOfString(texto) > largura) t -= 0.25;
  return t;
}

function textoCentral(doc, texto, y, { fonte = 'Helvetica-Bold', max = 10, min = 5, cor = COR.tinta, largura = LARG - 20, x = 10, espaco = 0 } = {}) {
  const t = caber(doc, texto, fonte, max, min, largura - espaco * texto.length);
  doc.font(fonte).fontSize(t).fillColor(cor).text(texto, x, y, { width: largura, align: 'center', lineBreak: false, characterSpacing: espaco });
  return t;
}

/** Símbolo do infinito com as cores do arco-íris (neurodiversidade). */
function infinito(doc, cx, cy, largura, espessura) {
  const a = largura / 2;
  const pontos = [];
  for (let i = 0; i <= 120; i++) {
    const t = (i / 120) * Math.PI * 2;
    const d = 1 + Math.sin(t) ** 2;
    pontos.push([cx + (a * Math.cos(t)) / d, cy + (a * Math.sin(t) * Math.cos(t)) / d * 1.25]);
  }
  const grad = doc.linearGradient(cx - a, cy, cx + a, cy);
  ARCO_IRIS.forEach((c, i) => grad.stop(i / (ARCO_IRIS.length - 1), c));
  doc.save().lineWidth(espessura).lineCap('round').lineJoin('round');
  doc.moveTo(...pontos[0]);
  pontos.slice(1).forEach((p) => doc.lineTo(...p));
  doc.stroke(grad).restore();
}

function fundo(doc) {
  const g = doc.linearGradient(0, 0, LARG, ALT);
  g.stop(0, COR.marinho).stop(1, COR.marinhoEscuro);
  doc.rect(0, 0, LARG, ALT).fill(g);
  // Arcos decorativos em azul-céu
  doc.save().lineWidth(10).strokeOpacity(0.22).circle(LARG + 8, ALT * 0.62, 46).stroke(COR.ceu).restore();
  doc.save().lineWidth(5).strokeOpacity(0.35).circle(-14, ALT * 0.18, 30).stroke(COR.ceu).restore();
}

function pilula(doc, x, y, w, h, cor) {
  doc.roundedRect(x, y, w, h, h / 2).fill(cor);
}

function frente(doc, d) {
  fundo(doc);
  textoCentral(doc, 'CRACHÁ DE IDENTIFICAÇÃO', 13, { fonte: 'Helvetica-Bold', max: 6.2, cor: COR.ceu, espaco: 0.6 });
  textoCentral(doc, 'NEURODIVERSIDADE', 21, { fonte: 'Helvetica-Bold', max: 13, min: 9, cor: COR.branco, largura: LARG - 28, x: 14 });

  // Foto
  const fw = 98, fh = 116, fx = (LARG - fw) / 2, fy = 42;
  doc.roundedRect(fx - 4, fy - 4, fw + 8, fh + 8, 12).fill(COR.branco);
  doc.save().roundedRect(fx, fy, fw, fh, 9).clip();
  let fotoOk = false;
  if (d.foto) {
    try { doc.image(d.foto, fx, fy, { cover: [fw, fh], align: 'center', valign: 'center' }); fotoOk = true; } catch { fotoOk = false; }
  }
  if (!fotoOk) {
    doc.rect(fx, fy, fw, fh).fill(COR.ceuSuave);
    const iniciais = d.nomeCracha.split(/\s+/).filter((p) => p.length > 2 || /^[A-ZÀ-Ú]/.test(p)).map((p) => p[0]).filter(Boolean);
    const sigla = (iniciais[0] || '') + (iniciais.length > 1 ? iniciais[iniciais.length - 1] : '');
    doc.font('Helvetica-Bold').fontSize(34).fillColor(COR.marinho).text(limpar(sigla.toUpperCase()), fx, fy + fh / 2 - 17, { width: fw, align: 'center', lineBreak: false });
  }
  doc.restore();

  // Nome e destaque
  let y = fy + fh + 12;
  pilula(doc, 12, y, LARG - 24, 19, COR.branco);
  textoCentral(doc, limpar(d.nomeCracha.toUpperCase()), y + 5.2, { max: 10, min: 5.5, cor: COR.marinho, largura: LARG - 34, x: 17 });
  y += 23;
  if (d.destaque) {
    pilula(doc, 18, y, LARG - 36, 15, COR.ceu);
    textoCentral(doc, limpar(d.destaque), y + 4.2, { max: 7.8, min: 5, cor: COR.branco, largura: LARG - 46, x: 23 });
  }
  infinito(doc, LARG / 2, ALT - 15, 30, 3);
}

function rotulo(doc, texto, y) {
  const w = LARG - 40;
  pilula(doc, 20, y, w, 10.5, COR.marinho);
  textoCentral(doc, texto, y + 2.6, { max: 6, min: 4.5, cor: COR.branco, largura: w - 8, x: 24, espaco: 0.4 });
}

function verso(doc, d, qr) {
  fundo(doc);
  const px = 8, py = 8, pw = LARG - 16, ph = ALT - 16;
  doc.roundedRect(px, py, pw, ph, 10).fill(COR.branco);
  doc.rect(px + 18, py, pw - 36, 3).fill(COR.ceu);

  let y = 17;
  rotulo(doc, 'NOME COMPLETO', y);
  y += 13.5;
  const nome = limpar(d.nomeCompleto.toUpperCase());
  doc.font('Helvetica-Bold');
  let t = 8.2;
  while (t > 5.5 && doc.fontSize(t).heightOfString(nome, { width: pw - 12, align: 'center' }) > t * 2.5) t -= 0.25;
  doc.fontSize(t).fillColor(COR.tinta).text(nome, px + 6, y, { width: pw - 12, align: 'center' });
  y = Math.max(doc.y, y + 10) + 3;

  rotulo(doc, 'DATA DE NASCIMENTO', y);
  textoCentral(doc, limpar(d.nascimento), y + 13.5, { max: 8.5, cor: COR.tinta });
  y += 26;

  // QR de verificação com cantoneiras
  const q = 58, qx = (LARG - q) / 2, qy = y + 15;
  textoCentral(doc, 'VERIFICAR CRACHÁ', y, { max: 6.2, cor: COR.marinho, espaco: 0.4 });
  const c = 9, m = 5;
  doc.save().lineWidth(1.6).strokeColor(COR.marinho);
  [[qx - m, qy - m, 1, 1], [qx + q + m, qy - m, -1, 1], [qx - m, qy + q + m, 1, -1], [qx + q + m, qy + q + m, -1, -1]].forEach(([x0, y0, sx, sy]) => {
    doc.moveTo(x0, y0 + sy * c).lineTo(x0, y0).lineTo(x0 + sx * c, y0).stroke();
  });
  doc.restore();
  const n = qr.modules.size;
  const tam = q / n;
  doc.save().fillColor(COR.tinta);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (qr.modules.get(i, j)) doc.rect(qx + j * tam, qy + i * tam, tam + 0.05, tam + 0.05);
  }
  doc.fill().restore();
  y = qy + q + m + 6;

  rotulo(doc, 'CONTATOS DE EMERGÊNCIA', y);
  y += 13;
  d.contatos.slice(0, 2).forEach((ct) => {
    if (ct.nome) textoCentral(doc, limpar(ct.nome), y, { fonte: 'Helvetica', max: 6.3, min: 4.5, cor: COR.suave, largura: pw - 12, x: px + 6 });
    textoCentral(doc, limpar(ct.telefone), y + 7.5, { max: 8.3, min: 5.5, cor: COR.tinta, largura: pw - 12, x: px + 6 });
    y += 18;
  });

  doc.font('Helvetica').fontSize(4.6).fillColor(COR.suave)
    .text(limpar(`${d.codigo} · emitido em ${d.emitidoEm} · Neuro Sistema`), px + 4, ALT - py - 10, { width: pw - 8, align: 'center', lineBreak: false });
}

/**
 * Escreve o PDF do crachá no stream `destino`.
 * @param {{nomeCracha, nomeCompleto, nascimento, destaque, contatos: {nome, telefone}[], codigo, emitidoEm, foto?: Buffer, urlVerificacao}} d
 */
function gerarCrachaPdf(d, destino) {
  const qr = QRCode.create(d.urlVerificacao, { errorCorrectionLevel: 'M' });
  const doc = new PDFDocument({
    size: [LARG, ALT], margin: 0, autoFirstPage: false,
    info: { Title: `Crachá ${d.codigo}`, Author: 'Neuro Sistema', Subject: 'Crachá de identificação — dados pessoais (LGPD)' },
  });
  doc.pipe(destino);
  doc.addPage();
  frente(doc, d);
  doc.addPage();
  verso(doc, d, qr);
  doc.end();
}

module.exports = { gerarCrachaPdf, LARG, ALT };
