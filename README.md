# Meu TEA

Sistema web para a Secretaria de Inclusão acompanhar crianças neurodivergentes (TEA, TDAH, dislexia, deficiência intelectual, altas habilidades e outras). Ele reúne:

- **Dashboard** com estatísticas agregadas e anônimas: condições, faixa etária, nível de suporte, laudo, sexo, bairro, escola, atendimentos por mês e especialidade, cobertura por especialidade e evolução registrada.
- **Importação das planilhas** da Secretaria (.xlsx ou .csv). Os nomes de coluna são reconhecidos automaticamente e há uma prévia com validação antes de gravar.
- **Ficha da criança** com a equipe multiprofissional vinculada: neuropedagogo, psicólogo, fonoaudiólogo, nutricionista, terapeuta ocupacional, psicopedagogo, professor de AEE etc.
- **Registro de acompanhamento** por profissional, com evolução (avançou / manteve / regrediu) e opção de sigilo.
- **Relatório com o histórico de acompanhamento**, filtrável por período e especialidade, pronto para imprimir ou salvar em PDF.

## Proteção de dados (LGPD)

| Medida | Como funciona |
|---|---|
| Dashboard anônimo | Mostra apenas contagens. Grupos com menos de `LGPD_MIN_GRUPO` crianças (padrão 3) entram em “Outros” ou aparecem como “< 3”. Um filtro que resulte em poucas crianças fica oculto. |
| Criptografia | Nome, nascimento, responsável, telefone, observações e textos clínicos ficam no banco cifrados com AES-256-GCM. A duplicidade é detectada por índice cego (HMAC), sem guardar o nome em claro. |
| Necessidade de acesso | O profissional só vê as crianças às quais foi **vinculado** pela Secretaria. O gestor vê só o dashboard. |
| Sigilo profissional | Um registro marcado como sigiloso só é visível ao autor e à mesma especialidade. As demais especialidades veem apenas a data e o tipo. |
| Auditoria | Login, visualização de ficha, relatório, importação, exportação e acesso negado ficam registrados. Gatilhos no SQLite impedem alterar ou apagar a trilha. |
| Termo de confidencialidade | Aceite obrigatório no primeiro acesso, com versão e data gravadas. |
| Autenticação | Senhas com scrypt, troca obrigatória da senha provisória e bloqueio após 5 tentativas. A sessão expira por inatividade e o cookie é HttpOnly/SameSite=Strict. Há token CSRF em todos os formulários e cabeçalhos de segurança (CSP, etc.). |
| Direitos do titular | Na ficha, o administrador pode exportar os dados em JSON (portabilidade) e anonimizar o cadastro de forma irreversível, mantendo só os dados estatísticos. |
| Consentimento | Cada criança tem o registro do termo assinado pelo responsável (art. 14). As pendências aparecem no dashboard e na lista. |
| Planilhas | O arquivo enviado é lido em memória e não fica gravado no servidor. |

> A LGPD também exige medidas organizacionais que o software não cobre sozinho: indicar um Encarregado (DPO), elaborar o RIPD (relatório de impacto), coletar os termos de consentimento, definir o prazo de retenção, fazer backup cifrado e usar HTTPS. Veja a seção “Produção”.

## Perfis

| Perfil | Dashboard | Crianças | Registrar acompanhamento | Importar / usuários / auditoria |
|---|---|---|---|---|
| Administrador (Secretaria) | ✔ | todas | — | ✔ |
| Profissionais | ✔ | só as vinculadas | ✔ | — |
| Gestor | ✔ | — | — | — |

## Como rodar

Requisitos: Node.js 20 ou superior.

```bash
npm install
npm run demo          # opcional: dados FICTÍCIOS + usuários de teste (senha demo12345678)
npm start             # http://localhost:3000
```

Usuários de demonstração: `admin@meutea.demo`, `gestor@meutea.demo`, `psico@meutea.demo`, `fono@meutea.demo`, `nutri@meutea.demo`, `neuro@meutea.demo`, `to@meutea.demo`, `psicoped@meutea.demo`, `aee@meutea.demo`.

Para testar a importação, use `npm run planilha-exemplo`, que gera `exemplos/planilha-exemplo.xlsx`, ou baixe o modelo em **Importar planilha → Baixar modelo**.

Testes automatizados: `npm test`.

## Produção

1. Copie `.env.example` para `.env` e gere a chave mestra:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
   **Guarde a chave em cofre.** Sem ela, os dados cifrados ficam ilegíveis.
2. Use `NODE_ENV=production`. Isso exige HTTPS, porque o cookie passa a ser `Secure`. Rode o sistema atrás de um proxy reverso (nginx/Caddy) com TLS.
3. Crie o primeiro administrador com `npm run criar-admin -- "Nome Completo" email@prefeitura.gov.br`.
4. **Não** rode `npm run demo` em produção.
5. Faça backup diário e cifrado da pasta `data/` e mantenha a chave mestra separada do backup.

## Estrutura

```
src/
  server.js        Express, cabeçalhos de segurança, rotas
  config.js        variáveis de ambiente e chave mestra
  seguranca.js     AES-256-GCM, HMAC, scrypt
  auth.js          sessão, CSRF, permissões, auditoria
  db.js            esquema SQLite
  dominio.js       perfis, condições, especialidades
  criancas.js      cadastro (grava cifrado, lê decifrado, anonimiza)
  importador.js    leitura das planilhas e mapeamento de colunas
  estatisticas.js  agregações do dashboard com supressão de grupos pequenos
  routes/          dashboard, crianças, importação, usuários, auditoria, conta
  views/           telas (EJS)
public/            CSS, JS dos gráficos (Chart.js local, sem CDN)
scripts/           demo, criar-admin, planilha-exemplo
test/              testes (node:test)
```
