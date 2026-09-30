# Meu TEA

Sistema web para a Secretaria de Inclusão acompanhar crianças neurodivergentes (TEA, TDAH, dislexia, deficiência intelectual, altas habilidades e outras). Ele reúne:

- **Painel individual de cada profissional**: com login e senha próprios, o profissional vê só as crianças vinculadas a ele e os atendimentos que registrou. O painel mostra quem está sem avaliação inicial ou sem atendimento há mais de 30 dias, os atendimentos por mês, a evolução registrada e os últimos registros.
- **Dashboard geral** (panorama da rede) com estatísticas agregadas e anônimas: condições, faixa etária, nível de suporte, laudo, sexo, bairro, escola, atendimentos por mês e especialidade, cobertura por especialidade e evolução registrada.
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
| Conteúdo clínico | Anotações, objetivos, encaminhamentos e evolução ficam visíveis **somente aos profissionais da equipe**. A Secretaria vê apenas a data, o tipo, a especialidade e o profissional de cada atendimento, inclusive no relatório e na exportação. |
| Sigilo profissional | Um registro marcado como sigiloso só é visível ao autor e à mesma especialidade. As demais especialidades veem apenas a data e o tipo. |
| Auditoria | Login, visualização de ficha, relatório, importação, exportação e acesso negado ficam registrados. Gatilhos no SQLite impedem alterar ou apagar a trilha. |
| Termo de confidencialidade | Aceite obrigatório no primeiro acesso, com versão e data gravadas. |
| Autenticação | Senhas com scrypt, troca obrigatória da senha provisória e bloqueio após 5 tentativas. A sessão expira por inatividade e o cookie é HttpOnly/SameSite=Strict. Há token CSRF em todos os formulários e cabeçalhos de segurança (CSP, etc.). |
| Direitos do titular | Na ficha, o administrador pode exportar os dados em JSON (portabilidade) e anonimizar o cadastro de forma irreversível, mantendo só os dados estatísticos. |
| Consentimento | Cada criança tem o registro do termo assinado pelo responsável (art. 14). As pendências aparecem no dashboard e na lista. |
| Planilhas | O arquivo enviado é lido em memória e não fica gravado no servidor. |

> A LGPD também exige medidas organizacionais que o software não cobre sozinho: indicar um Encarregado (DPO), elaborar o RIPD (relatório de impacto), coletar os termos de consentimento, definir o prazo de retenção, fazer backup cifrado e usar HTTPS. Veja a seção “Produção”.

## Perfis

| Perfil | Página inicial | Crianças | Conteúdo dos acompanhamentos | Importar / usuários / auditoria |
|---|---|---|---|---|
| Administrador (Secretaria) | Dashboard geral (anônimo) | cadastro de todas | não vê (só datas e especialidades) | ✔ |
| Profissionais | **Meu painel** (+ panorama geral anônimo) | só as vinculadas | vê e registra | — |
| Gestor | Dashboard geral (anônimo) | — | — | — |

## Ver funcionando sem instalar nada (GitHub Codespaces)

[![Abrir no GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/adrianoribeiro3d-byte/meu-tea?quickstart=1)

1. Clique no botão acima e depois em **Create codespace**.
2. Aguarde de 2 a 3 minutos enquanto tudo é instalado e os dados fictícios de demonstração são criados.
3. O sistema abre sozinho em uma nova aba. Se isso não acontecer, abra a aba **PORTS** (Portas), na parte de baixo, e clique no ícone de globo da porta 3000.
4. Entre com `admin@meutea.demo` ou `fono@meutea.demo`. A senha é `demo12345678`.

O endereço é privado: só abre para a sua conta do GitHub. Quando terminar, feche o codespace em https://github.com/codespaces para não gastar a cota gratuita.

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
