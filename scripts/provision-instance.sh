#!/usr/bin/env bash
# provision-instance.sh — crée le sous-domaine + envoie l'instance_key au serveur client
# Usage : ./scripts/provision-instance.sh <slug> <instance_host> <instance_key>
# Ex    : ./scripts/provision-instance.sh acme-corp 192.168.1.10 abc123def456...
set -euo pipefail

SLUG="${1:-}"
INSTANCE_HOST="${2:-}"
INSTANCE_KEY="${3:-}"
DOMAIN="${APP_DOMAIN:-segstation.org}"
INSTANCE_DIR="/opt/segstation-instance"

if [[ -z "$SLUG" || -z "$INSTANCE_HOST" || -z "$INSTANCE_KEY" ]]; then
  echo "Usage: $0 <slug> <instance_host> <instance_key>"
  echo "Ex   : $0 acme-corp 10.0.0.5 abc123..."
  exit 1
fi

FQDN="${SLUG}.${DOMAIN}"

echo "▶ Provisionnement de ${FQDN} → ${INSTANCE_HOST}"

# ── 1. Envoyer l'instance_key sur le serveur dédié ───────────────
ssh "root@${INSTANCE_HOST}" bash <<EOF
  set -e
  cd ${INSTANCE_DIR} 2>/dev/null || { echo "Instance dir introuvable"; exit 1; }

  # Injecter la clé dans le .env de l'instance
  if grep -q "INSTANCE_SECRET_KEY" .env 2>/dev/null; then
    sed -i "s|^INSTANCE_SECRET_KEY=.*|INSTANCE_SECRET_KEY=${INSTANCE_KEY}|" .env
  else
    echo "INSTANCE_SECRET_KEY=${INSTANCE_KEY}" >> .env
  fi

  echo "INSTANCE_DOMAIN=${FQDN}" >> .env || true

  # Redémarrer l'app pour prendre en compte la nouvelle clé
  docker compose restart app 2>/dev/null || pm2 restart all 2>/dev/null || true
  echo "✓ Instance key injectée sur ${INSTANCE_HOST}"
EOF

echo "▶ Étapes DNS et SSL à effectuer manuellement (ou via Cloudflare API) :"
echo "   1. Ajouter un enregistrement A : ${FQDN} → ${INSTANCE_HOST}"
echo "   2. Certbot sur l'instance       : certbot --nginx -d ${FQDN}"
echo ""
echo "✓ Provisionnement terminé pour ${FQDN}"
