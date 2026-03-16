'use strict';
const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const session      = require('express-session');
const RedisStore   = require('connect-redis').default;
const path         = require('path');
const { redis }    = require('./lib/redis');
const { pool }     = require('./lib/db');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Sécurité HTTP ─────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:    ["'self'"],
      // unsafe-inline pour les blocs <script> embarqués dans le HTML
      scriptSrc:     ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      // unsafe-hashes + unsafe-inline : autorise les onclick="..." inline
      // dans le dashboard admin sans ouvrir les scripts externes arbitraires
      scriptSrcAttr: ["'unsafe-hashes'", "'unsafe-inline'"],
      styleSrc:      ["'self'", "'unsafe-inline'", "fonts.googleapis.com", "fonts.gstatic.com"],
      fontSrc:       ["'self'", "fonts.gstatic.com"],
      connectSrc:    ["'self'"],
      imgSrc:        ["'self'", "data:"],
    }
  }
}));

app.use(cors({
  origin: (origin, cb) => {
    const domain = process.env.APP_DOMAIN || 'segstation.org';
    const allowed = [
      `https://${domain}`,
      `https://admin.${domain}`,
      `https://auth.${domain}`,
    ];
    if (!origin || allowed.some(a => origin.startsWith(a))) return cb(null, true);
    cb(new Error('CORS non autorisé'));
  },
  credentials: true
}));

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// ── Sessions Redis ────────────────────────────────────────────────
app.use(session({
  store: new RedisStore({ client: redis, prefix: 'sess:' }),
  secret:            process.env.SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  name:              '__seg_sid',
  cookie: {
    httpOnly:  true,
    secure:    process.env.NODE_ENV === 'production',
    sameSite:  'lax',
    maxAge:    8 * 60 * 60 * 1000,
  }
}));

// ── Trust proxy (reverse proxy existant) ─────────────────────────
app.set('trust proxy', 1);

// ── Static files ──────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes ────────────────────────────────────────────────────────
app.use('/api/auth',  require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));

// ── Pages HTML ────────────────────────────────────────────────────
app.get('/',       (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/login',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin',  require('./middleware/isAdmin'), (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ── Health check ──────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    await redis.ping();
    res.json({ status: 'ok', ts: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', error: err.message });
  }
});

// ── 404 ───────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Route introuvable' }));

// ── Error handler ─────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: 'Erreur interne' });
});

// ── Démarrage ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[segstation] Auth Gateway actif sur :${PORT}`);
});
