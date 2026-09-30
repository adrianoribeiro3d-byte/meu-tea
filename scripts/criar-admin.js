// Cria o primeiro administrador. Uso: npm run criar-admin -- "Nome" email@exemplo.gov.br
const db = require('../src/db');
const { hashSenha } = require('../src/seguranca');
const crypto = require('crypto');

const [nome, email] = process.argv.slice(2);
if (!nome || !email) {
  console.error('Uso: npm run criar-admin -- "Nome completo" email@exemplo.gov.br');
  process.exit(1);
}
if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email)) {
  console.error('Já existe um usuário com este e-mail.');
  process.exit(1);
}
const senha = crypto.randomBytes(9).toString('base64url') + '7';
db.prepare(`INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES (?, ?, ?, 'admin')`).run(nome, email.toLowerCase(), hashSenha(senha));
db.prepare(`INSERT INTO auditoria (acao, detalhes) VALUES ('criou_admin_cli', ?)`).run(JSON.stringify({ email }));
console.log(`Administrador criado.\n  E-mail: ${email}\n  Senha provisória: ${senha}\nA troca de senha será exigida no primeiro acesso.`);
