const path = require('path');
const express = require('express');
const helmet = require('helmet');
const config = require('./config');
const auth = require('./auth');
const dominio = require('./dominio');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: config.producao ? [] : null,
    },
  },
  hsts: config.producao,
  referrerPolicy: { policy: 'no-referrer' },
}));
app.use(express.static(path.join(config.RAIZ, 'public'), { maxAge: '1h' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Páginas com dados pessoais nunca devem ficar em cache
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

app.use(auth.carregarSessao);
app.use((req, res, next) => {
  Object.assign(res.locals, dominio, {
    pode: (p) => auth.pode(req.usuario, p),
    caminho: req.path,
    minGrupo: config.minGrupo,
    fmtData: (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—'),
    fmtDataHora: (iso) => (iso ? `${iso.slice(0, 10).split('-').reverse().join('/')} ${iso.slice(11, 16)}` : '—'),
    fmtNum: (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR')),
  });
  next();
});
app.use(auth.verificarCsrf);

app.use(require('./routes/conta'));
app.use(auth.exigirLogin);
app.use(require('./routes/dashboard'));
app.use('/criancas', require('./routes/criancas'));
app.use('/importar', require('./routes/importacao'));
app.use('/usuarios', require('./routes/usuarios'));
app.use('/auditoria', require('./routes/auditoria'));

app.use((req, res) => res.status(404).render('erro', { titulo: 'Página não encontrada', mensagem: 'O endereço acessado não existe.' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (!err.expose) console.error(err);
  res.status(err.status || 500).render('erro', {
    titulo: 'Erro', mensagem: err.expose ? err.message : 'Ocorreu um erro inesperado. A equipe técnica foi notificada.',
  });
});

if (require.main === module) {
  app.listen(config.porta, () => console.log(`Meu TEA em http://localhost:${config.porta}`));
}

module.exports = app;
