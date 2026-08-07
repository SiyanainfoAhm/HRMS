-- HPL and EOL monthly payroll deductions only (not stored on payroll master)

ALTER TABLE cirt_monthly_payroll
    ADD COLUMN IF NOT EXISTS hpl_amount NUMERIC(12, 2) NULL,
    ADD COLUMN IF NOT EXISTS hpl_days SMALLINT NULL,
    ADD COLUMN IF NOT EXISTS eol_amount NUMERIC(12, 2) NULL,
    ADD COLUMN IF NOT EXISTS eol_days SMALLINT NULL;
