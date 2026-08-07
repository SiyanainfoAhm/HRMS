-- CIRT Payroll: increment month on payroll master + salary increment history
-- Run after prior CIRT schema scripts.

ALTER TABLE cirt_payroll_master
    ADD COLUMN IF NOT EXISTS increment_month VARCHAR(16) NOT NULL DEFAULT 'July';

UPDATE cirt_payroll_master
SET increment_month = 'July'
WHERE increment_month IS NULL OR TRIM(increment_month) = '';

ALTER TABLE cirt_payroll_master_history
    ADD COLUMN IF NOT EXISTS increment_month VARCHAR(16) NOT NULL DEFAULT 'July';

UPDATE cirt_payroll_master_history
SET increment_month = 'July'
WHERE increment_month IS NULL OR TRIM(increment_month) = '';

CREATE TABLE IF NOT EXISTS cirt_salary_increments (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL,
    employee_id UUID NULL,
    employee_user_id UUID NULL,
    employee_code VARCHAR(64) NULL,
    increment_month VARCHAR(16) NOT NULL,
    effective_start_date DATE NOT NULL,
    old_gross_basic NUMERIC(14, 2) NOT NULL,
    increment_percentage NUMERIC(8, 2) NOT NULL,
    increment_amount NUMERIC(14, 2) NOT NULL,
    new_gross_basic NUMERIC(14, 2) NOT NULL,
    applied_by UUID NULL,
    applied_at TIMESTAMPTZ NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'applied',
    notes TEXT NULL,
    created_at TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS cirt_salary_increments_emp_effective_unique
    ON cirt_salary_increments (company_id, employee_user_id, effective_start_date);

CREATE INDEX IF NOT EXISTS cirt_salary_increments_company_effective_idx
    ON cirt_salary_increments (company_id, effective_start_date);

CREATE INDEX IF NOT EXISTS cirt_salary_increments_company_month_idx
    ON cirt_salary_increments (company_id, increment_month);
