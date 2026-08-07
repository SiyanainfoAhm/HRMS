-- Payroll logic corrections (EOL/HPL reference, CPF mode, electricity units, quarter rent overrides)
-- Mirrors: backend/database/migrations/2026_07_22_100000_payroll_logic_corrections.php
-- Safe to run multiple times (IF NOT EXISTS).

-- Institute / payroll calculation settings
ALTER TABLE cirt_payroll_calculation_settings
    ADD COLUMN IF NOT EXISTS cpf_calculation_mode VARCHAR(32) NOT NULL DEFAULT 'percentage',
    ADD COLUMN IF NOT EXISTS cpf_fixed_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS electricity_unit_rate NUMERIC(12, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN cirt_payroll_calculation_settings.electricity_unit_rate IS
    'Global electricity per-unit rate (₹) used in Run Payroll: deduction = units × rate';

-- Per-employee CPF overrides on payroll master (run migration 2026_07_01 if these are missing)
ALTER TABLE cirt_payroll_master
    ADD COLUMN IF NOT EXISTS cpf_use_company_settings BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS cpf_percentage_override NUMERIC(8, 2) NULL,
    ADD COLUMN IF NOT EXISTS cpf_basis_field_keys_override JSONB NULL,
    ADD COLUMN IF NOT EXISTS cpf_calculation_mode VARCHAR(32) NULL,
    ADD COLUMN IF NOT EXISTS cpf_fixed_amount NUMERIC(12, 2) NULL;

-- Monthly payroll run snapshots
ALTER TABLE cirt_monthly_payroll
    ADD COLUMN IF NOT EXISTS eol_reference_month SMALLINT NULL,
    ADD COLUMN IF NOT EXISTS eol_reference_year SMALLINT NULL,
    ADD COLUMN IF NOT EXISTS hpl_reference_month SMALLINT NULL,
    ADD COLUMN IF NOT EXISTS hpl_reference_year SMALLINT NULL,
    ADD COLUMN IF NOT EXISTS eol_basis_amount NUMERIC(12, 2) NULL,
    ADD COLUMN IF NOT EXISTS hpl_basis_amount NUMERIC(12, 2) NULL,
    ADD COLUMN IF NOT EXISTS electricity_units_consumed NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS electricity_unit_rate NUMERIC(12, 2) NULL,
    ADD COLUMN IF NOT EXISTS electricity_manual_override BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS quarter_rent_manual_override BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS cpf_calculation_mode VARCHAR(32) NULL,
    ADD COLUMN IF NOT EXISTS cpf_fixed_amount NUMERIC(12, 2) NULL;

-- Backfill EOL/HPL reference month/year from payroll period where missing
UPDATE cirt_monthly_payroll
SET
    eol_reference_month = COALESCE(eol_reference_month, EXTRACT(MONTH FROM month_year)::int),
    eol_reference_year = COALESCE(eol_reference_year, EXTRACT(YEAR FROM month_year)::int),
    hpl_reference_month = COALESCE(hpl_reference_month, EXTRACT(MONTH FROM month_year)::int),
    hpl_reference_year = COALESCE(hpl_reference_year, EXTRACT(YEAR FROM month_year)::int)
WHERE month_year IS NOT NULL;
