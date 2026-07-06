-- =============================================================================
-- CIRT Payroll — post-migration verification (read-only)
-- Run after 02_rename (and optionally 03_drop).
-- =============================================================================

-- === 1. Required cirt_* tables exist ===
SELECT
  required.table_name,
  CASE WHEN c.oid IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM (
  VALUES
    ('cirt_users'),
    ('cirt_roles'),
    ('cirt_institute'),
    ('cirt_employees'),
    ('cirt_departments'),
    ('cirt_designations'),
    ('cirt_divisions'),
    ('cirt_employee_bank_accounts'),
    ('cirt_payroll_master'),
    ('cirt_payroll_periods'),
    ('cirt_monthly_payroll'),
    ('cirt_payslips')
) AS required(table_name)
LEFT JOIN pg_class c ON c.relname = required.table_name
LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
ORDER BY required.table_name;

-- === 2. Unwanted HRMS module tables should be absent (after 03_drop) ===
SELECT
  unwanted.table_name,
  CASE WHEN c.oid IS NOT NULL THEN 'STILL PRESENT' ELSE 'absent (good)' END AS status
FROM (
  VALUES
    ('HRMS_attendance_logs'),
    ('HRMS_company_documents'),
    ('HRMS_employee_document_submissions'),
    ('HRMS_employee_invites'),
    ('HRMS_holidays'),
    ('HRMS_leave_policies'),
    ('HRMS_leave_requests'),
    ('HRMS_leave_types'),
    ('HRMS_notifications'),
    ('HRMS_reimbursements'),
    ('HRMS_shifts')
) AS unwanted(table_name)
LEFT JOIN pg_class c ON c.relname = unwanted.table_name
LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
ORDER BY unwanted.table_name;

-- === 3. Row counts for active cirt tables ===
CREATE TEMP TABLE IF NOT EXISTS _cirt_post_counts (table_name text, row_count bigint, table_exists boolean);
TRUNCATE _cirt_post_counts;

DO $$
DECLARE
  tbl text;
  cnt bigint;
  tables text[] := ARRAY[
    'cirt_institute', 'cirt_users', 'cirt_roles', 'cirt_divisions', 'cirt_departments',
    'cirt_designations', 'cirt_employees', 'cirt_employee_bank_accounts',
    'cirt_payroll_periods', 'cirt_payroll_master', 'cirt_monthly_payroll', 'cirt_payslips',
    'cirt_payroll_rule_settings', 'cirt_payroll_import_batches'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    IF to_regclass(format('public.%I', tbl)) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', tbl) INTO cnt;
      INSERT INTO _cirt_post_counts VALUES (tbl, cnt, true);
    ELSE
      INSERT INTO _cirt_post_counts VALUES (tbl, NULL, false);
    END IF;
  END LOOP;
END $$;

SELECT * FROM _cirt_post_counts ORDER BY table_name;

-- === 4. Sample COUNT(*) per active table (only existing tables) ===
DO $$
DECLARE
  tbl text;
  cnt bigint;
  tables text[] := ARRAY[
    'cirt_users', 'cirt_roles', 'cirt_institute', 'cirt_employees',
    'cirt_departments', 'cirt_designations', 'cirt_divisions',
    'cirt_employee_bank_accounts', 'cirt_payroll_master', 'cirt_payroll_periods',
    'cirt_monthly_payroll', 'cirt_payslips'
  ];
BEGIN
  RAISE NOTICE '--- Sample counts ---';
  FOREACH tbl IN ARRAY tables LOOP
    IF to_regclass(format('public.%I', tbl)) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', tbl) INTO cnt;
      RAISE NOTICE '% : %', tbl, cnt;
    END IF;
  END LOOP;
END $$;

-- === 5. Foreign keys on cirt_* tables after rename ===
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
  AND src.relname LIKE 'cirt_%'
ORDER BY source_table, constraint_name;

-- === 6. Role enum type ===
SELECT typname AS role_enum_type
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
  AND t.typname IN ('cirt_role_key', 'hrms_role_key')
ORDER BY typname;

DROP TABLE IF EXISTS _cirt_post_counts;
