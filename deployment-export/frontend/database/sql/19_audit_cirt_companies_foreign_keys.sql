-- =============================================================================
-- CIRT Payroll — audit dependencies on cirt_companies (read-only)
--
-- Purpose: Phase-2 planning before removing cirt_companies entirely.
-- Run in psql / Supabase SQL editor against your live database.
--
-- Notes:
--   • After rename migration, parent table is usually public.cirt_companies
--     (legacy name was "HRMS_companies").
--   • Some newer tables may have company_id WITHOUT a formal FK — section 2
--     catches those.
--   • Do NOT drop cirt_companies until every FK is dropped/replaced and
--     institute settings are migrated elsewhere.
-- =============================================================================

-- === 0. Does cirt_companies exist? ===
SELECT
  to_regclass('public.cirt_companies') AS cirt_companies_regclass,
  to_regclass('public."HRMS_companies"') AS hrms_companies_regclass;

-- === 1. Foreign keys that REFERENCE cirt_companies (or legacy HRMS_companies) ===
SELECT
  con.conname AS fk_constraint_name,
  src_ns.nspname AS source_schema,
  src.relname AS source_table,
  src_att.attname AS source_column,
  tgt.relname AS parent_table,
  CASE con.confdeltype
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'r' THEN 'RESTRICT'
    WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'd' THEN 'SET DEFAULT'
    ELSE con.confdeltype::text
  END AS on_delete,
  CASE con.confupdtype
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'r' THEN 'RESTRICT'
    WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'd' THEN 'SET DEFAULT'
    ELSE con.confupdtype::text
  END AS on_update,
  pg_get_constraintdef(con.oid, true) AS constraint_definition
FROM pg_constraint con
JOIN pg_class src ON src.oid = con.conrelid
JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
JOIN pg_class tgt ON tgt.oid = con.confrelid
JOIN pg_namespace tgt_ns ON tgt_ns.oid = tgt.relnamespace
JOIN pg_attribute src_att
  ON src_att.attrelid = con.conrelid
 AND src_att.attnum = ANY (con.conkey)
 AND src_att.attnum > 0
 AND NOT src_att.attisdropped
WHERE con.contype = 'f'
  AND src_ns.nspname = 'public'
  AND tgt_ns.nspname = 'public'
  AND tgt.relname IN ('cirt_companies', 'HRMS_companies')
ORDER BY source_table, fk_constraint_name, source_column;

-- === 1b. Count of inbound FKs per parent table name ===
SELECT
  tgt.relname AS parent_table,
  COUNT(*) AS inbound_fk_count
FROM pg_constraint con
JOIN pg_class src ON src.oid = con.conrelid
JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
JOIN pg_class tgt ON tgt.oid = con.confrelid
JOIN pg_namespace tgt_ns ON tgt_ns.oid = tgt.relnamespace
WHERE con.contype = 'f'
  AND src_ns.nspname = 'public'
  AND tgt_ns.nspname = 'public'
  AND tgt.relname IN ('cirt_companies', 'HRMS_companies')
GROUP BY tgt.relname;

-- === 2. All public tables with a company_id column (FK or not) ===
SELECT
  c.relname AS table_name,
  a.attnotnull AS company_id_not_null,
  EXISTS (
    SELECT 1
    FROM pg_constraint fk
    JOIN pg_class src ON src.oid = fk.conrelid
    JOIN pg_class tgt ON tgt.oid = fk.confrelid
    WHERE fk.contype = 'f'
      AND src.oid = c.oid
      AND tgt.relname IN ('cirt_companies', 'HRMS_companies')
  ) AS has_fk_to_companies,
  (
    SELECT string_agg(fk.conname, ', ' ORDER BY fk.conname)
    FROM pg_constraint fk
    JOIN pg_class src ON src.oid = fk.conrelid
    JOIN pg_class tgt ON tgt.oid = fk.confrelid
    WHERE fk.contype = 'f'
      AND src.oid = c.oid
      AND tgt.relname IN ('cirt_companies', 'HRMS_companies')
  ) AS fk_constraint_names
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND a.attname = 'company_id'
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY table_name;

-- === 2b. company_id columns WITHOUT a formal FK (higher migration risk) ===
SELECT
  c.relname AS table_name,
  a.attnotnull AS company_id_not_null
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND a.attname = 'company_id'
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint fk
    JOIN pg_class src ON src.oid = fk.conrelid
    JOIN pg_class tgt ON tgt.oid = fk.confrelid
    WHERE fk.contype = 'f'
      AND src.oid = c.oid
      AND tgt.relname IN ('cirt_companies', 'HRMS_companies')
  )
