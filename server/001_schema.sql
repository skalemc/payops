-- PayOps Schema (simplified, idempotent)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enums
DO $types$ BEGIN
  CREATE TYPE residency_type     AS ENUM ('citizen','pr1','pr2','pr3','ep','spass','wp','other');
  CREATE TYPE employment_status  AS ENUM ('active','inactive','terminated','on_leave');
  CREATE TYPE client_status      AS ENUM ('active','pending_setup','suspended','offboarded');
  CREATE TYPE payroll_run_status AS ENUM ('draft','computed','approved','paid','voided');
  CREATE TYPE payment_status     AS ENUM ('pending','initiated','confirmed','failed');
  CREATE TYPE leave_type         AS ENUM ('annual','medical','hospitalisation','maternity','paternity','childcare','npl','other');
  CREATE TYPE leave_status       AS ENUM ('pending','approved','rejected','cancelled','withdrawn');
  CREATE TYPE claim_status       AS ENUM ('pending','manager_approved','operator_approved','rejected','paid');
  CREATE TYPE document_type      AS ENUM ('payslip','ir8a','cpf_submission','giro_file','payment_instruction','other');
  CREATE TYPE audit_action       AS ENUM ('create','update','delete','approve','reject','lock','void','login','export');
EXCEPTION WHEN duplicate_object THEN NULL;
END $types$;

