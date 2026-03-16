# ── Stage 1 : installation des dépendances ───────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# Copier uniquement les fichiers de dépendances d'abord
# (optimise le cache Docker — npm ci ne retourne que si package.json change)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# ── Stage 2 : image de production ────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# Utilisateur non-root
RUN addgroup -g 1001 -S nodejs && \
    adduser  -S nodeuser -u 1001 -G nodejs

# Récupérer node_modules depuis le stage deps
COPY --from=deps --chown=nodeuser:nodejs /app/node_modules ./node_modules

# Copier le code source
COPY --chown=nodeuser:nodejs . .

# S'assurer que l'entrypoint est exécutable (fait en root, avant USER)
RUN chmod +x entrypoint.sh

# Passer en non-root
USER nodeuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

ENTRYPOINT ["./entrypoint.sh"]
