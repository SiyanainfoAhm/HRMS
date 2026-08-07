-- =============================================================================
-- CIRT Payroll — drop unused HRMS module tables
--
-- WARNING: Run only after backup and after confirming the application no longer
-- references these tables. This script is DESTRUCTIVE.
--
-- Does NOT use DROP CASCADE unless a blocking FK from an active cirt_* table
-- must be removed first (shift_id on cirt_users / cirt_employees).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Row counts for tables slated for removal
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
  cnt bigint;
  tables text[] := ARRAY[
    'HRMS_employee_document_submissions',
    'HRMS_employee_invites',
    'HRMS_company_documents',
    'HRMS_leave_requests',
    'HRMS_leave_policies',
    'HRMS_leave_types',
    'HRMS_attendance_logs',
    'HRMS_holidays',
    'HRMS_reimbursements',
    'HRMS_notifications',
    'HRMS_shifts'
  ];
BEGIN
  RAISE NOTICE '--- Unused table row counts ---';
  FOREACH tbl IN ARRAY tables LOOP
    IF to_regclass(format('public.%I', tbl)) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', tbl) INTO cnt;
      RAISE NOTICE '% : % rows', tbl, cnt;
    ELSE
      RAISE NOTICE '% : (not found)', tbl;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- B. Foreign key dependencies on unused tables (review before drop)
-- ---------------------------------------------------------------------------
SELECT
  con.conname AS constraint_name,
  src.relname AS source_table,
  tgt.relname AS target_table,
  CASE con.confdeltype
    WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'r' THEN 'RESTRICT'
    ELSE con.confdeltype::text
  END AS on_delete
FROM pg_constraint con
JOIN pg_class src ON src.oid = con.conrelid
JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
JOIN pg_class tgt ON tgt.oid = con.confrelid
WHERE con.contype = 'f'
  AND src_ns.nspname = 'public'
  AND tgt.relname IN (
    'HRMS_employee_document_submissions',
    'HRMS_employee_invites',
    'HRMS_company_documents',
    'HRMS_leave_requests',
    'HRMS_leave_policies',
    'HRMS_leave_types',
    'HRMS_attendance_logs',
    'HRMS_holidays',
    'HRMS_reimbursements',
    'HRMS_notifications',
    'HRMS_shifts'
  )
ORDER BY target_table, source_table;

-- ---------------------------------------------------------------------------
-- C. Drop FK constraints from ACTIVE cirt tables pointing at HRMS_shifts
--     (required before HRMS_shifts can be dropped)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT con.conname, src.relname AS source_table
    FROM pg_constraint con
    JOIN pg_class src ON src.oid = con.conrelid
    JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
    JOIN pg_class tgt ON tgt.oid = con.confrelid
    WHERE con.contype = 'f'
      AND src_ns.nspname = 'public'
      AND tgt.relname = 'HRMS_shifts'
      AND src.relname LIKE 'cirt_%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.source_table, r.conname);
    RAISE NOTICE 'Dropped FK % on % referencing HRMS_shifts', r.conname, r.source_table;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- D. Drop unused tables (dependency-safe order)
-- ---------------------------------------------------------------------------
BEGIN;

