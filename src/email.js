// Envio de e-mails: convites, redefinição de senha, aviso de senha alterada e pedidos de demonstração.
// Usa a conta definida em NEUROSISTEMA_SMTP_USUARIO / NEUROSISTEMA_SMTP_SENHA (ex.: nao-responda@neurosistema.com.br).
// Os e-mails nunca levam dados de crianças.
const nodemailer = require('nodemailer');
const config = require('./config');

let transporte = null;
let transporteDeTeste = false;

function obterTransporte() {
  if (transporte) return transporte;
  const { host, porta, usuario, senha } = config.smtp;
  if (!usuario || !senha) return null;
  transporte = nodemailer.createTransport({ host, port: porta, secure: porta === 465, auth: { user: usuario, pass: senha } });
  return transporte;
}

// Usado pelos testes para trocar o envio real por um transporte de teste (null volta ao normal)
function definirTransporte(t) { transporte = t; transporteDeTeste = !!t; }

/** Há conta de envio e endereço público configurados? Sem isso, os links não podem ir por e-mail. */
const configurado = () => !!config.endereco && (transporteDeTeste || (!!config.smtp.usuario && !!config.smtp.senha));

const umaLinha = (v) => String(v || '').replace(/[\r\n]+/g, ' ').trim();

async function enviar({ para, assunto, texto, responderPara }) {
  const t = obterTransporte();
  if (!t) throw new Error('Envio de e-mail não configurado');
  return t.sendMail({
    from: { name: 'Neuro Sistema', address: config.smtp.usuario || 'nao-responda@localhost' },
    to: umaLinha(para),
    ...(responderPara ? { replyTo: responderPara } : {}),
    subject: umaLinha(assunto).slice(0, 150),
    text: texto,
  });
}

async function avisarPedido(form) {
  if (!obterTransporte()) return null;
  return enviar({
    para: config.smtp.destino || config.smtp.usuario,
    responderPara: { name: umaLinha(form.nome), address: umaLinha(form.email) },
    assunto: `Pedido de demonstração: ${umaLinha(form.instituicao)}`,
    texto: [
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
    ].join('\n'),
  });
}

module.exports = { enviar, avisarPedido, configurado, definirTransporte, umaLinha };
