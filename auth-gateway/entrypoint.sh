#!/bin/sh
set -e

echo "[entrypoint] Initialisation du compte admin..."
node scripts/init-admin.js

echo "[entrypoint] Démarrage de l'Auth Gateway..."
exec node server.js
