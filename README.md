# SegStation — Auth Gateway

Stack Docker pour l'authentification centralisée et le dashboard d'administration SegStation.  
Conçu pour s'intégrer derrière un **reverse proxy existant** (Nginx, Caddy, HAProxy…) gérant déjà TLS/Let's Encrypt.

## Architecture

```
Internet (HTTPS)
      │
      ▼
Reverse proxy existant (Nginx / Caddy / HAProxy)
  TLS géré en amont — segstation.org / admin.segstation.org
      │
      │  proxy_pass → 127.0.0.1:3000
      ▼
┌─────────────────────────────────────┐
│  Docker (réseau internal)           │
│                                     │
│  Auth Gateway :3000  (Express.js)   │
│       │              │              │
│  PostgreSQL       Redis             │
│  (non exposé)   (non exposé)        │
└─────────────────────────────────────┘

Instances dédiées (serveurs clients séparés)
  ├── acme.segstation.org   → JS App + FastAPI (serveur #1)
  ├── datalab.segstation.org → JS App + FastAPI (serveur #2)
  └── ...
```

## Démarrage rapide

### 1. Prérequis

- Docker ≥ 24 et Docker Compose ≥ 2.20
- Reverse proxy déjà en place avec TLS actif sur le domaine

### 2. Configuration

```bash
cp .env.example .env
nano .env
```

| Variable | Description |
|---|---|
| `POSTGRES_PASSWORD` | Mot de passe PostgreSQL — fort |
| `REDIS_PASSWORD` | Mot de passe Redis |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `ADMIN_EMAIL` | Email du compte superadmin |
| `ADMIN_PASSWORD` | Mot de passe superadmin initial |
| `APP_DOMAIN` | Ton domaine (ex: `segstation.org`) |
| `GATEWAY_PORT` | Port local écouté par l'auth-gateway (défaut: `3000`) |

### 3. Lancement

```bash
docker compose up -d
```

Au premier démarrage :
- PostgreSQL crée le schéma (`postgres-init/01_schema.sql`)
- Le seed insère le compte superadmin placeholder
- L'entrypoint injecte le vrai hash bcrypt depuis `.env`

### 4. Vérification

```bash
docker compose ps
curl http://127.0.0.1:3000/health
```

---

## Configuration du reverse proxy

### Nginx

```nginx
# segstation.org + admin.segstation.org → auth-gateway
server {
    listen 443 ssl;
    server_name segstation.org admin.segstation.org;

    # Tes directives TLS existantes (certbot, etc.)
    ssl_certificate     /etc/letsencrypt/live/segstation.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/segstation.org/privkey.pem;

    location / {
        proxy_pass          http://127.0.0.1:3000;
        proxy_http_version  1.1;
        proxy_set_header    Host              $host;
        proxy_set_header    X-Real-IP         $remote_addr;
        proxy_set_header    X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header    X-Forwarded-Proto $scheme;
        proxy_set_header    Upgrade           $http_upgrade;
        proxy_set_header    Connection        "upgrade";
        proxy_read_timeout  60s;
    }
}

# Redirection HTTP → HTTPS
server {
    listen 80;
    server_name segstation.org admin.segstation.org;
    return 301 https://$host$request_uri;
}
```

### Caddy

```caddyfile
segstation.org, admin.segstation.org {
    reverse_proxy 127.0.0.1:3000
}
```

### HAProxy

```haproxy
frontend https_front
    bind *:443 ssl crt /etc/ssl/segstation.pem
    acl is_segstation hdr(host) -i segstation.org admin.segstation.org
    use_backend segstation_back if is_segstation

backend segstation_back
    server auth_gateway 127.0.0.1:3000 check
```

---

## Création d'un nouveau client

### Via le dashboard admin

1. `https://admin.segstation.org` → se connecter avec `ADMIN_EMAIL` / `ADMIN_PASSWORD`
2. Section **Comptes clients** → **Nouveau client**
3. Remplir : nom, email, plan, limite membres
4. Cliquer **Créer** — l'email d'accès part automatiquement
5. L'`instance_key` générée apparaît dans la console navigateur (F12)

### Provisionner l'instance dédiée

