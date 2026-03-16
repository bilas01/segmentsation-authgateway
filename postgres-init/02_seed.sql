-- Seed : organisation interne + compte superadmin
-- Le mot de passe sera celui de ADMIN_PASSWORD dans .env
-- Ce script utilise une org "système" pour rattacher le superadmin

DO $$
DECLARE
  sys_org_id UUID := uuid_generate_v4();
  admin_id   UUID := uuid_generate_v4();
BEGIN
  -- Organisation interne (non visible dans le dashboard)
  INSERT INTO organizations (id, name, plan, max_members, instance_url, instance_key, status)
  VALUES (
    sys_org_id,
    'SegStation Internal',
    'enterprise',
    999,
    'https://admin.segstation.org',
    encode(gen_random_bytes(32), 'hex'),
    'active'
  );

  -- Superadmin
  -- Le hash ici est un placeholder — le script scripts/init-admin.js
  -- insère le vrai hash bcrypt depuis ADMIN_PASSWORD au démarrage
  INSERT INTO users (id, org_id, email, password_hash, role, active, force_password_change)
  VALUES (
    admin_id,
    sys_org_id,
    'ADMIN_EMAIL_PLACEHOLDER',
    'HASH_PLACEHOLDER',
    'superadmin',
    true,
    false
  );
END $$;
