-- Night allowance basic pay ceiling (default ₹43,600) + monthly eligibility snapshot.

ALTER TABLE cirt_payroll_calculation_settings
    ADD COLUMN IF NOT EXISTS night_allowance_basic_ceiling NUMERIC(12, 2) NOT NULL DEFAULT 43600;

ALTER TABLE cirt_monthly_payroll
    ADD COLUMN IF NOT EXISTS night_allowance_basic_ceiling NUMERIC(12, 2) NULL,
    ADD COLUMN IF NOT EXISTS night_allowance_eligible BOOLEAN NOT NULL DEFAULT TRUE;
