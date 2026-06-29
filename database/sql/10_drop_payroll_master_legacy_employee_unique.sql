-- Drop legacy full unique indexes that block payroll master revisions (salary increment).
-- Run after 09_payroll_master_soft_revision_indexes.sql if increment still fails.

ALTER TABLE cirt_payroll_master DROP CONSTRAINT IF EXISTS ux_cirt_payroll_master_one_employee;
DROP INDEX IF EXISTS ux_cirt_payroll_master_one_employee;

ALTER TABLE cirt_payroll_master DROP CONSTRAINT IF EXISTS ux_cirt_payroll_master_one_current;
DROP INDEX IF EXISTS ux_cirt_payroll_master_one_current;

ALTER TABLE cirt_payroll_master DROP CONSTRAINT IF EXISTS ux_cirt_payroll_master_one_current_user;
DROP INDEX IF EXISTS ux_cirt_payroll_master_one_current_user;

-- Remove any remaining non-partial unique on (company_id, employee_user_id)
DO $$
DECLARE
  idx record;
BEGIN
  FOR idx IN
    SELECT c.conname AS name
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'cirt_payroll_master'
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) LIKE '%employee_user_id%'
      AND pg_get_constraintdef(c.oid) NOT LIKE '%effective_to%'
  LOOP
    EXECUTE format('ALTER TABLE cirt_payroll_master DROP CONSTRAINT IF EXISTS %I', idx.name);
  END LOOP;

  FOR idx IN
    SELECT indexname AS name
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'cirt_payroll_master'
      AND indexdef LIKE '%UNIQUE%'
      AND indexdef LIKE '%employee_user_id%'
      AND indexdef NOT LIKE '%effective_to%'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', idx.name);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_cirt_payroll_master_one_current
    ON cirt_payroll_master (company_id, employee_user_id)
    WHERE employee_user_id IS NOT NULL AND effective_to IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_cirt_payroll_master_one_current_user
    ON cirt_payroll_master (company_id, user_id)
    WHERE employee_user_id IS NULL AND user_id IS NOT NULL AND effective_to IS NULL;