CREATE TABLE IF NOT EXISTS operators (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE,
    phone       TEXT,
    uen         TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    settings    JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operator_users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
    email       TEXT NOT NULL UNIQUE,
    full_name   TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'operator',
    is_active   BOOLEAN NOT NULL DEFAULT true,
    last_login_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clients (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operator_id     UUID NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
    name            TEXT NOT NULL,
    uen             TEXT NOT NULL,
    industry        TEXT,
    status          client_status NOT NULL DEFAULT 'pending_setup',
    contact_name    TEXT,
    contact_email   TEXT,
    contact_phone   TEXT,
    bank_name       TEXT,
    bank_account    TEXT,
    airwallex_account_id TEXT,
    payroll_day     SMALLINT NOT NULL DEFAULT 28,
    pay_currency    CHAR(3) NOT NULL DEFAULT 'SGD',
    cpf_submission_mode TEXT NOT NULL DEFAULT 'file',
    is_cpf_registered BOOLEAN NOT NULL DEFAULT true,
    has_foreign_workers BOOLEAN NOT NULL DEFAULT false,
    settings        JSONB NOT NULL DEFAULT '{}',
    onboarded_at    DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (operator_id, uen)
);

CREATE TABLE IF NOT EXISTS client_users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    email       TEXT NOT NULL UNIQUE,
    full_name   TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'hr_admin',
    is_active   BOOLEAN NOT NULL DEFAULT true,
    last_login_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employees (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    full_name           TEXT NOT NULL,
    nric_masked         TEXT NOT NULL,
    date_of_birth       DATE NOT NULL,
    residency_type      residency_type NOT NULL DEFAULT 'citizen',
    nationality         TEXT,
    designation         TEXT NOT NULL,
    department          TEXT,
    employment_status   employment_status NOT NULL DEFAULT 'active',
    join_date           DATE NOT NULL,
    termination_date    DATE,
    work_email          TEXT UNIQUE,
    manager_id          UUID REFERENCES employees(id),
    basic_salary        INTEGER NOT NULL,
    fixed_allowance     INTEGER NOT NULL DEFAULT 0,
    pay_mode            TEXT NOT NULL DEFAULT 'bank_transfer',
    bank_name           TEXT,
    bank_account        TEXT,
    cpf_aw_ceiling_used INTEGER NOT NULL DEFAULT 0,
    cpf_total_ow_ytd    INTEGER NOT NULL DEFAULT 0,
    portal_enabled      BOOLEAN NOT NULL DEFAULT false,
    portal_last_login   TIMESTAMPTZ,
    employee_code       TEXT,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employees_client ON employees(client_id);

CREATE TABLE IF NOT EXISTS auth_otps (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT NOT NULL,
    otp_hash    TEXT NOT NULL,
    user_type   TEXT NOT NULL,
    attempts    SMALLINT NOT NULL DEFAULT 0,
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_otps_email ON auth_otps(email);

CREATE TABLE IF NOT EXISTS sessions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL,
    user_type   TEXT NOT NULL,
    token_hash  TEXT NOT NULL UNIQUE,
    ip_address  INET,
    user_agent  TEXT,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payroll_periods (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    period_year     SMALLINT NOT NULL,
    period_month    SMALLINT NOT NULL,
    pay_date        DATE NOT NULL,
    cpf_due_date    DATE NOT NULL,
    status          payroll_run_status NOT NULL DEFAULT 'draft',
    locked_at       TIMESTAMPTZ,
    locked_by       UUID REFERENCES operator_users(id),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (client_id, period_year, period_month)
);

CREATE TABLE IF NOT EXISTS payroll_line_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payroll_period_id   UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
    employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    client_id           UUID NOT NULL REFERENCES clients(id),
    ordinary_wage       INTEGER NOT NULL,
    ordinary_wage_capped INTEGER NOT NULL,
    additional_wage     INTEGER NOT NULL DEFAULT 0,
    aw_cpf_liable       INTEGER NOT NULL DEFAULT 0,
    gross_pay           INTEGER NOT NULL,
    expense_reimb       INTEGER NOT NULL DEFAULT 0,
    ee_cpf              INTEGER NOT NULL,
    er_cpf              INTEGER NOT NULL,
    cpf_remittance      INTEGER NOT NULL,
    sdl                 INTEGER NOT NULL,
    net_pay             INTEGER NOT NULL,
    ee_rate             NUMERIC(6,4) NOT NULL,
    er_rate             NUMERIC(6,4) NOT NULL,
    ow_ceiling          INTEGER NOT NULL,
    days_worked         SMALLINT,
    total_days_in_month SMALLINT NOT NULL DEFAULT 31,
    npl_days            SMALLINT NOT NULL DEFAULT 0,
    is_locked           BOOLEAN NOT NULL DEFAULT false,
    cpf_oa              INTEGER,
    cpf_sa              INTEGER,
    cpf_ma              INTEGER,
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (payroll_period_id, employee_id)
);

CREATE TABLE IF NOT EXISTS payment_instructions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payroll_period_id   UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
    client_id           UUID NOT NULL REFERENCES clients(id),
    type                TEXT NOT NULL,
    reference_number    TEXT NOT NULL UNIQUE,
    total_amount        INTEGER NOT NULL,
    currency            CHAR(3) NOT NULL DEFAULT 'SGD',
    payment_status      payment_status NOT NULL DEFAULT 'pending',
    airwallex_url       TEXT,
    airwallex_payment_id TEXT,
    payee               TEXT,
    payee_uen           TEXT,
    due_date            DATE NOT NULL,
    paid_at             TIMESTAMPTZ,
    paid_by             UUID REFERENCES operator_users(id),
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_instruction_lines (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_instruction_id  UUID NOT NULL REFERENCES payment_instructions(id) ON DELETE CASCADE,
    employee_id             UUID NOT NULL REFERENCES employees(id),
    payroll_line_item_id    UUID NOT NULL REFERENCES payroll_line_items(id),
    amount                  INTEGER NOT NULL,
    bank_name               TEXT,
    bank_account            TEXT,
    reference               TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leave_entitlements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    client_id       UUID NOT NULL REFERENCES clients(id),
    leave_year      SMALLINT NOT NULL,
    leave_type      leave_type NOT NULL,
    total_days      SMALLINT NOT NULL,
    statutory_days  SMALLINT NOT NULL,
    carry_forward   SMALLINT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (employee_id, leave_year, leave_type)
);

CREATE TABLE IF NOT EXISTS leave_applications (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    client_id           UUID NOT NULL REFERENCES clients(id),
    leave_type          leave_type NOT NULL,
    start_date          DATE NOT NULL,
    end_date            DATE NOT NULL,
    days                SMALLINT NOT NULL,
    reason              TEXT,
    status              leave_status NOT NULL DEFAULT 'pending',
    submitted_by        TEXT NOT NULL DEFAULT 'employee',
    manager_id          UUID REFERENCES employees(id),
    manager_approved_at TIMESTAMPTZ,
    manager_notes       TEXT,
    operator_approved_by UUID REFERENCES operator_users(id),
    operator_approved_at TIMESTAMPTZ,
    rejection_reason    TEXT,
    payroll_period_id   UUID REFERENCES payroll_periods(id),
    affects_payroll     BOOLEAN NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leave_employee ON leave_applications(employee_id);

CREATE TABLE IF NOT EXISTS claim_categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       UUID REFERENCES clients(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    requires_receipt BOOLEAN NOT NULL DEFAULT true,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO claim_categories (name, requires_receipt) VALUES
    ('Transport',              false),
    ('Meals & Entertainment',  true),
    ('Accommodation',          true),
    ('Medical',                true),
    ('Training & Development', true),
    ('Client Gifts',           true),
    ('Stationery & Supplies',  true),
    ('Telecommunications',     false),
    ('Other',                  true)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS expense_claims (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    client_id           UUID NOT NULL REFERENCES clients(id),
    category_id         UUID NOT NULL REFERENCES claim_categories(id),
    description         TEXT NOT NULL,
    amount              INTEGER NOT NULL,
    currency            CHAR(3) NOT NULL DEFAULT 'SGD',
    expense_date        DATE NOT NULL,
    receipt_ref         TEXT,
    receipt_url         TEXT,
    status              claim_status NOT NULL DEFAULT 'pending',
    submitted_by        TEXT NOT NULL DEFAULT 'employee',
    manager_id          UUID REFERENCES employees(id),
    manager_approved_at TIMESTAMPTZ,
    manager_notes       TEXT,
    operator_approved_by UUID REFERENCES operator_users(id),
    operator_approved_at TIMESTAMPTZ,
    rejection_reason    TEXT,
    payroll_period_id   UUID REFERENCES payroll_periods(id),
    payment_instruction_id UUID REFERENCES payment_instructions(id),
    paid_at             TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    employee_id         UUID REFERENCES employees(id) ON DELETE SET NULL,
    payroll_period_id   UUID REFERENCES payroll_periods(id),
    type                document_type NOT NULL,
    filename            TEXT NOT NULL,
    storage_key         TEXT NOT NULL UNIQUE,
    size_bytes          INTEGER,
    mime_type           TEXT NOT NULL DEFAULT 'application/pdf',
    is_employee_visible BOOLEAN NOT NULL DEFAULT false,
    generated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cpf_rate_snapshots (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    effective_from      DATE NOT NULL,
    effective_to        DATE,
    residency_type      residency_type NOT NULL,
    age_min             SMALLINT NOT NULL,
    age_max             SMALLINT,
    ow_ceiling          INTEGER NOT NULL,
    aw_ceiling_annual   INTEGER NOT NULL,
    ee_rate             NUMERIC(6,4) NOT NULL,
    er_rate             NUMERIC(6,4) NOT NULL,
    oa_rate             NUMERIC(6,4),
    sa_rate             NUMERIC(6,4),
    ma_rate             NUMERIC(6,4),
    sdl_rate            NUMERIC(6,4) NOT NULL DEFAULT 0.0025,
    sdl_min_cents       INTEGER NOT NULL DEFAULT 200,
    sdl_max_cents       INTEGER NOT NULL DEFAULT 1125,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO cpf_rate_snapshots
    (effective_from, residency_type, age_min, age_max, ow_ceiling, aw_ceiling_annual, ee_rate, er_rate, oa_rate, sa_rate, ma_rate)
VALUES
    ('2026-01-01','citizen', 16, 35,  800000, 10200000, 0.2000, 0.1700, 0.6217, 0.1621, 0.2162),
    ('2026-01-01','citizen', 36, 45,  800000, 10200000, 0.2000, 0.1700, 0.5677, 0.1891, 0.2432),
    ('2026-01-01','citizen', 46, 50,  800000, 10200000, 0.2000, 0.1700, 0.5136, 0.2162, 0.2702),
    ('2026-01-01','citizen', 51, 55,  800000, 10200000, 0.1500, 0.1450, 0.4055, 0.3108, 0.2837),
    ('2026-01-01','citizen', 56, 60,  800000, 10200000, 0.1800, 0.1600, 0.3108, 0.0811, 0.6081),
    ('2026-01-01','citizen', 61, 65,  800000, 10200000, 0.1250, 0.1150, 0.1216, 0.0405, 0.8379),
    ('2026-01-01','citizen', 66, NULL,800000, 10200000, 0.0500, 0.0750, 0.0800, 0.0000, 0.9200),
    ('2026-01-01','pr1',     16, NULL,800000, 10200000, 0.0500, 0.0400, NULL,   NULL,   NULL),
    ('2026-01-01','pr2',     16, 35,  800000, 10200000, 0.1500, 0.0800, NULL,   NULL,   NULL),
    ('2026-01-01','pr2',     36, 55,  800000, 10200000, 0.1500, 0.0800, NULL,   NULL,   NULL),
    ('2026-01-01','pr2',     56, 60,  800000, 10200000, 0.0750, 0.0750, NULL,   NULL,   NULL),
    ('2026-01-01','pr2',     61, 65,  800000, 10200000, 0.0500, 0.0650, NULL,   NULL,   NULL),
    ('2026-01-01','pr2',     66, NULL,800000, 10200000, 0.0500, 0.0650, NULL,   NULL,   NULL)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS audit_log (
    id          BIGSERIAL PRIMARY KEY,
    action      audit_action NOT NULL,
    table_name  TEXT NOT NULL,
    record_id   UUID,
    client_id   UUID REFERENCES clients(id) ON DELETE SET NULL,
    actor_id    UUID,
    actor_type  TEXT,
    actor_email TEXT,
    ip_address  INET,
    old_values  JSONB,
    new_values  JSONB,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id    UUID NOT NULL,
    recipient_type  TEXT NOT NULL,
    client_id       UUID REFERENCES clients(id),
    type            TEXT NOT NULL,
    title           TEXT NOT NULL,
    body            TEXT,
    data            JSONB NOT NULL DEFAULT '{}',
    read_at         TIMESTAMPTZ,
    email_sent_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $triggers$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'operators','operator_users','clients','client_users','employees',
    'payroll_periods','payroll_line_items','payment_instructions',
    'leave_applications','expense_claims'
  ] LOOP
    EXECUTE format('
      DROP TRIGGER IF EXISTS trg_%s_updated_at ON %s;
      CREATE TRIGGER trg_%s_updated_at
      BEFORE UPDATE ON %s
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t, t, t, t);
  END LOOP;
END $triggers$;

CREATE OR REPLACE VIEW v_payroll_period_totals AS
SELECT
    pp.id AS payroll_period_id,
    pp.client_id,
    pp.period_year,
    pp.period_month,
    pp.status,
    pp.pay_date,
    COUNT(pli.id)           AS employee_count,
    SUM(pli.gross_pay)      AS total_gross,
    SUM(pli.net_pay)        AS total_net,
    SUM(pli.ee_cpf)         AS total_ee_cpf,
    SUM(pli.er_cpf)         AS total_er_cpf,
    SUM(pli.cpf_remittance) AS total_cpf_remittance,
    SUM(pli.sdl)            AS total_sdl,
    SUM(pli.expense_reimb)  AS total_claims
FROM payroll_periods pp
LEFT JOIN payroll_line_items pli ON pli.payroll_period_id = pp.id
GROUP BY pp.id, pp.client_id, pp.period_year, pp.period_month, pp.status, pp.pay_date;

CREATE OR REPLACE VIEW v_leave_balances AS
SELECT
    le.employee_id,
    le.client_id,
    le.leave_year,
    le.leave_type,
    le.total_days AS entitlement,
    le.carry_forward,
    COALESCE(SUM(la.days) FILTER (WHERE la.status = 'approved'), 0)::INT AS used,
    COALESCE(SUM(la.days) FILTER (WHERE la.status = 'pending'),  0)::INT AS pending,
    le.total_days + le.carry_forward
        - COALESCE(SUM(la.days) FILTER (WHERE la.status = 'approved'), 0) AS remaining
FROM leave_entitlements le
LEFT JOIN leave_applications la
    ON la.employee_id = le.employee_id
    AND la.leave_type = le.leave_type
    AND EXTRACT(YEAR FROM la.start_date) = le.leave_year
GROUP BY le.id, le.employee_id, le.client_id, le.leave_year, le.leave_type,
         le.total_days, le.carry_forward;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO schema_migrations (version) VALUES ('001') ON CONFLICT DO NOTHING;
