-- =============================================================================
-- CIRT Payroll — pre-migration verification (read-only)
-- Run in Supabase SQL Editor, DBeaver, or pgAdmin against your target database.
-- Does NOT modify anything.
-- =============================================================================

-- === 1. Public tables containing HRMS (case-insensitive) ===
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  CASE c.relpersistence
    WHEN 'p' THEN 'permanent'
    WHEN 'u' THEN 'unlogged'
    WHEN 't' THEN 'temporary'
  END AS persistence
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname = 'public'
  AND c.relname ILIKE '%hrms%'
ORDER BY c.relname;

-- === 2. Public tables containing cirt (case-insensitive) ===
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname = 'public'
  AND c.relname ILIKE '%cirt%'
ORDER BY c.relname;

-- === 3. Enum types containing HRMS or cirt ===
SELECT
  n.nspname AS schema_name,
  t.typname AS type_name,
  t.typtype AS type_kind
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
  AND t.typtype = 'e'
  AND (t.typname ILIKE '%hrms%' OR t.typname ILIKE '%cirt%')
ORDER BY t.typname;

-- === 4. Row counts for important HRMS tables ===
DO $$
DECLARE
  tbl text;
  cnt bigint;
  tables text[] := ARRAY[
    'HRMS_companies',
    'HRMS_users',
    'HRMS_roles',
    'HRMS_divisions',
    'HRMS_departments',
    'HRMS_designations',
    'HRMS_employees',
    'HRMS_employee_bank_accounts',
    'HRMS_payroll_periods',
    'HRMS_payroll_master',
    'HRMS_government_monthly_payroll',
    'HRMS_payslips',
    'HRMS_payroll_rule_settings',
    'HRMS_payroll_import_batches',
    'HRMS_attendance_logs',
    'HRMS_company_documents',
    'HRMS_employee_document_submissions',
    'HRMS_employee_invites',
    'HRMS_holidays',
    'HRMS_leave_policies',
    'HRMS_leave_requests',
    'HRMS_leave_types',
    'HRMS_notifications',
    'HRMS_reimbursements',
    'HRMS_shifts'
  ];
BEGIN
  RAISE NOTICE '--- Row counts (NOTICE output) ---';
  FOREACH tbl IN ARRAY tables LOOP
    IF to_regclass(format('public.%I', tbl)) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', tbl) INTO cnt;
      RAISE NOTICE '% : % rows', tbl, cnt;
    ELSE
      RAISE NOTICE '% : (table not found)', tbl;
    END IF;
  END LOOP;
END $$;

-- Row counts as a query result (dynamic; safe if tables are missing)
CREATE TEMP TABLE IF NOT EXISTS _cirt_verify_counts (table_name text, row_count bigint, table_exists boolean);
TRUNCATE _cirt_verify_counts;

DO $$
DECLARE
  tbl text;
  cnt bigint;
  tables text[] := ARRAY[
    'HRMS_companies', 'HRMS_users', 'HRMS_roles', 'HRMS_divisions', 'HRMS_departments',
    'HRMS_designations', 'HRMS_employees', 'HRMS_employee_bank_accounts',
    'HRMS_payroll_periods', 'HRMS_payroll_master', 'HRMS_government_monthly_payroll',
    'HRMS_payslips', 'HRMS_attendance_logs', 'HRMS_leave_requests', 'HRMS_shifts'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    IF to_regclass(format('public.%I', tbl)) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', tbl) INTO cnt;
      INSERT INTO _cirt_verify_counts VALUES (tbl, cnt, true);
    ELSE
      INSERT INTO _cirt_verify_counts VALUES (tbl, NULL, false);
    END IF;
  END LOOP;
END $$;

SELECT * FROM _cirt_verify_counts ORDER BY table_name;

-- === 5. Foreign keys involving HRMS-named tables ===
SELECT
  con.conname AS constraint_name,
  src_ns.nspname AS source_schema,
  src.relname AS source_table,
  tgt_ns.nspname AS target_schema,
  tgt.relname AS target_table,
  CASE con.confdeltype
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'r' THEN 'RESTRICT'
    WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'd' THEN 'SET DEFAULT'
  END AS on_delete
FROM pg_constraint con
JOIN pg_class src ON src.oid = con.conrelid
JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
JOIN pg_class tgt ON tgt.oid = con.confrelid
JOIN pg_namespace tgt_ns ON tgt_ns.oid = tgt.relnamespace
WHERE con.contype = 'f'
  AND src_ns.nspname = 'public'
  AND (src.relname ILIKE '%hrms%' OR tgt.relname ILIKE '%hrms%')
ORDER BY source_table, constraint_name;

-- === 6. Indexes with hrms in the name ===
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND (indexname ILIKE '%hrms%' OR tablename ILIKE '%hrms%')
ORDER BY tablename, indexname;

-- === 7. Protected tables sanity check (should remain untouched) ===
SELECT relname AS protected_table, 'present' AS status
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND relname IN (
    'migrations', 'personal_access_tokens', 'failed_jobs', 'jobs',
    'password_reset_tokens', 'cache', 'cache_locks'
  )
ORDER BY relname;

DROP TABLE IF EXISTS _cirt_verify_counts;
