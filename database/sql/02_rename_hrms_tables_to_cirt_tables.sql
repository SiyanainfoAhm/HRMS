-- =============================================================================
-- CIRT Payroll — rename active HRMS_* tables to cirt_* (idempotent)
-- Preserves all data. Does NOT use CASCADE.
-- Run after 01_verify_current_hrms_schema.sql and after backup.
--
-- Naming notes:
--   "HRMS_companies"  -> cirt_companies   (single CIRT institute row, not multi-company SaaS)
--   "HRMS_divisions"  -> cirt_divisions   (org divisions)
--   "HRMS_departments"-> cirt_departments (org departments under divisions; NOT the same as divisions)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Enum: HRMS_role_key -> cirt_role_key
-- PostgreSQL stores unquoted type names lowercase (hrms_role_key).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE n.nspname = 'public' AND t.typname = 'hrms_role_key')
     AND NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                     WHERE n.nspname = 'public' AND t.typname = 'cirt_role_key') THEN
    ALTER TYPE public.hrms_role_key RENAME TO cirt_role_key;
    RAISE NOTICE 'Renamed type hrms_role_key to cirt_role_key';
  ELSE
    RAISE NOTICE 'Skipped type hrms_role_key (missing or cirt_role_key already exists)';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Tables (order: parent/core first; PostgreSQL updates FK references on rename)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public."HRMS_companies"') IS NOT NULL
     AND to_regclass('public.cirt_companies') IS NULL THEN
    ALTER TABLE public."HRMS_companies" RENAME TO cirt_companies;
    RAISE NOTICE 'Renamed HRMS_companies to cirt_companies';
  ELSE
    RAISE NOTICE 'Skipped HRMS_companies';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public."HRMS_users"') IS NOT NULL
     AND to_regclass('public.cirt_users') IS NULL THEN
    ALTER TABLE public."HRMS_users" RENAME TO cirt_users;
    RAISE NOTICE 'Renamed HRMS_users to cirt_users';
  ELSE
    RAISE NOTICE 'Skipped HRMS_users';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public."HRMS_roles"') IS NOT NULL
     AND to_regclass('public.cirt_roles') IS NULL THEN
    ALTER TABLE public."HRMS_roles" RENAME TO cirt_roles;
    RAISE NOTICE 'Renamed HRMS_roles to cirt_roles';
  ELSE
    RAISE NOTICE 'Skipped HRMS_roles';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public."HRMS_divisions"') IS NOT NULL
     AND to_regclass('public.cirt_divisions') IS NULL THEN
    ALTER TABLE public."HRMS_divisions" RENAME TO cirt_divisions;
    RAISE NOTICE 'Renamed HRMS_divisions to cirt_divisions';
  ELSE
    RAISE NOTICE 'Skipped HRMS_divisions';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public."HRMS_departments"') IS NOT NULL
     AND to_regclass('public.cirt_departments') IS NULL THEN
    ALTER TABLE public."HRMS_departments" RENAME TO cirt_departments;
    RAISE NOTICE 'Renamed HRMS_departments to cirt_departments';
  ELSE
    RAISE NOTICE 'Skipped HRMS_departments';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public."HRMS_designations"') IS NOT NULL
     AND to_regclass('public.cirt_designations') IS NULL THEN
    ALTER TABLE public."HRMS_designations" RENAME TO cirt_designations;
    RAISE NOTICE 'Renamed HRMS_designations to cirt_designations';
  ELSE
    RAISE NOTICE 'Skipped HRMS_designations';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public."HRMS_employees"') IS NOT NULL
     AND to_regclass('public.cirt_employees') IS NULL THEN
    ALTER TABLE public."HRMS_employees" RENAME TO cirt_employees;
    RAISE NOTICE 'Renamed HRMS_employees to cirt_employees';
  ELSE
    RAISE NOTICE 'Skipped HRMS_employees';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public."HRMS_employee_bank_accounts"') IS NOT NULL
     AND to_regclass('public.cirt_employee_bank_accounts') IS NULL THEN
    ALTER TABLE public."HRMS_employee_bank_accounts" RENAME TO cirt_employee_bank_accounts;
    RAISE NOTICE 'Renamed HRMS_employee_bank_accounts to cirt_employee_bank_accounts';
  ELSE
    RAISE NOTICE 'Skipped HRMS_employee_bank_accounts';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public."HRMS_payroll_periods"') IS NOT NULL
     AND to_regclass('public.cirt_payroll_periods') IS NULL THEN
    ALTER TABLE public."HRMS_payroll_periods" RENAME TO cirt_payroll_periods;
    RAISE NOTICE 'Renamed HRMS_payroll_periods to cirt_payroll_periods';
  ELSE
    RAISE NOTICE 'Skipped HRMS_payroll_periods';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public."HRMS_payroll_master"') IS NOT NULL
     AND to_regclass('public.cirt_payroll_master') IS NULL THEN
    ALTER TABLE public."HRMS_payroll_master" RENAME TO cirt_payroll_master;
    RAISE NOTICE 'Renamed HRMS_payroll_master to cirt_payroll_master';
  ELSE
    RAISE NOTICE 'Skipped HRMS_payroll_master';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public."HRMS_government_monthly_payroll"') IS NOT NULL
     AND to_regclass('public.cirt_monthly_payroll') IS NULL THEN
    ALTER TABLE public."HRMS_government_monthly_payroll" RENAME TO cirt_monthly_payroll;
    RAISE NOTICE 'Renamed HRMS_government_monthly_payroll to cirt_monthly_payroll';
  ELSE
    RAISE NOTICE 'Skipped HRMS_government_monthly_payroll';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public."HRMS_payslips"') IS NOT NULL
     AND to_regclass('public.cirt_payslips') IS NULL THEN
    ALTER TABLE public."HRMS_payslips" RENAME TO cirt_payslips;
    RAISE NOTICE 'Renamed HRMS_payslips to cirt_payslips';
  ELSE
    RAISE NOTICE 'Skipped HRMS_payslips';
  END IF;
END $$;

-- Optional tables (only if present)
DO $$
BEGIN
  IF to_regclass('public."HRMS_payroll_rule_settings"') IS NOT NULL
     AND to_regclass('public.cirt_payroll_rule_settings') IS NULL THEN
    ALTER TABLE public."HRMS_payroll_rule_settings" RENAME TO cirt_payroll_rule_settings;
    RAISE NOTICE 'Renamed HRMS_payroll_rule_settings to cirt_payroll_rule_settings';
  ELSE
    RAISE NOTICE 'Skipped HRMS_payroll_rule_settings';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public."HRMS_payroll_import_batches"') IS NOT NULL
     AND to_regclass('public.cirt_payroll_import_batches') IS NULL THEN
    ALTER TABLE public."HRMS_payroll_import_batches" RENAME TO cirt_payroll_import_batches;
    RAISE NOTICE 'Renamed HRMS_payroll_import_batches to cirt_payroll_import_batches';
  ELSE
    RAISE NOTICE 'Skipped HRMS_payroll_import_batches';
  END IF;
END $$;

COMMIT;

-- ---------------------------------------------------------------------------
-- Post-rename listing
-- ---------------------------------------------------------------------------
SELECT c.relname AS cirt_table
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname LIKE 'cirt_%'
ORDER BY c.relname;

SELECT c.relname AS remaining_hrms_table
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname ILIKE '%hrms%'
ORDER BY c.relname;
