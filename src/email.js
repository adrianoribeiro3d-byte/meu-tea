// Aviso por e-mail de cada pedido de demonstração recebido pela página inicial.
// Só funciona com NEUROSISTEMA_SMTP_USUARIO e NEUROSISTEMA_SMTP_SENHA definidos (ex.: a conta
// contato@neurosistema.com.br criada na Hostinger). Sem eles, o pedido fica só no sistema.
const nodemailer = require('nodemailer');
const config = require('./config');

let transporte = null;
function obterTransporte() {
  if (transporte) return transporte;
  const { host, porta, usuario, senha } = config.smtp;
  if (!usuario || !senha) return null;
  transporte = nodemailer.createTransport({ host, port: porta, secure: porta === 465, auth: { user: usuario, pass: senha } });
  return transporte;
}

// Usado pelos testes para trocar o envio real por um transporte de teste
function definirTransporte(t) { transporte = t; }

const umaLinha = (v) => String(v || '').replace(/[\r\n]+/g, ' ').trim();

async function avisarPedido(form) {
  const t = obterTransporte();
  if (!t) return null;
  const linhas = [
    'Novo pedido de demonstração recebido pela página do Neuro Sistema.',
    '',
    `Nome: ${umaLinha(form.nome)}`,
    `Cargo: ${umaLinha(form.cargo) || '—'}`,
    `Instituição: ${umaLinha(form.instituicao)}`,
    `Município: ${umaLinha(form.municipio) || '—'}`,
    `E-mail: ${umaLinha(form.email)}`,
    `Telefone: ${umaLinha(form.telefone) || '—'}`,
    '',
    'Mensagem:',
    form.mensagem ? String(form.mensagem) : '—',
    '',
    'Para responder, use o botão "Responder": a resposta vai direto para o e-mail de quem pediu.',
    'O pedido também fica guardado no sistema, em Administração → Pedidos de demonstração.',
  ];
  return t.sendMail({
    from: { name: 'Neuro Sistema', address: config.smtp.usuario || 'nao-responda@localhost' },
    to: config.smtp.destino || config.smtp.usuario,
    replyTo: { name: umaLinha(form.nome), address: umaLinha(form.email) },
    subject: `Pedido de demonstração: ${umaLinha(form.instituicao)}`.slice(0, 150),
    text: linhas.join('\n'),
  });
}

module.exports = { avisarPedido, definirTransporte };
