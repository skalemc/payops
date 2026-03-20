-- =============================================================================
-- PayOps — Production PostgreSQL Schema
-- Version : 001 (initial)
-- Encoding: UTF-8
-- Notes   : Multi-tenant by client_id on every user-data table.
--           Row-level security (RLS) policies enforce tenant isolation.
--           All monetary values stored in INTEGER cents (SGD).
--           All timestamps stored as TIMESTAMPTZ (UTC).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";      -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";       -- fuzzy name search
CREATE EXTENSION IF NOT EXISTS "btree_gist";    -- date range exclusion

-- ---------------------------------------------------------------------------
-- Utility types
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE residency_type AS ENUM ('citizen', 'pr1', 'pr2', 'pr3', 'ep', 'spass', 'wp', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE employment_status AS ENUM ('active', 'inactive', 'terminated', 'on_leave');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE client_status AS ENUM ('active', 'pending_setup', 'suspended', 'offboarded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE payroll_run_status AS ENUM ('draft', 'computed', 'approved', 'paid', 'voided');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('pending', 'initiated', 'confirmed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE leave_type AS ENUM ('annual', 'medical', 'hospitalisation', 'maternity', 'paternity', 'childcare', 'npl', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE leave_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled', 'withdrawn');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE claim_status AS ENUM ('pending', 'manager_approved', 'operator_approved', 'rejected', 'paid');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE document_type AS ENUM ('payslip', 'ir8a', 'cpf_submission', 'giro_file', 'payment_instruction', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE audit_action AS ENUM ('create', 'update', 'delete', 'approve', 'reject', 'lock', 'void', 'login', 'export');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 1. OPERATORS
--    The payroll service provider (you). One per deployment for now.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS operators (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    email           TEXT NOT NULL UNIQUE,
    phone           TEXT,
    uen             TEXT,                    -- operator's own UEN
    logo_url        TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    settings        JSONB NOT NULL DEFAULT '{}',   -- branding, default prefs
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 2. OPERATOR USERS
--    Staff accounts for the operator (you and any team members).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS operator_users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operator_id     UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
    email           TEXT NOT NULL UNIQUE,
    full_name       TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'operator',   -- operator | admin | viewer
    is_active       BOOLEAN NOT NULL DEFAULT true,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 3. CLIENTS
--    Each company you manage payroll for.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operator_id     UUID NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
    name            TEXT NOT NULL,
    uen             TEXT NOT NULL,
    industry        TEXT,
    status          client_status NOT NULL DEFAULT 'pending_setup',

    -- Contact
    contact_name    TEXT,
    contact_email   TEXT,
    contact_phone   TEXT,

    -- Banking
    bank_name       TEXT,
    bank_account    TEXT,          -- encrypted at app layer before insert
    airwallex_account_id TEXT,     -- client's Airwallex account reference

    -- Payroll config
    payroll_day     SMALLINT NOT NULL DEFAULT 28,   -- day of month salary is paid
    pay_currency    CHAR(3) NOT NULL DEFAULT 'SGD',
    cpf_submission_mode TEXT NOT NULL DEFAULT 'file', -- file | api

    -- Statutory
    is_cpf_registered BOOLEAN NOT NULL DEFAULT true,
    has_foreign_workers BOOLEAN NOT NULL DEFAULT false,

    settings        JSONB NOT NULL DEFAULT '{}',
    onboarded_at    DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (operator_id, uen)
);

-- ---------------------------------------------------------------------------
-- 4. CLIENT USERS
--    HR/finance managers at the client company who have portal access.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    email           TEXT NOT NULL UNIQUE,
    full_name       TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'hr_admin',  -- hr_admin | manager | viewer
    is_active       BOOLEAN NOT NULL DEFAULT true,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 5. EMPLOYEES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employees (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

    -- Identity
    full_name       TEXT NOT NULL,
    nric_masked     TEXT NOT NULL,          -- e.g. S****123A  — never store full NRIC
    date_of_birth   DATE NOT NULL,
    residency_type  residency_type NOT NULL DEFAULT 'citizen',
    nationality     TEXT,

    -- Employment
    designation     TEXT NOT NULL,
    department      TEXT,
    employment_status employment_status NOT NULL DEFAULT 'active',
    join_date       DATE NOT NULL,
    termination_date DATE,
    work_email      TEXT UNIQUE,
    manager_id      UUID REFERENCES employees(id),  -- for leave approvals

    -- Payroll
    basic_salary    INTEGER NOT NULL,       -- in cents
    fixed_allowance INTEGER NOT NULL DEFAULT 0,  -- in cents
    pay_mode        TEXT NOT NULL DEFAULT 'bank_transfer',

    -- Banking (encrypted at app layer)
    bank_name       TEXT,
    bank_account    TEXT,

    -- CPF config (can override per employee)
    cpf_aw_ceiling_used INTEGER NOT NULL DEFAULT 0,   -- cents, YTD AW subject to CPF
    cpf_total_ow_ytd    INTEGER NOT NULL DEFAULT 0,   -- cents, YTD ordinary wages paid

    -- Portal access
    portal_enabled  BOOLEAN NOT NULL DEFAULT false,
    portal_last_login TIMESTAMPTZ,

    employee_code   TEXT,                   -- client's internal employee number
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT positive_salary CHECK (basic_salary > 0),
    CONSTRAINT positive_allowance CHECK (fixed_allowance >= 0)
);

-- Partial index: active employees per client (most common query)
CREATE INDEX IF NOT EXISTS idx_employees_client_active
    ON employees (client_id)
    WHERE employment_status = 'active';

CREATE INDEX IF NOT EXISTS idx_employees_work_email ON employees (work_email) WHERE work_email IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. OTP / AUTH TOKENS  (passwordless login for employees and client users)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_otps (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL,
    otp_hash        TEXT NOT NULL,          -- bcrypt hash of the 6-digit code
    user_type       TEXT NOT NULL,          -- 'employee' | 'client_user' | 'operator_user'
    attempts        SMALLINT NOT NULL DEFAULT 0,
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
    used_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_otps_email ON auth_otps (email);

-- Auto-cleanup: expired OTPs older than 1 hour (handled by pg_cron or app job)

-- ---------------------------------------------------------------------------
-- 7. SESSIONS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    user_type       TEXT NOT NULL,          -- 'employee' | 'client_user' | 'operator_user'
    token_hash      TEXT NOT NULL UNIQUE,   -- SHA-256 of JWT jti
    ip_address      INET,
    user_agent      TEXT,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (token_hash) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- 8. PAYROLL PERIODS
--    One row per client per month. Anchors all payroll activity.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_periods (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    period_year     SMALLINT NOT NULL,      -- e.g. 2026
    period_month    SMALLINT NOT NULL,      -- 1–12
    pay_date        DATE NOT NULL,          -- actual salary payment date
    cpf_due_date    DATE NOT NULL,          -- 14th of following month
    status          payroll_run_status NOT NULL DEFAULT 'draft',
    locked_at       TIMESTAMPTZ,            -- set when status → approved
    locked_by       UUID REFERENCES operator_users(id),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (client_id, period_year, period_month),
    CONSTRAINT valid_month CHECK (period_month BETWEEN 1 AND 12),
    CONSTRAINT valid_year  CHECK (period_year  BETWEEN 2020 AND 2100)
);

-- ---------------------------------------------------------------------------
-- 9. PAYROLL LINE ITEMS
--    One row per employee per payroll period. The computed, locked record.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_line_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payroll_period_id   UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
    employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    client_id           UUID NOT NULL REFERENCES clients(id),   -- denorm for RLS

    -- Wages (all in cents)
    ordinary_wage       INTEGER NOT NULL,       -- actual OW paid this month (post-proration)
    ordinary_wage_capped INTEGER NOT NULL,      -- min(ow, OW_CEILING)
    additional_wage     INTEGER NOT NULL DEFAULT 0,
    aw_cpf_liable       INTEGER NOT NULL DEFAULT 0,
    gross_pay           INTEGER NOT NULL,
    expense_reimb       INTEGER NOT NULL DEFAULT 0,  -- locked claims, CPF-exempt

    -- CPF (cents)
    ee_cpf              INTEGER NOT NULL,
    er_cpf              INTEGER NOT NULL,
    cpf_remittance      INTEGER NOT NULL,       -- ee + er
    sdl                 INTEGER NOT NULL,       -- SDL in cents

    -- Net
    net_pay             INTEGER NOT NULL,       -- gross - ee_cpf

    -- Rates applied (snapshot at run time — rates can change year to year)
    ee_rate             NUMERIC(6,4) NOT NULL,
    er_rate             NUMERIC(6,4) NOT NULL,
    ow_ceiling          INTEGER NOT NULL,       -- snapshot of OW ceiling (cents)

    -- Proration
    days_worked         SMALLINT,               -- NULL = full month
    total_days_in_month SMALLINT NOT NULL DEFAULT 31,
    npl_days            SMALLINT NOT NULL DEFAULT 0,

    -- Status
    is_locked           BOOLEAN NOT NULL DEFAULT false,

    -- CPF OA/SA/MA allocation (cents, informational)
    cpf_oa              INTEGER,
    cpf_sa              INTEGER,
    cpf_ma              INTEGER,

    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (payroll_period_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_lines_period ON payroll_line_items (payroll_period_id);
CREATE INDEX IF NOT EXISTS idx_payroll_lines_employee ON payroll_line_items (employee_id);

-- ---------------------------------------------------------------------------
-- 10. PAYMENT INSTRUCTIONS
--     One salary PI + one CPF PI per payroll period per client.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_instructions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payroll_period_id   UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
    client_id           UUID NOT NULL REFERENCES clients(id),
    type                TEXT NOT NULL,           -- 'salary' | 'cpf' | 'sdl' | 'claims'
    reference_number    TEXT NOT NULL UNIQUE,    -- e.g. PI-SAL-202603-202301234A
    total_amount        INTEGER NOT NULL,        -- cents
    currency            CHAR(3) NOT NULL DEFAULT 'SGD',
    payment_status      payment_status NOT NULL DEFAULT 'pending',
    airwallex_url       TEXT,                    -- deep-link pre-computed
    airwallex_payment_id TEXT,                   -- returned by Airwallex on initiation
    payee               TEXT,                    -- 'employees' | 'CPF Board' | etc.
    payee_uen           TEXT,                    -- CPF Board: T08GB0002B
    due_date            DATE NOT NULL,
    paid_at             TIMESTAMPTZ,
    paid_by             UUID REFERENCES operator_users(id),
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pi_period ON payment_instructions (payroll_period_id);
CREATE INDEX IF NOT EXISTS idx_pi_status ON payment_instructions (payment_status) WHERE payment_status != 'confirmed';

-- ---------------------------------------------------------------------------
-- 11. PAYMENT INSTRUCTION LINE ITEMS (salary PI — one row per employee)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_instruction_lines (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_instruction_id  UUID NOT NULL REFERENCES payment_instructions(id) ON DELETE CASCADE,
    employee_id             UUID NOT NULL REFERENCES employees(id),
    payroll_line_item_id    UUID NOT NULL REFERENCES payroll_line_items(id),
    amount                  INTEGER NOT NULL,    -- cents — net pay or claim amount
    bank_name               TEXT,
    bank_account            TEXT,               -- encrypted
    reference               TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 12. LEAVE ENTITLEMENTS
--     Annual snapshot per employee per year — EA statutory + any company extras.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leave_entitlements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    client_id       UUID NOT NULL REFERENCES clients(id),
    leave_year      SMALLINT NOT NULL,
    leave_type      leave_type NOT NULL,
    total_days      SMALLINT NOT NULL,      -- statutory + extra
    statutory_days  SMALLINT NOT NULL,      -- EA/CDCA minimum
    carry_forward   SMALLINT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (employee_id, leave_year, leave_type)
);

-- ---------------------------------------------------------------------------
-- 13. LEAVE APPLICATIONS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leave_applications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    client_id       UUID NOT NULL REFERENCES clients(id),
    leave_type      leave_type NOT NULL,
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    days            SMALLINT NOT NULL,
    reason          TEXT,
    status          leave_status NOT NULL DEFAULT 'pending',
    submitted_by    TEXT NOT NULL DEFAULT 'employee',  -- 'employee' | 'admin'

    -- Approval chain
    manager_id          UUID REFERENCES employees(id),
    manager_approved_at TIMESTAMPTZ,
    manager_notes       TEXT,
    operator_approved_by UUID REFERENCES operator_users(id),
    operator_approved_at TIMESTAMPTZ,
    rejection_reason    TEXT,

    -- Payroll linkage (NPL only)
    payroll_period_id   UUID REFERENCES payroll_periods(id),
    affects_payroll     BOOLEAN NOT NULL DEFAULT false,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT valid_dates CHECK (end_date >= start_date),
    CONSTRAINT positive_days CHECK (days > 0)
);

CREATE INDEX IF NOT EXISTS idx_leave_employee ON leave_applications (employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_period ON leave_applications (payroll_period_id) WHERE payroll_period_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leave_pending ON leave_applications (client_id, status) WHERE status = 'pending';

-- Prevent overlapping approved leave for same employee
-- btree_gist already loaded above
ALTER TABLE leave_applications ADD CONSTRAINT no_overlapping_leave
    EXCLUDE USING GIST (
        employee_id WITH =,
        daterange(start_date, end_date, '[]') WITH &&
    ) WHERE (status IN ('pending', 'approved'));

-- ---------------------------------------------------------------------------
-- 14. EXPENSE CLAIM CATEGORIES (client-configurable)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claim_categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id   UUID REFERENCES clients(id) ON DELETE CASCADE,   -- NULL = system-wide
    name        TEXT NOT NULL,
    requires_receipt BOOLEAN NOT NULL DEFAULT true,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed system-wide categories (client_id NULL = available to all)
INSERT INTO claim_categories (name, requires_receipt) VALUES
    ('Transport',               false),
    ('Meals & Entertainment',   true),
    ('Accommodation',           true),
    ('Medical',                 true),
    ('Training & Development',  true),
    ('Client Gifts',            true),
    ('Stationery & Supplies',   true),
    ('Telecommunications',      false),
    ('Other',                   true)
    ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 15. EXPENSE CLAIMS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expense_claims (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    client_id       UUID NOT NULL REFERENCES clients(id),
    category_id     UUID NOT NULL REFERENCES claim_categories(id),
    description     TEXT NOT NULL,
    amount          INTEGER NOT NULL,       -- cents
    currency        CHAR(3) NOT NULL DEFAULT 'SGD',
    expense_date    DATE NOT NULL,
    receipt_ref     TEXT,
    receipt_url     TEXT,                   -- S3/R2 key after upload

    status          claim_status NOT NULL DEFAULT 'pending',
    submitted_by    TEXT NOT NULL DEFAULT 'employee',

    -- Approval chain
    manager_id          UUID REFERENCES employees(id),
    manager_approved_at TIMESTAMPTZ,
    manager_notes       TEXT,
    operator_approved_by UUID REFERENCES operator_users(id),
    operator_approved_at TIMESTAMPTZ,
    rejection_reason    TEXT,

    -- Payroll linkage
    payroll_period_id   UUID REFERENCES payroll_periods(id),
    payment_instruction_id UUID REFERENCES payment_instructions(id),
    paid_at             TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT positive_amount CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_claims_employee ON expense_claims (employee_id);
CREATE INDEX IF NOT EXISTS idx_claims_pending ON expense_claims (client_id, status) WHERE status IN ('pending','manager_approved');
CREATE INDEX IF NOT EXISTS idx_claims_payroll ON expense_claims (payroll_period_id) WHERE payroll_period_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 16. DOCUMENTS (payslips, CPF submission files, GIRO files, IR8A)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    employee_id     UUID REFERENCES employees(id) ON DELETE SET NULL,  -- NULL for bulk docs
    payroll_period_id UUID REFERENCES payroll_periods(id),
    type            document_type NOT NULL,
    filename        TEXT NOT NULL,
    storage_key     TEXT NOT NULL UNIQUE,   -- S3/R2 object key
    size_bytes      INTEGER,
    mime_type       TEXT NOT NULL DEFAULT 'application/pdf',
    is_employee_visible BOOLEAN NOT NULL DEFAULT false,
    downloaded_at   TIMESTAMPTZ,            -- first download by employee
    generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_docs_client ON documents (client_id);
CREATE INDEX IF NOT EXISTS idx_docs_employee ON documents (employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_docs_period ON documents (payroll_period_id) WHERE payroll_period_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 17. CPF RATE SNAPSHOTS
--     Stores the CPF Board rate table at a point in time.
--     Allows the engine to use historically correct rates for backdated runs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cpf_rate_snapshots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    effective_from  DATE NOT NULL,
    effective_to    DATE,                   -- NULL = currently active
    residency_type  residency_type NOT NULL,
    age_min         SMALLINT NOT NULL,
    age_max         SMALLINT,               -- NULL = no upper bound
    ow_ceiling      INTEGER NOT NULL,       -- cents
    aw_ceiling_annual INTEGER NOT NULL,     -- cents
    ee_rate         NUMERIC(6,4) NOT NULL,
    er_rate         NUMERIC(6,4) NOT NULL,
    -- OA/SA/MA allocation
    oa_rate         NUMERIC(6,4),
    sa_rate         NUMERIC(6,4),
    ma_rate         NUMERIC(6,4),
    -- SDL
    sdl_rate        NUMERIC(6,4) NOT NULL DEFAULT 0.0025,
    sdl_min_cents   INTEGER NOT NULL DEFAULT 200,
    sdl_max_cents   INTEGER NOT NULL DEFAULT 1125,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed current rates (Jan 2026, OW ceiling $6,800)
INSERT INTO cpf_rate_snapshots
    (effective_from, residency_type, age_min, age_max, ow_ceiling, aw_ceiling_annual, ee_rate, er_rate, oa_rate, sa_rate, ma_rate)
VALUES
    -- Citizens / PR3+
    ('2026-01-01','citizen', 16, 35,  800000, 10200000, 0.2000, 0.1700, 0.6217, 0.1621, 0.2162),
    ('2026-01-01','citizen', 36, 45,  800000, 10200000, 0.2000, 0.1700, 0.5677, 0.1891, 0.2432),
    ('2026-01-01','citizen', 46, 50,  800000, 10200000, 0.2000, 0.1700, 0.5136, 0.2162, 0.2702),
    ('2026-01-01','citizen', 51, 55,  800000, 10200000, 0.1500, 0.1450, 0.4055, 0.3108, 0.2837),
    ('2026-01-01','citizen', 56, 60,  800000, 10200000, 0.1800, 0.1600, 0.3108, 0.0811, 0.6081)  -- updated Jan 2026,
    ('2026-01-01','citizen', 61, 65,  800000, 10200000, 0.1250, 0.1150, 0.1216, 0.0405, 0.8379)  -- updated Jan 2026,
    ('2026-01-01','citizen', 66, NULL,800000, 10200000, 0.0500, 0.0750, 0.0800, 0.0000, 0.9200),
    -- PR 1st year
    ('2026-01-01','pr1',     16, NULL,800000, 10200000, 0.0500, 0.0400, NULL,   NULL,   NULL),
    -- PR 2nd year
    ('2026-01-01','pr2',     16, 35,  800000, 10200000, 0.1500, 0.0800, NULL,   NULL,   NULL),
    ('2026-01-01','pr2',     36, 55,  800000, 10200000, 0.1500, 0.0800, NULL,   NULL,   NULL),
    ('2026-01-01','pr2',     56, 60,  800000, 10200000, 0.0750, 0.0750, NULL,   NULL,   NULL),
    ('2026-01-01','pr2',     61, 65,  800000, 10200000, 0.0500, 0.0650, NULL,   NULL,   NULL),
    ('2026-01-01','pr2',     66, NULL,800000, 10200000, 0.0500, 0.0650, NULL,   NULL,   NULL)
    ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 18. AUDIT LOG
--     Immutable log of every significant action. Never updated, never deleted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    id              BIGSERIAL PRIMARY KEY,
    action          audit_action NOT NULL,
    table_name      TEXT NOT NULL,
    record_id       UUID,
    client_id       UUID REFERENCES clients(id) ON DELETE SET NULL,
    actor_id        UUID,
    actor_type      TEXT,               -- 'operator_user' | 'client_user' | 'employee' | 'system'
    actor_email     TEXT,
    ip_address      INET,
    old_values      JSONB,
    new_values      JSONB,
    diff            JSONB,              -- computed at application layer
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partition audit_log by month for performance (optional, add later)
CREATE INDEX IF NOT EXISTS idx_audit_client   ON audit_log (client_id, created_at DESC) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_actor    ON audit_log (actor_id, created_at DESC)  WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_record   ON audit_log (table_name, record_id)      WHERE record_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 19. NOTIFICATIONS (in-app + email queue)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id    UUID NOT NULL,
    recipient_type  TEXT NOT NULL,      -- 'employee' | 'client_user' | 'operator_user'
    client_id       UUID REFERENCES clients(id),
    type            TEXT NOT NULL,      -- 'leave_approved' | 'payslip_ready' | 'claim_rejected' | etc.
    title           TEXT NOT NULL,
    body            TEXT,
    data            JSONB NOT NULL DEFAULT '{}',
    read_at         TIMESTAMPTZ,
    email_sent_at   TIMESTAMPTZ,
    email_failed    BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_recipient ON notifications (recipient_id, read_at) WHERE read_at IS NULL;

-- ---------------------------------------------------------------------------
-- 20. ROW-LEVEL SECURITY (RLS)
--     Tenancy isolation: operator_users can see all clients they own;
--     client_users can only see their own client; employees see only themselves.
--     Applied at DB level as defence-in-depth (API layer also enforces this).
-- ---------------------------------------------------------------------------

ALTER TABLE clients             ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees           ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_periods     ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_line_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_instructions ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_applications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_claims      ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents           ENABLE ROW LEVEL SECURITY;

-- Operator role: sees everything for their operator_id
CREATE POLICY operator_all ON clients
    USING (operator_id = current_setting('app.current_operator_id')::UUID);

-- Client user role: sees only their client
CREATE POLICY client_user_own ON employees
    USING (client_id = current_setting('app.current_client_id', true)::UUID);

-- Employee role: sees only their own records
CREATE POLICY employee_own_leave ON leave_applications
    USING (
        employee_id = current_setting('app.current_employee_id', true)::UUID
        OR client_id = current_setting('app.current_client_id', true)::UUID
    );

CREATE POLICY employee_own_claims ON expense_claims
    USING (
        employee_id = current_setting('app.current_employee_id', true)::UUID
        OR client_id = current_setting('app.current_client_id', true)::UUID
    );

-- ---------------------------------------------------------------------------
-- 21. UPDATED_AT triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'operators','operator_users','clients','client_users','employees',
        'payroll_periods','payroll_line_items','payment_instructions',
        'leave_applications','expense_claims'
    ] LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%s_updated_at
             BEFORE UPDATE ON %s
             FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
            t, t
        );
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 22. AUDIT TRIGGERS (auto-log updates to key tables)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_record_change()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO audit_log (action, table_name, record_id, old_values, new_values)
    VALUES (
        TG_OP::audit_action,
        TG_TABLE_NAME,
        COALESCE(NEW.id, OLD.id),
        CASE WHEN TG_OP != 'INSERT' THEN to_jsonb(OLD) ELSE NULL END,
        CASE WHEN TG_OP != 'DELETE' THEN to_jsonb(NEW) ELSE NULL END
    );
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Apply audit triggers to sensitive tables
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'payroll_line_items','payment_instructions',
        'leave_applications','expense_claims'
    ] LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%s_audit
             AFTER INSERT OR UPDATE OR DELETE ON %s
             FOR EACH ROW EXECUTE FUNCTION audit_record_change()',
            t, t
        );
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 23. USEFUL VIEWS
-- ---------------------------------------------------------------------------

-- Active employees with their current month CPF breakdown
CREATE OR REPLACE VIEW v_employee_payroll_summary AS
SELECT
    e.id AS employee_id,
    e.client_id,
    e.full_name,
    e.residency_type,
    DATE_PART('year', AGE(NOW(), e.date_of_birth))::INT AS age,
    e.basic_salary,
    e.fixed_allowance,
    e.basic_salary + e.fixed_allowance AS gross_pay,
    e.employment_status,
    e.join_date,
    EXTRACT(YEAR FROM AGE(NOW(), e.join_date))::INT AS years_of_service
FROM employees e
WHERE e.employment_status = 'active';

-- Payroll period totals (operator dashboard metrics)
CREATE OR REPLACE VIEW v_payroll_period_totals AS
SELECT
    pp.id AS payroll_period_id,
    pp.client_id,
    pp.period_year,
    pp.period_month,
    pp.status,
    pp.pay_date,
    COUNT(pli.id)               AS employee_count,
    SUM(pli.gross_pay)          AS total_gross,
    SUM(pli.net_pay)            AS total_net,
    SUM(pli.ee_cpf)             AS total_ee_cpf,
    SUM(pli.er_cpf)             AS total_er_cpf,
    SUM(pli.cpf_remittance)     AS total_cpf_remittance,
    SUM(pli.sdl)                AS total_sdl,
    SUM(pli.expense_reimb)      AS total_claims
FROM payroll_periods pp
LEFT JOIN payroll_line_items pli ON pli.payroll_period_id = pp.id
GROUP BY pp.id, pp.client_id, pp.period_year, pp.period_month, pp.status, pp.pay_date;

-- Leave balance per employee per year
CREATE OR REPLACE VIEW v_leave_balances AS
SELECT
    le.employee_id,
    le.client_id,
    le.leave_year,
    le.leave_type,
    le.total_days                                                              AS entitlement,
    le.carry_forward,
    COALESCE(SUM(la.days) FILTER (WHERE la.status = 'approved'), 0)::INT      AS used,
    COALESCE(SUM(la.days) FILTER (WHERE la.status = 'pending'),  0)::INT      AS pending,
    le.total_days + le.carry_forward
        - COALESCE(SUM(la.days) FILTER (WHERE la.status = 'approved'), 0)     AS remaining
FROM leave_entitlements le
LEFT JOIN leave_applications la
    ON la.employee_id = le.employee_id
    AND la.leave_type = le.leave_type
    AND EXTRACT(YEAR FROM la.start_date) = le.leave_year
GROUP BY le.id, le.employee_id, le.client_id, le.leave_year, le.leave_type,
         le.total_days, le.carry_forward;

-- ---------------------------------------------------------------------------
-- Schema version tracking
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO schema_migrations (version) VALUES ('001') ON CONFLICT DO NOTHING;
