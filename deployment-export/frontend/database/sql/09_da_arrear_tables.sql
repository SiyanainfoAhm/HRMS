-- DA arrear tables (mirrors backend/database/migrations/2026_06_16_100000_create_da_arrear_tables.php)

CREATE TABLE IF NOT EXISTS cirt_da_revision_events (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL,
    old_da_percent NUMERIC(5,2) NOT NULL,
    new_da_percent NUMERIC(5,2) NOT NULL,
    effective_from DATE NOT NULL,
    revision_reason TEXT NULL,
    created_by UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cirt_da_revision_events_company_id_idx ON cirt_da_revision_events(company_id);

CREATE TABLE IF NOT EXISTS cirt_payroll_arrear_batches (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL,
    payroll_period_id UUID NULL,
    da_revision_event_id UUID NOT NULL,
    run_month SMALLINT NOT NULL,
    run_year SMALLINT NOT NULL,
    arrear_from DATE NOT NULL,
    arrear_to DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    total_da_arrear NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_transport_arrear NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_gross_arrear NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_cpf_arrear NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_net_arrear NUMERIC(14,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, da_revision_event_id, run_year, run_month)
);

CREATE TABLE IF NOT EXISTS cirt_payroll_arrear_lines (
    id UUID PRIMARY KEY,
    arrear_batch_id UUID NOT NULL,
    payroll_period_id UUID NULL,
    employee_user_id UUID NOT NULL,
    arrear_month SMALLINT NOT NULL,
    arrear_year SMALLINT NOT NULL,
    basic NUMERIC(14,2) NOT NULL DEFAULT 0,
    transport_base NUMERIC(14,2) NOT NULL DEFAULT 0,
    old_da_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
    new_da_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
    old_da_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    new_da_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    da_arrear NUMERIC(14,2) NOT NULL DEFAULT 0,
    old_transport_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    new_transport_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    transport_arrear NUMERIC(14,2) NOT NULL DEFAULT 0,
    gross_arrear NUMERIC(14,2) NOT NULL DEFAULT 0,
    cpf_rate NUMERIC(5,2) NOT NULL DEFAULT 12,
    cpf_arrear NUMERIC(14,2) NOT NULL DEFAULT 0,
    net_arrear NUMERIC(14,2) NOT NULL DEFAULT 0,
    source_monthly_payroll_id UUID NULL,
    old_payroll_master_id UUID NULL,
    new_payroll_master_id UUID NULL,
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    da_revision_event_id UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (employee_user_id, arrear_month, arrear_year, arrear_batch_id),
    UNIQUE (employee_user_id, arrear_year, arrear_month, da_revision_event_id)
);

ALTER TABLE cirt_monthly_payroll ADD COLUMN IF NOT EXISTS gross_arrear NUMERIC(14,2) DEFAULT 0;
ALTER TABLE cirt_monthly_payroll ADD COLUMN IF NOT EXISTS cpf_arrear NUMERIC(14,2) DEFAULT 0;
ALTER TABLE cirt_monthly_payroll ADD COLUMN IF NOT EXISTS net_arrear NUMERIC(14,2) DEFAULT 0;
ALTER TABLE cirt_monthly_payroll ADD COLUMN IF NOT EXISTS arrear_batch_id UUID NULL;
