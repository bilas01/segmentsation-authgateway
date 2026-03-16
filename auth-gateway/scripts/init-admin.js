#!/usr/bin/env node
/**
 * Exécuté une seule fois au premier démarrage (via docker-compose command override ou entrypoint).
 * Remplace les placeholders du seed SQL par les vraies valeurs depuis les variables d'env.
 */
'use strict';
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const email    = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.log('[init-admin] ADMIN_EMAIL ou ADMIN_PASSWORD manquant, skip.');
    await pool.end();
    return;
  }

  // Vérifie si l'admin existe déjà (hash déjà remplacé)
  const existing = await pool.query(
    "SELECT id FROM users WHERE email=$1 AND password_hash != 'HASH_PLACEHOLDER'",
    [email]
  );
  if (existing.rows.length) {
    console.log('[init-admin] Superadmin déjà initialisé.');
    await pool.end();
    return;
  }

  const hash = await bcrypt.hash(password, 12);

  await pool.query(
    "UPDATE users SET email=$1, password_hash=$2 WHERE email='ADMIN_EMAIL_PLACEHOLDER'",
    [email, hash]
  );

  console.log(`[init-admin] Superadmin créé : ${email}`);
  await pool.end();
}

main().catch(err => {
  console.error('[init-admin] Erreur:', err.message);
  process.exit(1);
});
