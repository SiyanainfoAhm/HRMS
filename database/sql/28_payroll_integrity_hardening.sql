-- 28_payroll_integrity_hardening.sql
-- Idempotent and non-destructive: safe to run any number of times, on a database
-- that already has some or all of these objects. It never deletes rows.
--
-- 1. Collapses repeated OPEN quarter assignments for the same employee + quarter
--    (created by repeated Payroll Master saves) by closing the redundant copies
--    with a zero-length period (assigned_to = assigned_from). A zero-length period
--    is never "active", so payroll resolves one assignment, and the history stays.
-- 2. Adds the one-open-assignment-per-employee / per-quarter unique indexes, but
--    only when no ambiguous open assignments remain (different quarters for one
--    employee, or different employees for one quarter). Those need a human
--    decision; they are reported by `php artisan payroll:schema-check`.
-- 3. Adds a period sanity constraint (NOT VALID, so existing rows are not rejected).
--
-- Run through `php artisan migrate` (migration 2026_10_30_130000) so Laravel
-- records it, or directly with psql for a manual run.

DO $$
BEGIN
    IF to_regclass('public.cirt_quarter_assignments') IS NULL THEN
        RAISE NOTICE 'cirt_quarter_assignments does not exist; nothing to do.';
        RETURN;
    END IF;

    -- 1. Close redundant duplicates (keep the earliest open row per employee+quarter).
    WITH ranked AS (
        SELECT id,
               row_number() OVER (
                   PARTITION BY company_id, employee_id, quarter_id
                   ORDER BY assigned_from NULLS FIRST, created_at, id
               ) AS rn
        FROM cirt_quarter_assignments
        WHERE assigned_to IS NULL
    )
    UPDATE cirt_quarter_assignments a
       SET assigned_to = COALESCE(a.assigned_from, CURRENT_DATE),
           updated_at = now()
      FROM ranked r
     WHERE a.id = r.id AND r.rn > 1;

    -- 2. Unique indexes, only when unambiguous.
    IF EXISTS (SELECT 1 FROM cirt_quarter_assignments WHERE assigned_to IS NULL
               GROUP BY company_id, employee_id HAVING count(*) > 1) THEN
        RAISE NOTICE 'Skipping cirt_quarter_assignment_one_open_per_employee: an employee still has open assignments to different quarters.';
    ELSE
        CREATE UNIQUE INDEX IF NOT EXISTS cirt_quarter_assignment_one_open_per_employee
            ON cirt_quarter_assignments (company_id, employee_id) WHERE assigned_to IS NULL;
    END IF;

    IF EXISTS (SELECT 1 FROM cirt_quarter_assignments WHERE assigned_to IS NULL
               GROUP BY company_id, quarter_id HAVING count(*) > 1) THEN
        RAISE NOTICE 'Skipping cirt_quarter_assignment_one_open_per_quarter: a quarter still has open assignments to different employees.';
    ELSE
        CREATE UNIQUE INDEX IF NOT EXISTS cirt_quarter_assignment_one_open_per_quarter
            ON cirt_quarter_assignments (company_id, quarter_id) WHERE assigned_to IS NULL;
    END IF;

    -- 3. Period sanity (does not validate existing rows).
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'cirt_quarter_assignments_period_ck'
           AND conrelid = 'cirt_quarter_assignments'::regclass
    ) THEN
        ALTER TABLE cirt_quarter_assignments
            ADD CONSTRAINT cirt_quarter_assignments_period_ck
            CHECK (assigned_to IS NULL OR assigned_from IS NULL OR assigned_to >= assigned_from) NOT VALID;
    END IF;
END
$$;
