-- Allow closed payroll master rows to remain (monthly payroll FK snapshots).
-- Only one open row (effective_to IS NULL) per employee per company.

ALTER TABLE cirt_payroll_master DROP CONSTRAINT IF EXISTS ux_cirt_payroll_master_one_employee;
DROP INDEX IF EXISTS ux_cirt_payroll_master_one_employee;

ALTER TABLE cirt_payroll_master DROP CONSTRAINT IF EXISTS ux_cirt_payroll_master_one_current;
DROP INDEX IF EXISTS ux_cirt_payroll_master_one_current;

ALTER TABLE cirt_payroll_master DROP CONSTRAINT IF EXISTS ux_cirt_payroll_master_one_current_user;
DROP INDEX IF EXISTS ux_cirt_payroll_master_one_current_user;

CREATE UNIQUE INDEX IF NOT EXISTS ux_cirt_payroll_master_one_current
    ON cirt_payroll_master (company_id, employee_user_id)
    WHERE employee_user_id IS NOT NULL AND effective_to IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_cirt_payroll_master_one_current_user
    ON cirt_payroll_master (company_id, user_id)
    WHERE employee_user_id IS NULL AND user_id IS NOT NULL AND effective_to IS NULL;