```bash
./scripts/provision-instance.sh <slug> <ip-serveur> <instance_key>
# Ex :
./scripts/provision-instance.sh acme-corp 10.0.1.5 a3f8c2...
```

---

## Structure du projet

```
segstation/
├── docker-compose.yml              # PostgreSQL + Redis + Auth Gateway
├── .env.example                    # Variables d'environnement
├── .gitignore
├── README.md
│
├── auth-gateway/
│   ├── Dockerfile
│   ├── entrypoint.sh               # Init admin → démarrage Express
│   ├── package.json
│   ├── server.js
│   ├── lib/
│   │   ├── db.js                   # Pool PostgreSQL
│   │   ├── redis.js                # Client Redis
│   │   └── mailer.js               # Emails transactionnels
│   ├── middleware/
│   │   └── isAdmin.js              # Protection superadmin
│   ├── routes/
│   │   ├── auth.js                 # Login · logout · reset password
│   │   └── admin.js                # CRUD orgs/users · stats · logs
│   ├── scripts/
│   │   └── init-admin.js           # Hash bcrypt du mot de passe admin
│   └── public/
│       ├── login.html              # Page de login
│       ├── login-connector.js      # Branche login sur /api/auth/login
│       ├── admin.html              # Dashboard admin
│       └── admin-connector.js      # Branche dashboard sur /api/admin/*
│
├── postgres-init/
│   ├── 01_schema.sql               # Tables · index · triggers
│   └── 02_seed.sql                 # Seed superadmin
│
└── scripts/
    ├── deploy.sh                   # Déploiement rsync + redémarrage
    └── provision-instance.sh      # Injecte instance_key sur serveur client
```

---

## Routes API

### Auth — `/api/auth`

| Méthode | Route | Description |
|---|---|---|
| POST | `/api/auth/login` | Login → JWT → redirect instance |
| POST | `/api/auth/logout` | Déconnexion |
| POST | `/api/auth/forgot-password` | Demande reset |
| POST | `/api/auth/reset-password` | Nouveau mot de passe |
| GET  | `/api/auth/me` | Session courante |

### Admin — `/api/admin` (superadmin requis)

| Méthode | Route | Description |
|---|---|---|
| GET    | `/api/admin/orgs` | Liste des organisations |
| POST   | `/api/admin/orgs` | Créer un client |
| PATCH  | `/api/admin/orgs/:id` | Modifier plan/status |
| DELETE | `/api/admin/orgs/:id` | Suspendre |
| GET    | `/api/admin/users` | Liste des utilisateurs |
| POST   | `/api/admin/users` | Ajouter un utilisateur |
| PATCH  | `/api/admin/users/:id/revoke` | Révoquer l'accès |
| PATCH  | `/api/admin/users/:id/reset-password` | Reset mot de passe |
| GET    | `/api/admin/stats` | Stats globales |
| GET    | `/api/admin/logs` | Journal d'activité |

---

## Intégration côté instance cliente

```js
// Express — /auth/callback
app.get('/auth/callback', (req, res) => {
  const payload = jwt.verify(req.query.token, process.env.INSTANCE_SECRET_KEY);
  req.session.userId = payload.userId;
  req.session.role   = payload.role;
  res.redirect('/dashboard');
});
```

```python
# FastAPI
def get_current_user(authorization: str = Header(...)):
    token = authorization.replace("Bearer ", "")
    return jwt.decode(token, os.getenv("INSTANCE_SECRET_KEY"), algorithms=["HS256"])
```

---

## Sécurité

- Mots de passe hashés **bcrypt coût 12** — jamais stockés en clair
- Sessions **Redis** httpOnly · secure · sameSite=lax
- **Rate limiting** : 5 tentatives / 15 min par IP+email
- **Timing-safe** sur les logins (hash fictif si email inconnu)
- **JWT par clé d'instance** — chaque client a sa propre clé secrète
- Headers HTTP sécurisés via **Helmet**
- PostgreSQL et Redis **non exposés** à l'hôte (réseau Docker internal)
- Auth-gateway exposé **uniquement sur 127.0.0.1** — pas directement accessible depuis Internet