DO $$ BEGIN
  IF to_regclass('public."HRMS_employee_document_submissions"') IS NOT NULL THEN
    DROP TABLE public."HRMS_employee_document_submissions";
    RAISE NOTICE 'Dropped HRMS_employee_document_submissions';
  ELSE RAISE NOTICE 'Skip HRMS_employee_document_submissions (not found)'; END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public."HRMS_employee_invites"') IS NOT NULL THEN
    DROP TABLE public."HRMS_employee_invites";
    RAISE NOTICE 'Dropped HRMS_employee_invites';
  ELSE RAISE NOTICE 'Skip HRMS_employee_invites (not found)'; END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public."HRMS_company_documents"') IS NOT NULL THEN
    DROP TABLE public."HRMS_company_documents";
    RAISE NOTICE 'Dropped HRMS_company_documents';
  ELSE RAISE NOTICE 'Skip HRMS_company_documents (not found)'; END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public."HRMS_leave_requests"') IS NOT NULL THEN
    DROP TABLE public."HRMS_leave_requests";
    RAISE NOTICE 'Dropped HRMS_leave_requests';
  ELSE RAISE NOTICE 'Skip HRMS_leave_requests (not found)'; END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public."HRMS_leave_policies"') IS NOT NULL THEN
    DROP TABLE public."HRMS_leave_policies";
    RAISE NOTICE 'Dropped HRMS_leave_policies';
  ELSE RAISE NOTICE 'Skip HRMS_leave_policies (not found)'; END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public."HRMS_leave_types"') IS NOT NULL THEN
    DROP TABLE public."HRMS_leave_types";
    RAISE NOTICE 'Dropped HRMS_leave_types';
  ELSE RAISE NOTICE 'Skip HRMS_leave_types (not found)'; END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public."HRMS_attendance_logs"') IS NOT NULL THEN
    DROP TABLE public."HRMS_attendance_logs";
    RAISE NOTICE 'Dropped HRMS_attendance_logs';
  ELSE RAISE NOTICE 'Skip HRMS_attendance_logs (not found)'; END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public."HRMS_holidays"') IS NOT NULL THEN
    DROP TABLE public."HRMS_holidays";
    RAISE NOTICE 'Dropped HRMS_holidays';
  ELSE RAISE NOTICE 'Skip HRMS_holidays (not found)'; END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public."HRMS_reimbursements"') IS NOT NULL THEN
    DROP TABLE public."HRMS_reimbursements";
    RAISE NOTICE 'Dropped HRMS_reimbursements';
  ELSE RAISE NOTICE 'Skip HRMS_reimbursements (not found)'; END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public."HRMS_notifications"') IS NOT NULL THEN
    DROP TABLE public."HRMS_notifications";
    RAISE NOTICE 'Dropped HRMS_notifications';
  ELSE RAISE NOTICE 'Skip HRMS_notifications (not found)'; END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public."HRMS_shifts"') IS NOT NULL THEN
    DROP TABLE public."HRMS_shifts";
    RAISE NOTICE 'Dropped HRMS_shifts';
  ELSE RAISE NOTICE 'Skip HRMS_shifts (not found)'; END IF;
END $$;

COMMIT;

-- ---------------------------------------------------------------------------
-- E. Drop unused enum types (only after their tables are gone)
--     Do NOT drop HRMS_role_key / cirt_role_key here.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE n.nspname = 'public' AND t.typname = 'hrms_leave_accrual_method') THEN
    DROP TYPE public.hrms_leave_accrual_method;
    RAISE NOTICE 'Dropped type hrms_leave_accrual_method';
  ELSE
    RAISE NOTICE 'Skip hrms_leave_accrual_method';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE n.nspname = 'public' AND t.typname = 'hrms_leave_status') THEN
    DROP TYPE public.hrms_leave_status;
    RAISE NOTICE 'Dropped type hrms_leave_status';
  ELSE
    RAISE NOTICE 'Skip hrms_leave_status';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE n.nspname = 'public' AND t.typname = 'hrms_company_document_kind') THEN
    DROP TYPE public.hrms_company_document_kind;
    RAISE NOTICE 'Dropped type hrms_company_document_kind';
  ELSE
    RAISE NOTICE 'Skip hrms_company_document_kind';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE n.nspname = 'public' AND t.typname = 'hrms_reimbursement_status') THEN
    DROP TYPE public.hrms_reimbursement_status;
    RAISE NOTICE 'Dropped type hrms_reimbursement_status';
  ELSE
    RAISE NOTICE 'Skip hrms_reimbursement_status';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- F. Remaining HRMS-named objects (should be none except legacy extras you keep)
-- ---------------------------------------------------------------------------
SELECT c.relname AS remaining_hrms_table
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname ILIKE '%hrms%'
ORDER BY c.relname;
