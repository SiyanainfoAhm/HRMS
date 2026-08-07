-- Per-employee CPF override columns on payroll master

ALTER TABLE cirt_payroll_master
    ADD COLUMN IF NOT EXISTS cpf_use_company_settings BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS cpf_percentage_override NUMERIC(8, 2) NULL,
    ADD COLUMN IF NOT EXISTS cpf_basis_field_keys_override JSONB NULL;