ORDER BY table_name;

-- === 3. Indexes involving company_id on cirt_* tables ===
SELECT
  t.relname AS table_name,
  i.relname AS index_name,
  pg_get_indexdef(i.oid) AS index_definition
FROM pg_class t
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_index ix ON ix.indrelid = t.oid
JOIN pg_class i ON i.oid = ix.indexrelid
WHERE n.nspname = 'public'
  AND t.relname LIKE 'cirt_%'
  AND pg_get_indexdef(i.oid) ILIKE '%company_id%'
ORDER BY table_name, index_name;

-- === 4. Row counts: how many rows reference each distinct company_id ===
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'cirt_users',
    'cirt_roles',
    'cirt_employees',
    'cirt_departments',
    'cirt_designations',
    'cirt_divisions',
    'cirt_employee_bank_accounts',
    'cirt_payroll_master',
    'cirt_payroll_master_history',
    'cirt_payroll_periods',
    'cirt_monthly_payroll',
    'cirt_payslips',
    'cirt_payroll_calculation_settings',
    'cirt_payroll_field_definitions',
    'cirt_payroll_field_values',
    'cirt_salary_increments',
    'cirt_quarters',
    'cirt_quarter_assignments',
    'cirt_da_revision_events',
    'cirt_payroll_arrear_batches',
    'cirt_payroll_arrear_lines'
  ];
BEGIN
  RAISE NOTICE '--- company_id distribution (top values per table) ---';
  FOREACH tbl IN ARRAY tables LOOP
    IF to_regclass(format('public.%I', tbl)) IS NOT NULL THEN
      RAISE NOTICE 'TABLE: %', tbl;
      FOR rec IN EXECUTE format(
        'SELECT company_id::text AS cid, COUNT(*) AS cnt
         FROM public.%I
         GROUP BY company_id
         ORDER BY cnt DESC
         LIMIT 5',
        tbl
      ) LOOP
        RAISE NOTICE '  company_id=% count=%', rec.cid, rec.cnt;
      END LOOP;
    ELSE
      RAISE NOTICE 'TABLE: % (missing)', tbl;
    END IF;
  END LOOP;
END $$;

-- === 5. Default CIRT company row (what would need replacing) ===
SELECT
  id,
  name,
  code,
  industry,
  phone,
  address_line1,
  address_line2,
  city,
  state,
  country,
  postal_code,
  professional_tax_annual,
  professional_tax_monthly,
  default_da_percent,
  default_hra_percent,
  logo_url,
  created_at,
  updated_at
FROM cirt_companies
ORDER BY created_at;

-- =============================================================================
-- EXPECTED inbound FKs (from supabase/hrms_schema.sql → renamed to cirt_*)
-- Verify section 1 output includes these active payroll tables at minimum:
--
--   cirt_users                    company_id  ON DELETE SET NULL
--   cirt_roles                    company_id  ON DELETE CASCADE
--   cirt_divisions                company_id  ON DELETE CASCADE
--   cirt_departments              company_id  ON DELETE CASCADE
--   cirt_designations             company_id  ON DELETE CASCADE
--   cirt_employees                company_id  ON DELETE CASCADE
--   cirt_payroll_periods          company_id  ON DELETE CASCADE
--   cirt_payslips                 company_id  ON DELETE CASCADE
--   cirt_employee_bank_accounts   company_id  ON DELETE CASCADE
--   cirt_payroll_master           company_id  ON DELETE CASCADE
--
-- Legacy HRMS module tables (may still exist or have been dropped):
--   cirt_shifts, cirt_attendance_logs, cirt_leave_types, cirt_leave_policies,
--   cirt_leave_requests, cirt_holidays, cirt_company_documents,
--   cirt_employee_invites, cirt_employee_document_submissions,
--   cirt_reimbursements, cirt_notifications
--
-- Newer tables often have company_id column only (no FK in SQL scripts):
--   cirt_payroll_master_history, cirt_monthly_payroll,
--   cirt_payroll_field_definitions, cirt_payroll_field_values,
--   cirt_payroll_calculation_settings, cirt_salary_increments,
--   cirt_quarters, cirt_quarter_assignments,
--   cirt_da_revision_events, cirt_payroll_arrear_batches,
--   cirt_payroll_arrear_lines
--
-- Phase-2 removal checklist (NOT executed here):
--   1. CREATE cirt_institute_settings (or similar) and copy cirt_companies row
--   2. ALTER each child: DROP CONSTRAINT ... ; DROP COLUMN company_id OR repoint
--   3. DROP TABLE cirt_companies
-- =============================================================================
