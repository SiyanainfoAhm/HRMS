-- Night Allowance hourly rate master + monthly snapshot columns
-- Mirrors: backend/database/migrations/2026_07_23_100000_night_allowance_rates.php

CREATE TABLE IF NOT EXISTS cirt_night_allowance_rates (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL,
    slab_no INTEGER NOT NULL,
    pay_level SMALLINT NOT NULL,
    rate_per_hour NUMERIC(12, 2) NOT NULL,
    effective_from DATE NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NULL,
    updated_at TIMESTAMP NULL,
    UNIQUE (company_id, slab_no)
);

CREATE INDEX IF NOT EXISTS idx_night_allowance_rates_company_level
    ON cirt_night_allowance_rates (company_id, pay_level, is_active);

ALTER TABLE cirt_payroll_master
    ADD COLUMN IF NOT EXISTS night_allowance_slab_no INTEGER NULL;

ALTER TABLE cirt_monthly_payroll
    ADD COLUMN IF NOT EXISTS night_hours NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS night_allowance_rate NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS night_allowance_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS night_allowance_slab_no INTEGER NULL,
    ADD COLUMN IF NOT EXISTS night_allowance_manual_override BOOLEAN NOT NULL DEFAULT FALSE;
