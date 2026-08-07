\set ON_ERROR_STOP on

BEGIN;

-- =========================================================
-- 1. Find original salary from first Salary Increment history
-- =========================================================

CREATE TEMP TABLE _restore AS
WITH h AS (
    SELECT
        employee_user_id,

        COALESCE(
            NULLIF(to_jsonb(h)->>'gross_basic_pay', '')::numeric,
            NULLIF(to_jsonb(h)->>'gross_basic', '')::numeric,
            NULLIF(to_jsonb(h)->>'gross_salary', '')::numeric
        ) AS old_basic,

        COALESCE(
            NULLIF(to_jsonb(h)->>'effective_from', '')::date,
            NULLIF(to_jsonb(h)->>'effective_start_date', '')::date
        ) AS hist_start,

        COALESCE(
            NULLIF(to_jsonb(h)->>'effective_to', '')::date,
            NULLIF(to_jsonb(h)->>'effective_end_date', '')::date
        ) AS hist_end,

        COALESCE(to_jsonb(h)->>'archive_reason', '') || ' ' ||
        COALESCE(to_jsonb(h)->>'reason_for_change', '') AS why

    FROM cirt_payroll_master_history h
)

SELECT DISTINCT ON (employee_user_id)
    employee_user_id,
    old_basic,
    hist_start,
    COALESCE(hist_end + 1, hist_start) AS increment_date

FROM h

WHERE employee_user_id IS NOT NULL
  AND old_basic IS NOT NULL
  AND hist_start IS NOT NULL
  AND why ILIKE '%salary increment%'

ORDER BY
    employee_user_id,
    COALESCE(hist_end, hist_start) ASC,
    hist_start ASC,
    old_basic ASC;


-- Stop if history also has no increment evidence
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM _restore) THEN
        RAISE EXCEPTION
        'No Salary Increment history found. Nothing changed.';
    END IF;
END
$$;


-- =========================================================
-- 2. Find ORIGINAL Payroll Master row to keep
-- =========================================================

CREATE TEMP TABLE _keep AS
SELECT DISTINCT ON (pm.employee_user_id)
    pm.id,
    pm.employee_user_id,
    pm.employee_code,
    r.old_basic

FROM cirt_payroll_master pm

JOIN _restore r
  ON r.employee_user_id = pm.employee_user_id

WHERE ROUND(
        COALESCE(
            pm.gross_basic_pay,
            pm.gross_basic,
            pm.gross_salary,
            0
        )::numeric,
        2
      )
      =
      ROUND(r.old_basic, 2)

ORDER BY
    pm.employee_user_id,

    -- Prefer a real row, not a one-day increment artefact
    CASE
        WHEN COALESCE(pm.effective_from, pm.effective_start_date)::date
             =
             COALESCE(pm.effective_to, pm.effective_end_date)::date
        THEN 1
        ELSE 0
    END,

    COALESCE(pm.effective_from, pm.effective_start_date)::date DESC,
    pm.created_at DESC;


-- =========================================================
-- 3. Find JUNK Payroll Master rows
--
-- Junk =
-- - any affected employee master having incremented Basic
-- - artificial one-day version before increment
-- =========================================================

CREATE TEMP TABLE _junk_master AS
SELECT
    pm.id,
    pm.employee_user_id,
    pm.employee_code

FROM cirt_payroll_master pm

JOIN _restore r
  ON r.employee_user_id = pm.employee_user_id

JOIN _keep k
  ON k.employee_user_id = pm.employee_user_id

WHERE pm.id <> k.id

AND (

    ROUND(
        COALESCE(
            pm.gross_basic_pay,
            pm.gross_basic,
            pm.gross_salary,
            0
        )::numeric,
        2
    ) <> ROUND(r.old_basic, 2)

    OR

    (
        COALESCE(pm.effective_from, pm.effective_start_date)::date
            = r.increment_date - 1

        AND COALESCE(pm.effective_to, pm.effective_end_date)::date
            = r.increment_date - 1
    )
);


-- =========================================================
-- 4. Safety: monthly payroll must NOT reference junk masters
-- =========================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM cirt_monthly_payroll m
        WHERE m.payroll_master_id IN (
            SELECT id FROM _junk_master
        )
    ) THEN
        RAISE EXCEPTION
        'Monthly payroll references a junk master. Cleanup stopped.';
    END IF;
END
$$;


-- =========================================================
-- 5. Remove dynamic values belonging to junk masters
-- =========================================================

DELETE FROM cirt_payroll_field_values
WHERE payroll_master_id IN (
    SELECT id FROM _junk_master
);


-- =========================================================
-- 6. Clear junk HISTORY
--
-- Salary Increment history +
-- history linked to increment-created masters
-- =========================================================

DELETE FROM cirt_payroll_master_history h
USING _restore r

WHERE h.employee_user_id = r.employee_user_id

AND (

    COALESCE(to_jsonb(h)->>'archive_reason', '') ILIKE '%salary increment%'

    OR

    COALESCE(to_jsonb(h)->>'reason_for_change', '') ILIKE '%salary increment%'

    OR

    h.original_master_id IN (
        SELECT id FROM _junk_master
    )
);


-- =========================================================
-- 7. Delete increment-created Payroll Master rows
-- =========================================================

DELETE FROM cirt_payroll_master
WHERE id IN (
    SELECT id FROM _junk_master
);


-- =========================================================
-- 8. Reopen ORIGINAL Payroll Master
-- =========================================================

UPDATE cirt_payroll_master pm

SET
    gross_basic = r.old_basic,
    gross_basic_pay = r.old_basic,

    effective_end_date = NULL,
    effective_to = NULL,

    updated_at = NOW()

FROM _keep k
JOIN _restore r
  ON r.employee_user_id = k.employee_user_id

WHERE pm.id = k.id;


-- =========================================================
-- 9. Increment audit table - clear whatever remains
-- =========================================================

DELETE FROM cirt_salary_increments;


-- =========================================================
-- 10. VERIFY
-- =========================================================

SELECT
    pm.employee_code,
    COALESCE(pm.gross_basic_pay, pm.gross_basic) AS gross_basic,
    COALESCE(pm.effective_from, pm.effective_start_date) AS effective_from,
    pm.effective_end_date,
    pm.effective_to

FROM cirt_payroll_master pm

WHERE pm.employee_user_id IN (
    SELECT employee_user_id FROM _restore
)

ORDER BY
    pm.employee_code,
    COALESCE(pm.effective_from, pm.effective_start_date);


SELECT COUNT(*) AS increment_audit_remaining
FROM cirt_salary_increments;


SELECT COUNT(*) AS increment_history_remaining
FROM cirt_payroll_master_history h
WHERE
       COALESCE(to_jsonb(h)->>'archive_reason', '') ILIKE '%salary increment%'
    OR COALESCE(to_jsonb(h)->>'reason_for_change', '') ILIKE '%salary increment%';


SELECT
    employee_user_id,
    COUNT(*) FILTER (
        WHERE effective_to IS NULL
          AND effective_end_date IS NULL
    ) AS current_rows

FROM cirt_payroll_master

WHERE employee_user_id IN (
    SELECT employee_user_id FROM _restore
)

GROUP BY employee_user_id;

COMMIT;