#!/usr/bin/env bash
# deploy.sh — déploiement SegStation Auth Gateway
# Usage : ./scripts/deploy.sh [user@host]
set -euo pipefail

HOST="${1:-}"
PROJECT_DIR="/opt/segstation"

if [[ -z "$HOST" ]]; then
  echo "Usage: $0 user@host"
  exit 1
fi

echo "▶ Déploiement sur $HOST"

# ── 1. Copier les fichiers (hors .env et node_modules) ───────────
rsync -avz --exclude='.env' \
           --exclude='node_modules' \
           --exclude='.git' \
           --exclude='postgres_data' \
           --exclude='redis_data' \
           --exclude='letsencrypt_data' \
  ./ "${HOST}:${PROJECT_DIR}/"

echo "▶ Fichiers transférés"

# ── 2. Commandes sur le serveur distant ──────────────────────────
ssh "$HOST" bash <<EOF
  set -euo pipefail
  cd ${PROJECT_DIR}

  # Vérifier que .env existe
  if [[ ! -f .env ]]; then
    echo "⚠ ATTENTION : .env absent. Copie .env.example → .env et édite-le."
    cp .env.example .env
  fi

  # Pull images + rebuild
  docker compose pull --ignore-pull-failures
  docker compose build --no-cache auth-gateway

  # Redémarrage sans downtime
  docker compose up -d --remove-orphans

  # Santé
  echo "▶ Attente du health check..."
  sleep 8
  docker compose ps
  curl -sf http://localhost:3000/health && echo " ✓ Auth Gateway opérationnel" || echo " ✗ Health check échoué"
EOF

echo "✓ Déploiement terminé"
