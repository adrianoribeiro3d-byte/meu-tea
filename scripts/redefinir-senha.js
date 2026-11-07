// Último recurso, quando ninguém consegue entrar (ex.: o único administrador esqueceu a senha e o
// envio de e-mails não está configurado). Gera uma senha provisória, que deve ser trocada no primeiro acesso.
// Uso no terminal da hospedagem, na pasta do sistema e com as MESMAS variáveis da instalação:
//   NEUROSISTEMA_DADOS=/home/<usuario>/neuro-sistema-dados/<municipio> NODE_ENV=production npm run redefinir-senha -- email@prefeitura.gov.br
// Faça isso só a pedido formal da Secretaria (ofício ou e-mail institucional). Fica registrado na auditoria.
const crypto = require('crypto');
const db = require('../src/db');
const { hashSenha } = require('../src/seguranca');

const email = String(process.argv[2] || '').trim().toLowerCase();
if (!email) {
  console.error('Uso: npm run redefinir-senha -- email@prefeitura.gov.br');
  process.exit(1);
}
const u = db.prepare('SELECT id, nome, ativo FROM usuarios WHERE email = ?').get(email);
if (!u) {
  console.error('Nenhum usuário com este e-mail nesta instalação. Confira se NEUROSISTEMA_DADOS aponta para a pasta do município certo.');
  process.exit(1);
}
const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
let senha = '';
for (let i = 0; i < 10; i++) senha += letras[crypto.randomInt(letras.length)];
senha += crypto.randomInt(1000, 9999);

db.prepare(`UPDATE usuarios SET senha_hash = ?, trocar_senha = 1, convite_pendente = 0, ativo = 1, tentativas_falhas = 0, bloqueado_ate = NULL
            WHERE id = ?`).run(hashSenha(senha), u.id);
db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(u.id);
db.prepare('DELETE FROM tokens_conta WHERE usuario_id = ? AND usado_em IS NULL').run(u.id);
db.prepare(`INSERT INTO auditoria (usuario_id, usuario_nome, acao, entidade, entidade_id) VALUES (?, ?, 'senha_redefinida_terminal', 'usuario', ?)`)
  .run(u.id, u.nome, u.id);
console.log(`Senha provisória de ${email}: ${senha}
Entregue pessoalmente ou por canal seguro. A troca será exigida no primeiro acesso.`);
