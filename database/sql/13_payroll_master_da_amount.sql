-- Store explicit DA amount on payroll master (independent of DA % when manually overridden).
ALTER TABLE cirt_payroll_master
  ADD COLUMN IF NOT EXISTS da_amount NUMERIC(12, 2);

UPDATE cirt_payroll_master
SET da_amount = ROUND(COALESCE(gross_basic_pay, gross_basic, gross_salary, 0) * COALESCE(da_percent, 53) / 100, 0)
WHERE da_amount IS NULL;

ALTER TABLE cirt_payroll_master_history
  ADD COLUMN IF NOT EXISTS da_amount NUMERIC(12, 2);
