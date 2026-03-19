# PayOps — Deployment Playbook

Complete step-by-step guide to getting PayOps live.
Three deployment paths: Railway (easiest), Render (free tier available), VPS.

---

## Repository structure

Set up your repo like this before deploying:

```
payops/                          ← git repository root
├── 001_schema.sql               ← PostgreSQL schema
├── railway.toml                 ← Railway config (copy from infra/)
├── render.yaml                  ← Render config  (copy from infra/)
├── docker-compose.yml           ← Local dev
│
├── server/                      ← Express API
│   ├── index.js
│   ├── package.json
│   ├── Dockerfile
│   ├── .env.example             ← Copy to .env, never commit .env
│   ├── routes/
│   │   ├── auth.js
│   │   └── index.js
│   ├── middleware/auth.js
│   ├── services/cpf.service.js
│   ├── lib/db.js
│   └── scripts/
│       ├── migrate.js
│       └── seed.js
│
├── dashboard/                   ← Operator dashboard (React/Vite)
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   ├── public/favicon.svg
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       └── payroll-dashboard.jsx   ← Copy from outputs
│
└── portal/                      ← Employee portal (React/Vite)
    ├── index.html
    ├── package.json
    ├── vite.config.js
    ├── public/favicon.svg
    └── src/
        ├── main.jsx
        ├── App.jsx
        └── employee-portal.jsx     ← Copy from outputs
```

---

## Option A — Railway (Recommended)

Railway provides managed PostgreSQL, automatic deploys from GitHub,
and a private network between services (API ↔ DB never exposed publicly).

### 1. Create Railway project

```bash
npm install -g @railway/cli
railway login
railway init        # inside your repo root
```

### 2. Add PostgreSQL

```bash
railway add --plugin postgresql
```

Railway sets `DATABASE_URL` automatically in the API service environment.

### 3. Deploy

```bash
cp infra/railway.toml railway.toml
railway up
```

Railway detects all three services from `railway.toml` and builds them.

### 4. Set secret environment variables

In Railway dashboard → payops-api service → Variables:

```
JWT_SECRET          = <run: openssl rand -hex 32>
SMTP_HOST           = smtp.sendgrid.net
SMTP_PORT           = 587
SMTP_USER           = apikey
SMTP_PASS           = <your Sendgrid API key>
EMAIL_FROM          = noreply@payops.sg
EMAIL_FROM_NAME     = PayOps
S3_ENDPOINT         = https://<account>.r2.cloudflarestorage.com
S3_REGION           = auto
S3_BUCKET           = payops-documents
S3_ACCESS_KEY       = <R2 access key>
S3_SECRET_KEY       = <R2 secret key>
S3_PUBLIC_URL       = https://documents.payops.sg
CORS_ORIGINS        = https://app.payops.sg,https://my.payops.sg
```

### 5. Run migrations

```bash
railway run --service payops-api node scripts/migrate.js
```

### 6. Seed the first operator account

```bash
railway run --service payops-api \
  node scripts/seed.js --email your@email.com --name "Your Name"
```

### 7. Set custom domains

In Railway dashboard → each service → Settings → Domains:

| Service          | Domain            |
|------------------|-------------------|
| payops-api       | api.payops.sg     |
| payops-dashboard | app.payops.sg     |
| payops-portal    | my.payops.sg      |

Railway provisions SSL automatically via Let's Encrypt.

### 8. Update CORS_ORIGINS

After setting custom domains, update the API variable:
```
CORS_ORIGINS = https://app.payops.sg,https://my.payops.sg
```

---

## Option B — Render

Render has a free tier for static sites (dashboard + portal) and $7/month
for the PostgreSQL starter plan.

### 1. Connect GitHub repo

In Render dashboard → New → Blueprint → connect your repository.
Render auto-detects `render.yaml` and creates all three services + the database.

### 2. Set secret environment variables

In Render dashboard → payops-api service → Environment:

Same variables as Railway above (JWT_SECRET, SMTP_*, S3_*).

### 3. Run migrations (Render Shell)

In Render dashboard → payops-api → Shell:
```bash
node scripts/migrate.js
node scripts/seed.js --email your@email.com
```

### 4. Custom domains

In Render dashboard → each service → Settings → Custom Domains.
Add CNAME records in your DNS provider pointing to Render's URLs.
Render provisions SSL automatically.

---

## Option C — VPS (DigitalOcean / Hetzner / AWS EC2)

Use this if you want full control or already have infrastructure.

### 1. Provision server

Minimum: 2 vCPU, 2GB RAM, 20GB SSD (DigitalOcean $12/month droplet).

```bash
# On the server
sudo apt update && sudo apt upgrade -y
sudo apt install -y nodejs npm postgresql nginx certbot python3-certbot-nginx
```

### 2. Set up PostgreSQL

```bash
sudo -u postgres psql
CREATE USER payops WITH PASSWORD 'STRONG_PASSWORD';
CREATE DATABASE payops_production OWNER payops;
\q
```

### 3. Clone and configure

