-- Fix salary-increment / payroll-master revision unique violation.
-- Ensures only ONE open row (effective_to IS NULL) per employee, and that closed
-- revisions do not block INSERT of a new current master.
--
-- Run on production PostgreSQL if increment fails with:
--   duplicate key value violates unique constraint "ux_cirt_payroll_master_one_current"

-- 1) Heal duplicate open masters (keep newest).
WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY company_id, employee_user_id
            ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST, id DESC
        ) AS rn
    FROM cirt_payroll_master
    WHERE employee_user_id IS NOT NULL
      AND effective_to IS NULL
)
UPDATE cirt_payroll_master m
SET
    effective_to = COALESCE(m.effective_from, m.effective_start_date, CURRENT_DATE),
    effective_end_date = COALESCE(m.effective_from, m.effective_start_date, CURRENT_DATE),
    updated_at = NOW()
FROM ranked r
WHERE m.id = r.id
  AND r.rn > 1;

WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY company_id, user_id
            ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST, id DESC
        ) AS rn
    FROM cirt_payroll_master
    WHERE employee_user_id IS NULL
      AND user_id IS NOT NULL
      AND effective_to IS NULL
)
UPDATE cirt_payroll_master m
SET
    effective_to = COALESCE(m.effective_from, m.effective_start_date, CURRENT_DATE),
    effective_end_date = COALESCE(m.effective_from, m.effective_start_date, CURRENT_DATE),
    updated_at = NOW()
FROM ranked r
WHERE m.id = r.id
  AND r.rn > 1;

-- 2) Drop legacy / non-partial uniques.
ALTER TABLE cirt_payroll_master DROP CONSTRAINT IF EXISTS ux_cirt_payroll_master_one_employee;
DROP INDEX IF EXISTS ux_cirt_payroll_master_one_employee;

ALTER TABLE cirt_payroll_master DROP CONSTRAINT IF EXISTS ux_cirt_payroll_master_one_current;
DROP INDEX IF EXISTS ux_cirt_payroll_master_one_current;

ALTER TABLE cirt_payroll_master DROP CONSTRAINT IF EXISTS ux_cirt_payroll_master_one_current_user;
DROP INDEX IF EXISTS ux_cirt_payroll_master_one_current_user;

DO $$
DECLARE
  idx record;
BEGIN
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

-- 3) Recreate correct partial unique indexes.
CREATE UNIQUE INDEX IF NOT EXISTS ux_cirt_payroll_master_one_current
    ON cirt_payroll_master (company_id, employee_user_id)
    WHERE employee_user_id IS NOT NULL AND effective_to IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_cirt_payroll_master_one_current_user
    ON cirt_payroll_master (company_id, user_id)
    WHERE employee_user_id IS NULL AND user_id IS NOT NULL AND effective_to IS NULL;
