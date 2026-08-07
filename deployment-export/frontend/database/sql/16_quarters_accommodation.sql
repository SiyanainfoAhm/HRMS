-- Government quarters / accommodation (run after payroll dynamic fields)

CREATE TABLE IF NOT EXISTS cirt_quarters (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL,
    quarter_name VARCHAR(128) NOT NULL,
    quarter_type VARCHAR(32) NOT NULL,
    monthly_rent NUMERIC(12, 2) NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'available',
    assigned_employee_id UUID NULL,
    assigned_from DATE NULL,
    assigned_to DATE NULL,
    created_by UUID NULL,
    created_at TIMESTAMP NULL,
    updated_at TIMESTAMP NULL,
    CONSTRAINT cirt_quarters_company_name_unique UNIQUE (company_id, quarter_name)
);

CREATE INDEX IF NOT EXISTS cirt_quarters_company_status_idx
    ON cirt_quarters (company_id, status);

CREATE INDEX IF NOT EXISTS cirt_quarters_assigned_employee_idx
    ON cirt_quarters (company_id, assigned_employee_id);

CREATE TABLE IF NOT EXISTS cirt_quarter_assignments (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL,
    quarter_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    assigned_from DATE NULL,
    assigned_to DATE NULL,
    rent_at_assignment NUMERIC(12, 2) NOT NULL DEFAULT 0,
    created_by UUID NULL,
    created_at TIMESTAMP NULL,
    updated_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS cirt_quarter_assignments_quarter_idx
    ON cirt_quarter_assignments (company_id, quarter_id);

ALTER TABLE cirt_payroll_master
    ADD COLUMN IF NOT EXISTS quarter_id UUID NULL,
    ADD COLUMN IF NOT EXISTS has_quarter BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS quarter_rent NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE cirt_monthly_payroll
    ADD COLUMN IF NOT EXISTS quarter_rent_amount NUMERIC(12, 2) NULL,
    ADD COLUMN IF NOT EXISTS has_quarter BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS quarter_id UUID NULL,
    ADD COLUMN IF NOT EXISTS quarter_name VARCHAR(128) NULL,
    ADD COLUMN IF NOT EXISTS quarter_type VARCHAR(32) NULL;
