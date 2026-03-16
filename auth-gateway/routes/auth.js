'use strict';
const express   = require('express');
const bcrypt    = require('bcrypt');
const jwt       = require('jsonwebtoken');
const crypto    = require('crypto');
const rateLimit = require('express-rate-limit');
const { pool }  = require('../lib/db');
const { redis } = require('../lib/redis');
const mailer    = require('../lib/mailer');

const router = express.Router();

// ── Rate limiters ─────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs:         15 * 60 * 1000,
  max:              5,
  keyGenerator:     (req) => req.ip + ':' + (req.body.email || ''),
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Trop de tentatives. Réessayez dans 15 minutes.' }
});

const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Trop de demandes de reset. Réessayez dans 1 heure.' }
});

// ── POST /api/auth/login ──────────────────────────────────────────
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password, remember } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis.' });
  }

  try {
    const result = await pool.query(`
      SELECT u.id, u.email, u.password_hash, u.role, u.force_password_change,
             o.id       AS org_id,
             o.name     AS org_name,
             o.instance_url,
             o.instance_key,
             o.status   AS org_status
      FROM users u
      JOIN organizations o ON o.id = u.org_id
      WHERE u.email = $1 AND u.active = true
    `, [email.toLowerCase().trim()]);

    // Timing-safe : on hash quand même si user inconnu
    const fakeHash = '$2b$12$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const hash = result.rows[0]?.password_hash || fakeHash;
    const valid = await bcrypt.compare(password, hash);

    if (!result.rows.length || !valid) {
      return res.status(401).json({ error: 'Identifiants invalides.' });
    }

    const user = result.rows[0];

    if (user.org_status === 'suspended') {
      return res.status(403).json({ error: 'Compte suspendu. Contactez le support.' });
    }

    // Superadmin → session directe, pas de redirect vers instance
    if (user.role === 'superadmin') {
      req.session.userId  = user.id;
      req.session.orgId   = user.org_id;
      req.session.role    = 'superadmin';
      req.session.email   = user.email;
      if (remember) req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
      return res.json({ redirect: '/admin' });
    }

    // Utilisateur client → JWT + redirect vers instance dédiée
    const token = jwt.sign(
      {
        userId:   user.id,
        orgId:    user.org_id,
        orgName:  user.org_name,
        role:     user.role,
        email:    user.email,
        forcePasswordChange: user.force_password_change,
      },
      user.instance_key,
      { expiresIn: remember ? '30d' : '8h', issuer: 'segstation-auth' }
    );

    // Log de connexion
    await pool.query(
      'INSERT INTO auth_logs (user_id, org_id, event, ip) VALUES ($1, $2, $3, $4)',
      [user.id, user.org_id, 'login_success', req.ip]
    );

    const redirectUrl = `${user.instance_url}/auth/callback?token=${token}`;
    return res.json({ redirect: redirectUrl });

  } catch (err) {
    console.error('[auth/login]', err.message);
    res.status(500).json({ error: 'Erreur interne.' });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('[auth/logout]', err);
    res.clearCookie('__seg_sid');
    res.json({ success: true });
  });
});

// ── POST /api/auth/forgot-password ───────────────────────────────
router.post('/forgot-password', resetLimiter, async (req, res) => {
  const { email } = req.body;
  // Toujours répondre OK pour ne pas énumérer les emails
  res.json({ message: 'Si ce compte existe, un email a été envoyé.' });

  try {
    const result = await pool.query(
      'SELECT id, email FROM users WHERE email = $1 AND active = true',
      [email?.toLowerCase().trim()]
    );
    if (!result.rows.length) return;

    const token = crypto.randomBytes(32).toString('hex');
    const key   = `reset:${token}`;
    await redis.set(key, result.rows[0].id, 'EX', 3600); // 1h

    await mailer.sendPasswordReset(email, token);
  } catch (err) {
    console.error('[auth/forgot]', err.message);
  }
});

// ── POST /api/auth/reset-password ────────────────────────────────
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password || password.length < 8) {
    return res.status(400).json({ error: 'Token ou mot de passe invalide.' });
  }

  const key    = `reset:${token}`;
  const userId = await redis.get(key);
  if (!userId) return res.status(400).json({ error: 'Lien expiré ou invalide.' });

  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    'UPDATE users SET password_hash=$1, force_password_change=false WHERE id=$2',
    [hash, userId]
  );
  await redis.del(key);

  res.json({ success: true, message: 'Mot de passe mis à jour.' });
});

// ── GET /api/auth/me ──────────────────────────────────────────────
router.get('/me', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Non authentifié' });
  res.json({
    userId: req.session.userId,
    orgId:  req.session.orgId,
    role:   req.session.role,
    email:  req.session.email,
  });
});

module.exports = router;
