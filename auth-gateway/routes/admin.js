'use strict';
const express  = require('express');
const bcrypt   = require('bcrypt');
const crypto   = require('crypto');
const { v4: uuid } = require('uuid');
const { pool } = require('../lib/db');
const mailer   = require('../lib/mailer');
const isAdmin  = require('../middleware/isAdmin');

const router = express.Router();
router.use(isAdmin);

// ══════════════════════════════════════════════════════════════════
// ORGANISATIONS (clients)
// ══════════════════════════════════════════════════════════════════

// GET /api/admin/orgs
router.get('/orgs', async (req, res) => {
  const result = await pool.query(`
    SELECT o.*,
           COUNT(u.id)::int AS member_count
    FROM organizations o
    LEFT JOIN users u ON u.org_id = o.id AND u.active = true
    GROUP BY o.id
    ORDER BY o.created_at DESC
  `);
  res.json(result.rows);
});

// POST /api/admin/orgs — créer un nouveau client
router.post('/orgs', async (req, res) => {
  const {
    name, contactEmail, contactFirstName, contactLastName,
    plan, maxMembers, instanceUrl, tempPassword
  } = req.body;

  if (!name || !contactEmail || !instanceUrl) {
    return res.status(400).json({ error: 'Champs obligatoires manquants.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Clé secrète unique partagée avec l'instance dédiée
    const instanceKey = crypto.randomBytes(32).toString('hex');
    const orgId       = uuid();

    await client.query(`
      INSERT INTO organizations (id, name, plan, max_members, instance_url, instance_key, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'active')
    `, [orgId, name, plan || 'starter', maxMembers || 5, instanceUrl, instanceKey]);

    // Mot de passe temporaire
    const pwd  = tempPassword || crypto.randomBytes(8).toString('base64url');
    const hash = await bcrypt.hash(pwd, 12);
    const userId = uuid();

    await client.query(`
      INSERT INTO users (id, org_id, email, password_hash, role, active, force_password_change)
      VALUES ($1, $2, $3, $4, 'owner', true, true)
    `, [userId, orgId, contactEmail.toLowerCase().trim(), hash]);

    await client.query('COMMIT');

    // Envoi email d'accès
    try {
      await mailer.sendWelcome(contactEmail, pwd, name);
    } catch (mailErr) {
      console.error('[admin/orgs] Mailer:', mailErr.message);
    }

    res.status(201).json({
      success: true,
      orgId,
      instanceKey,
      message: `Organisation "${name}" créée. Accès envoyé à ${contactEmail}.`
    });

  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email déjà utilisé.' });
    }
    console.error('[admin/orgs POST]', err.message);
    res.status(500).json({ error: 'Erreur interne.' });
  } finally {
    client.release();
  }
});

// PATCH /api/admin/orgs/:id
router.patch('/orgs/:id', async (req, res) => {
  const { name, plan, maxMembers, status, instanceUrl } = req.body;
  const updates = [];
  const vals    = [];
  let idx = 1;

  if (name)        { updates.push(`name=$${idx++}`);         vals.push(name); }
  if (plan)        { updates.push(`plan=$${idx++}`);         vals.push(plan); }
  if (maxMembers)  { updates.push(`max_members=$${idx++}`);  vals.push(maxMembers); }
  if (status)      { updates.push(`status=$${idx++}`);       vals.push(status); }
  if (instanceUrl) { updates.push(`instance_url=$${idx++}`); vals.push(instanceUrl); }

  if (!updates.length) return res.status(400).json({ error: 'Rien à modifier.' });

  vals.push(req.params.id);
  await pool.query(
    `UPDATE organizations SET ${updates.join(', ')}, updated_at=NOW() WHERE id=$${idx}`,
    vals
  );
  res.json({ success: true });
});

// DELETE /api/admin/orgs/:id — désactive (soft delete)
router.delete('/orgs/:id', async (req, res) => {
  await pool.query(
    "UPDATE organizations SET status='suspended', updated_at=NOW() WHERE id=$1",
    [req.params.id]
  );
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════
// UTILISATEURS
// ══════════════════════════════════════════════════════════════════

// GET /api/admin/users
router.get('/users', async (req, res) => {
  const { orgId } = req.query;
  const where = orgId ? 'WHERE u.org_id=$1' : '';
  const params = orgId ? [orgId] : [];
  const result = await pool.query(`
    SELECT u.id, u.email, u.role, u.active, u.force_password_change,
           u.created_at, u.last_login,
           o.name AS org_name, o.id AS org_id
    FROM users u
    JOIN organizations o ON o.id = u.org_id
    ${where}
    ORDER BY u.created_at DESC
  `, params);
  res.json(result.rows);
});

// POST /api/admin/users — ajouter un membre à une org existante
router.post('/users', async (req, res) => {
  const { email, orgId, role } = req.body;
  if (!email || !orgId) return res.status(400).json({ error: 'Champs manquants.' });

  const pwd    = crypto.randomBytes(8).toString('base64url');
  const hash   = await bcrypt.hash(pwd, 12);
  const userId = uuid();

  try {
    const orgRes = await pool.query('SELECT name FROM organizations WHERE id=$1', [orgId]);
    if (!orgRes.rows.length) return res.status(404).json({ error: 'Organisation introuvable.' });

    await pool.query(`
      INSERT INTO users (id, org_id, email, password_hash, role, active, force_password_change)
      VALUES ($1, $2, $3, $4, $5, true, true)
    `, [userId, orgId, email.toLowerCase().trim(), hash, role || 'member']);

    try {
      await mailer.sendWelcome(email, pwd, orgRes.rows[0].name);
    } catch (e) {
      console.error('[admin/users] Mailer:', e.message);
    }

    res.status(201).json({ success: true, userId });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email déjà utilisé.' });
    console.error('[admin/users POST]', err.message);
    res.status(500).json({ error: 'Erreur interne.' });
  }
});

// PATCH /api/admin/users/:id/revoke
router.patch('/users/:id/revoke', async (req, res) => {
  await pool.query('UPDATE users SET active=false WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// PATCH /api/admin/users/:id/reset-password
router.patch('/users/:id/reset-password', async (req, res) => {
  const pwd  = crypto.randomBytes(8).toString('base64url');
  const hash = await bcrypt.hash(pwd, 12);
  await pool.query(
    'UPDATE users SET password_hash=$1, force_password_change=true WHERE id=$2',
    [hash, req.params.id]
  );
  res.json({ success: true, tempPassword: pwd });
});

// ══════════════════════════════════════════════════════════════════
// STATS & LOGS
// ══════════════════════════════════════════════════════════════════

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  const [orgs, users, logs] = await Promise.all([
    pool.query("SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE status='active')::int active, COUNT(*) FILTER (WHERE status='suspended')::int suspended FROM organizations"),
    pool.query('SELECT COUNT(*)::int total FROM users WHERE active=true'),
    pool.query("SELECT COUNT(*)::int logins_today FROM auth_logs WHERE event='login_success' AND created_at > NOW() - INTERVAL '24h'"),
  ]);
  res.json({
    orgs:         orgs.rows[0],
    users:        users.rows[0],
    loginsToday:  logs.rows[0].logins_today,
  });
});

// GET /api/admin/logs
router.get('/logs', async (req, res) => {
  const result = await pool.query(`
    SELECT l.event, l.ip, l.created_at,
           u.email, o.name AS org_name
    FROM auth_logs l
    LEFT JOIN users        u ON u.id = l.user_id
    LEFT JOIN organizations o ON o.id = l.org_id
    ORDER BY l.created_at DESC
    LIMIT 100
  `);
  res.json(result.rows);
});

module.exports = router;
