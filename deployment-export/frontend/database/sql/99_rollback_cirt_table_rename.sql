-- =============================================================================
-- CIRT Payroll — rollback: rename cirt_* tables back to HRMS_* (idempotent)
-- Preserves data. Does NOT recreate tables dropped by 03_drop_unused_hrms_tables.sql.
-- Restore dropped module tables only from a database backup.
-- =============================================================================

BEGIN;

-- Enum rollback: cirt_role_key -> hrms_role_key
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE n.nspname = 'public' AND t.typname = 'cirt_role_key')
     AND NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                     WHERE n.nspname = 'public' AND t.typname = 'hrms_role_key') THEN
    ALTER TYPE public.cirt_role_key RENAME TO hrms_role_key;
    RAISE NOTICE 'Renamed type cirt_role_key to hrms_role_key';
  ELSE
    RAISE NOTICE 'Skipped type cirt_role_key rollback';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.cirt_payslips') IS NOT NULL
     AND to_regclass('public."HRMS_payslips"') IS NULL THEN
    ALTER TABLE public.cirt_payslips RENAME TO "HRMS_payslips";
    RAISE NOTICE 'Renamed cirt_payslips to HRMS_payslips';
  ELSE RAISE NOTICE 'Skipped cirt_payslips'; END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.cirt_monthly_payroll') IS NOT NULL
     AND to_regclass('public."HRMS_government_monthly_payroll"') IS NULL THEN
    ALTER TABLE public.cirt_monthly_payroll RENAME TO "HRMS_government_monthly_payroll";
    RAISE NOTICE 'Renamed cirt_monthly_payroll to HRMS_government_monthly_payroll';
  ELSE RAISE NOTICE 'Skipped cirt_monthly_payroll'; END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.cirt_payroll_master') IS NOT NULL
     AND to_regclass('public."HRMS_payroll_master"') IS NULL THEN
    ALTER TABLE public.cirt_payroll_master RENAME TO "HRMS_payroll_master";
    RAISE NOTICE 'Renamed cirt_payroll_master to HRMS_payroll_master';
  ELSE RAISE NOTICE 'Skipped cirt_payroll_master'; END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.cirt_payroll_periods') IS NOT NULL
     AND to_regclass('public."HRMS_payroll_periods"') IS NULL THEN
    ALTER TABLE public.cirt_payroll_periods RENAME TO "HRMS_payroll_periods";
    RAISE NOTICE 'Renamed cirt_payroll_periods to HRMS_payroll_periods';
  ELSE RAISE NOTICE 'Skipped cirt_payroll_periods'; END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.cirt_payroll_import_batches') IS NOT NULL
     AND to_regclass('public."HRMS_payroll_import_batches"') IS NULL THEN
    ALTER TABLE public.cirt_payroll_import_batches RENAME TO "HRMS_payroll_import_batches";
    RAISE NOTICE 'Renamed cirt_payroll_import_batches to HRMS_payroll_import_batches';
  ELSE RAISE NOTICE 'Skipped cirt_payroll_import_batches'; END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.cirt_payroll_rule_settings') IS NOT NULL
     AND to_regclass('public."HRMS_payroll_rule_settings"') IS NULL THEN
    ALTER TABLE public.cirt_payroll_rule_settings RENAME TO "HRMS_payroll_rule_settings";
    RAISE NOTICE 'Renamed cirt_payroll_rule_settings to HRMS_payroll_rule_settings';
  ELSE RAISE NOTICE 'Skipped cirt_payroll_rule_settings'; END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.cirt_employee_bank_accounts') IS NOT NULL
     AND to_regclass('public."HRMS_employee_bank_accounts"') IS NULL THEN
    ALTER TABLE public.cirt_employee_bank_accounts RENAME TO "HRMS_employee_bank_accounts";
    RAISE NOTICE 'Renamed cirt_employee_bank_accounts to HRMS_employee_bank_accounts';
  ELSE RAISE NOTICE 'Skipped cirt_employee_bank_accounts'; END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.cirt_employees') IS NOT NULL
     AND to_regclass('public."HRMS_employees"') IS NULL THEN
    ALTER TABLE public.cirt_employees RENAME TO "HRMS_employees";
    RAISE NOTICE 'Renamed cirt_employees to HRMS_employees';
  ELSE RAISE NOTICE 'Skipped cirt_employees'; END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.cirt_designations') IS NOT NULL
     AND to_regclass('public."HRMS_designations"') IS NULL THEN
    ALTER TABLE public.cirt_designations RENAME TO "HRMS_designations";
    RAISE NOTICE 'Renamed cirt_designations to HRMS_designations';
  ELSE RAISE NOTICE 'Skipped cirt_designations'; END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.cirt_departments') IS NOT NULL
     AND to_regclass('public."HRMS_departments"') IS NULL THEN
    ALTER TABLE public.cirt_departments RENAME TO "HRMS_departments";
    RAISE NOTICE 'Renamed cirt_departments to HRMS_departments';
  ELSE RAISE NOTICE 'Skipped cirt_departments'; END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.cirt_divisions') IS NOT NULL
     AND to_regclass('public."HRMS_divisions"') IS NULL THEN
    ALTER TABLE public.cirt_divisions RENAME TO "HRMS_divisions";
    RAISE NOTICE 'Renamed cirt_divisions to HRMS_divisions';
  ELSE RAISE NOTICE 'Skipped cirt_divisions'; END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.cirt_roles') IS NOT NULL
     AND to_regclass('public."HRMS_roles"') IS NULL THEN
    ALTER TABLE public.cirt_roles RENAME TO "HRMS_roles";
    RAISE NOTICE 'Renamed cirt_roles to HRMS_roles';
  ELSE RAISE NOTICE 'Skipped cirt_roles'; END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.cirt_users') IS NOT NULL
     AND to_regclass('public."HRMS_users"') IS NULL THEN
    ALTER TABLE public.cirt_users RENAME TO "HRMS_users";
    RAISE NOTICE 'Renamed cirt_users to HRMS_users';
  ELSE RAISE NOTICE 'Skipped cirt_users'; END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.cirt_companies') IS NOT NULL
     AND to_regclass('public."HRMS_companies"') IS NULL THEN
    ALTER TABLE public.cirt_companies RENAME TO "HRMS_companies";
    RAISE NOTICE 'Renamed cirt_companies to HRMS_companies';
  ELSE RAISE NOTICE 'Skipped cirt_companies'; END IF;
END $$;

COMMIT;

SELECT c.relname AS hrms_table_restored
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname ILIKE '%hrms%'
ORDER BY c.relname;
