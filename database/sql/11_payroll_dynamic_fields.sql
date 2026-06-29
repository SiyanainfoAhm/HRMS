-- Dynamic payroll fields + configurable CPF (run after 10_drop_payroll_master_legacy_employee_unique.sql)

CREATE TABLE IF NOT EXISTS cirt_payroll_field_definitions (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL,
    field_label VARCHAR(128) NOT NULL,
    field_key VARCHAR(64) NOT NULL,
    field_group VARCHAR(32) NOT NULL,
    field_type VARCHAR(32) NOT NULL DEFAULT 'number',
    calculation_type VARCHAR(32) NOT NULL DEFAULT 'manual_entry',
    default_value VARCHAR(255) NULL,
    dropdown_options JSONB NULL,
    is_required BOOLEAN NOT NULL DEFAULT FALSE,
    show_in_payroll_master BOOLEAN NOT NULL DEFAULT TRUE,
    show_in_run_payroll BOOLEAN NOT NULL DEFAULT TRUE,
    show_in_salary_slip BOOLEAN NOT NULL DEFAULT TRUE,
    include_in_total_earnings BOOLEAN NOT NULL DEFAULT FALSE,
    include_in_total_deductions BOOLEAN NOT NULL DEFAULT FALSE,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_by UUID NULL,
    created_at TIMESTAMP NULL,
    updated_at TIMESTAMP NULL,
    CONSTRAINT cirt_payroll_field_defs_company_key_unique UNIQUE (company_id, field_key)
);

CREATE INDEX IF NOT EXISTS cirt_payroll_field_defs_company_group_active_idx
    ON cirt_payroll_field_definitions (company_id, field_group, is_active);

CREATE TABLE IF NOT EXISTS cirt_payroll_field_values (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL,
    employee_id UUID NULL,
    payroll_master_id UUID NULL,
    payroll_period_id UUID NULL,
    field_definition_id UUID NOT NULL,
    field_key VARCHAR(64) NOT NULL,
    field_value TEXT NULL,
    created_at TIMESTAMP NULL,
    updated_at TIMESTAMP NULL,
    CONSTRAINT cirt_payroll_field_values_master_field_unique
        UNIQUE (company_id, payroll_master_id, field_definition_id)
);

CREATE INDEX IF NOT EXISTS cirt_payroll_field_values_master_idx
    ON cirt_payroll_field_values (company_id, payroll_master_id);

CREATE INDEX IF NOT EXISTS cirt_payroll_field_values_period_idx
    ON cirt_payroll_field_values (company_id, payroll_period_id, employee_id);

CREATE TABLE IF NOT EXISTS cirt_payroll_calculation_settings (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL UNIQUE,
    cpf_percentage NUMERIC(8, 2) NOT NULL DEFAULT 12,
    cpf_basis_field_keys JSONB NOT NULL,
    created_at TIMESTAMP NULL,
    updated_at TIMESTAMP NULL
);

ALTER TABLE cirt_monthly_payroll
    ADD COLUMN IF NOT EXISTS custom_earnings JSONB NULL,
    ADD COLUMN IF NOT EXISTS custom_deductions JSONB NULL;