```bash
git clone https://github.com/yourname/payops.git /var/www/payops
cd /var/www/payops/server
cp .env.example .env
# Edit .env — set DATABASE_URL, JWT_SECRET, SMTP_*, S3_*
```

### 4. Run migrations and seed

```bash
node --env-file=.env scripts/migrate.js
node --env-file=.env scripts/seed.js --email your@email.com
```

### 5. Build frontend apps

```bash
cd /var/www/payops/dashboard
VITE_API_URL=https://api.payops.sg/api npm run build

cd /var/www/payops/portal
VITE_API_URL=https://api.payops.sg/api npm run build
```

### 6. Run API with PM2

```bash
npm install -g pm2
cd /var/www/payops/server
pm2 start index.js --name payops-api --env production
pm2 save
pm2 startup   # follow instructions to auto-start on reboot
```

### 7. Configure Nginx + SSL

```bash
sudo cp /var/www/payops/infra/nginx.conf /etc/nginx/sites-available/payops
sudo ln -s /etc/nginx/sites-available/payops /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Get SSL certificates (replace with your domains)
sudo certbot --nginx \
  -d app.payops.sg \
  -d my.payops.sg \
  -d api.payops.sg \
  --non-interactive --agree-tos -m ssl@payops.sg
```

### 8. Auto-renew SSL

```bash
sudo certbot renew --dry-run   # verify auto-renew works
# Certbot installs a cron job automatically
```

---

## Pre-launch security checklist

Run through this before going live with real clients:

**Authentication & secrets**
- [ ] `JWT_SECRET` is at least 64 random characters (`openssl rand -hex 32`)
- [ ] No secrets in git history (`git log --all -S "your_secret"`)
- [ ] `.env` is in `.gitignore`
- [ ] Database password is strong (16+ chars, not a dictionary word)

**Database**
- [ ] PostgreSQL SSL enabled (`?sslmode=require` in DATABASE_URL)
- [ ] DB user has minimum permissions — not superuser
- [ ] Row-Level Security policies tested (`SET LOCAL app.current_operator_id = '...'` in psql)
- [ ] Automated backups enabled (Railway/Render do this; VPS needs pg_dump cron)

**Network**
- [ ] API only accepts HTTPS in production (nginx redirects HTTP → HTTPS)
- [ ] CORS_ORIGINS set to exact production URLs — no wildcards
- [ ] Helmet.js security headers active (already in server/index.js)
- [ ] Rate limiting tested — try 11 OTP requests in 15 minutes, expect 429

**Email (OTP)**
- [ ] Sendgrid / SES SMTP credentials configured
- [ ] Test OTP delivery: `POST /api/auth/otp/send` with a real email
- [ ] SPF/DKIM/DMARC records set for your sending domain

**File storage**
- [ ] Cloudflare R2 bucket created and access keys configured
- [ ] Bucket is private (no public listing)
- [ ] Payslip PDFs generate and upload correctly

**CPF compliance**
- [ ] CPF rate snapshot table has current rates (check: `SELECT * FROM cpf_rate_snapshots ORDER BY effective_from DESC LIMIT 10`)
- [ ] OW ceiling is S$6,800 (from Jan 2026)
- [ ] Test computation against CPF Board e-Submit for a known employee

**Monitoring**
- [ ] `/health` endpoint returns 200
- [ ] PM2 or Railway restart policy configured (already set)
- [ ] Error alerting set up (Railway/Render send email on crash)

---

## Local development (quick start)

```bash
git clone https://github.com/yourname/payops.git
cd payops

# Start everything
docker compose up

# In a second terminal — run migrations
docker compose exec api node scripts/migrate.js
docker compose exec api node scripts/seed.js --email dev@payops.sg

# Open:
#   Operator dashboard: http://localhost:5173
#   Employee portal:    http://localhost:5174
#   API:                http://localhost:4000
#   Health check:       http://localhost:4000/health

# OTP codes print to the API console in dev mode
```

---

## Updating CPF rates

When CPF Board announces rate changes (typically January each year):

```sql
-- Connect to your database and insert new rates
INSERT INTO cpf_rate_snapshots
  (effective_from, residency_type, age_min, age_max,
   ow_ceiling, aw_ceiling_annual, ee_rate, er_rate,
   oa_rate, sa_rate, ma_rate)
VALUES
  ('2027-01-01', 'citizen', 16, 35,
   700000, 10200000, 0.20, 0.17,   -- update ow_ceiling if changed
   0.6217, 0.1621, 0.2162),
  -- ... add all 7 age brackets
  ;
```

The CPF service fetches rates by date, so historical payroll runs
automatically use the rates that were current at their pay period.
No code changes needed when rates change — only a database insert.

---

## Support & compliance contacts

- **CPF Board e-Submit portal**: https://www.cpf.gov.sg/employer
- **IRAS AIS (IR8A)**: https://mytax.iras.gov.sg
- **MOM Employment Act**: https://www.mom.gov.sg/employment-practices
- **Airwallex API docs**: https://www.airwallex.com/docs/api
