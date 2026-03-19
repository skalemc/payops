# PayOps — Payroll Platform

Singapore-compliant multi-client payroll SaaS for service providers.
Built with React, Node.js/Express, PostgreSQL.

---

## Architecture

```
payops/
├── 001_schema.sql          # PostgreSQL schema (run once)
├── docker-compose.yml      # Local dev environment
├── server/                 # Express API backend
│   ├── index.js            # Entry point
│   ├── routes/
│   │   ├── auth.js         # OTP login for all user types
│   │   └── index.js        # All resource endpoints
│   ├── middleware/
│   │   └── auth.js         # JWT verification + RLS context
│   ├── services/
│   │   └── cpf.service.js  # CPF engine (DB-backed rate tables)
│   └── lib/
│       └── db.js           # PostgreSQL pool + RLS query helper
├── dashboard/              # Operator React app (payroll-dashboard.jsx)
└── portal/                 # Employee React app (employee-portal.jsx)
```

---

## Local Development

### Prerequisites
- Docker Desktop
- Node.js 22+

### 1. Clone and configure
```bash
git clone https://github.com/yourname/payops.git
cd payops
cp server/.env.example server/.env
# Edit server/.env — update JWT_SECRET minimum
```

### 2. Start everything
```bash
docker compose up
```
- API:       http://localhost:4000
- Dashboard: http://localhost:5173
- Portal:    http://localhost:5174
- PostgreSQL: localhost:5432

The schema is auto-applied on first `db` container start.

### 3. Seed initial data (operator account)
```bash
docker compose exec api node scripts/seed.js
```

---

## API Overview

### Authentication
All endpoints require `Authorization: Bearer <jwt>`.

**POST** `/api/auth/otp/send`   — send OTP to email
**POST** `/api/auth/otp/verify` — verify OTP, receive JWT

Three user types, same endpoint:
- `operator_user` — you (the service provider)
- `client_user` — HR managers at client companies
- `employee` — employees via self-service portal

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/clients` | Operator | List all clients |
| POST | `/api/clients` | Operator | Onboard new client |
| GET | `/api/clients/:id/employees` | Operator/Client | List employees |
| POST | `/api/clients/:id/employees` | Operator/Client | Add employee |
| GET | `/api/clients/:id/payroll` | Operator/Client | List payroll periods |
| POST | `/api/clients/:id/payroll` | Operator | Create payroll period |
| POST | `/api/clients/:id/payroll/:pid/compute` | Operator | Run CPF calculations |
| POST | `/api/clients/:id/payroll/:pid/approve` | Operator | Lock payroll period |
| POST | `/api/clients/:id/payroll/:pid/generate-pi` | Operator | Create payment instructions |
| GET | `/api/clients/:id/payment-instructions` | Operator/Client | List PIs with Airwallex links |
| POST | `/api/payment-instructions/:id/mark-paid` | Operator | Confirm payment |
| GET | `/api/clients/:id/leave` | Operator/Client | List leave applications |
| POST | `/api/clients/:id/leave` | All | Submit leave application |
| POST | `/api/clients/:id/leave/:id/approve` | Operator/Client | Approve leave |
| GET | `/api/clients/:id/claims` | Operator/Client | List expense claims |
| POST | `/api/clients/:id/claims` | All | Submit claim |
| POST | `/api/clients/:id/claims/:id/approve` | Operator/Client | Approve claim |
| POST | `/api/clients/:id/claims/lock-to-payroll` | Operator | Lock claims to payroll run |
| GET | `/api/me` | Employee | Own employment details |
| GET | `/api/me/payslips` | Employee | Own payslip history |
| GET | `/api/clients/:id/audit-log` | Operator | Full audit trail |

### Money convention
**All monetary values are INTEGER CENTS (SGD).**
- Store: `basicSalary: 980000` = S$9,800.00
- Display: divide by 100
- No floating point money anywhere in the system

---

## Deployment

### Railway (recommended for first deploy)

1. Create a Railway project
2. Add a PostgreSQL service — Railway provisions it automatically
3. Add a web service pointing to `/server`
4. Set environment variables:
   ```
   DATABASE_URL       = (Railway provides this automatically)
   JWT_SECRET         = (generate: openssl rand -hex 32)
   NODE_ENV           = production
   PORT               = 4000
   CORS_ORIGINS       = https://your-dashboard.railway.app,https://your-portal.railway.app
   ```
5. Railway detects the Dockerfile automatically

### Render

1. New Web Service → connect repo → select `/server` as root dir
2. Build command: `npm install`
3. Start command: `node index.js`
4. Add PostgreSQL from Render dashboard
5. Set same env vars as above

### Cloudflare R2 (document storage)

1. Create R2 bucket `payops-documents`
2. Create API token with R2 read/write permissions
3. Set `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` in env

### Custom domain (after deploy)

- Operator dashboard: `app.payops.sg` → Railway/Render frontend service
- Employee portal: `my.payops.sg` → Railway/Render portal service
- API: `api.payops.sg` → Railway/Render backend service

---

## Security checklist before going live

- [ ] `JWT_SECRET` is 64+ random chars (`openssl rand -hex 32`)
- [ ] `DATABASE_URL` uses SSL (`?sslmode=require`)
- [ ] All `.env` values set in Railway/Render, not in repo
- [ ] `NODE_ENV=production` in deployment
- [ ] SMTP credentials configured (Sendgrid or SES) — OTP won't send without it
- [ ] R2/S3 bucket configured for payslip PDF storage
- [ ] Bank account numbers encrypted at app layer before insert
- [ ] Postgres user has minimum required permissions (not superuser)
- [ ] Rate limiting tested (10 OTP requests/15min, 100 API requests/15min)
- [ ] RLS policies verified with `SET ROLE` in psql

---

## CPF Compliance Notes

- All CPF rates are stored in `cpf_rate_snapshots` table — update when CPF Board announces changes
- OW ceiling: S$6,800/month (from Jan 2026)
- AW ceiling: S$102,000 − total OW for the year
- SDL: 0.25% of gross wages, min S$2.00, max S$11.25 per employee per month
- CPF contributions truncated (not rounded) to nearest dollar per CPF Board spec
- NPL salary proration: `prorated_OW = OW × (daysWorked / totalDaysInMonth)`
- Historical payroll runs use rate snapshots from the run date, not current rates
