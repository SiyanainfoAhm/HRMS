-- Local CIRT September 2026 reset. Run only through psql against verified local hrms.
-- Preserves the super-admin, configuration, reference masters and migration history.
BEGIN;

DO $$
BEGIN
    IF current_database() <> 'hrms' OR inet_server_addr() <> '127.0.0.1'::inet THEN
        RAISE EXCEPTION 'Refusing reset: expected local hrms at 127.0.0.1, got database % at %', current_database(), inet_server_addr();
    END IF;
    IF (SELECT count(*) FROM cirt_users WHERE role = 'super_admin') <> 1 THEN
        RAISE EXCEPTION 'Refusing reset: exactly one super_admin must exist';
    END IF;
END $$;

CREATE TEMP TABLE reset_employee_users ON COMMIT DROP AS
SELECT id FROM cirt_users WHERE role <> 'super_admin';

DELETE FROM cirt_monthly_payroll_audits;
DELETE FROM cirt_monthly_payroll;
DELETE FROM cirt_payslips;
DELETE FROM cirt_payroll_draft_employees;
DELETE FROM cirt_payroll_draft_audits;
DELETE FROM cirt_payroll_drafts;
DELETE FROM cirt_payroll_arrear_lines;
DELETE FROM cirt_payroll_arrear_batches;
DELETE FROM cirt_salary_increments
WHERE employee_user_id IN (SELECT id FROM reset_employee_users);

DELETE FROM cirt_payroll_field_values
WHERE payroll_master_id IN (
    SELECT id FROM cirt_payroll_master WHERE employee_user_id IN (SELECT id FROM reset_employee_users)
);
DELETE FROM cirt_payroll_master_history;
DELETE FROM cirt_payroll_master
WHERE employee_user_id IN (SELECT id FROM reset_employee_users);
DELETE FROM cirt_payroll_periods;

DELETE FROM cirt_quarter_assignments;
UPDATE cirt_quarters
SET status = 'available', assigned_employee_id = NULL, assigned_from = NULL, assigned_to = NULL
WHERE assigned_employee_id IS NOT NULL OR status = 'assigned';

DELETE FROM cirt_employee_bank_accounts
WHERE user_id IN (SELECT id FROM reset_employee_users);
UPDATE cirt_employees
SET manager_id = NULL
WHERE manager_id IN (SELECT id FROM cirt_employees WHERE user_id IN (SELECT id FROM reset_employee_users));
DELETE FROM cirt_employees
WHERE user_id IN (SELECT id FROM reset_employee_users);
DELETE FROM personal_access_tokens
WHERE tokenable_id::text IN (SELECT id::text FROM reset_employee_users);
DELETE FROM cirt_users
WHERE id IN (SELECT id FROM reset_employee_users);

DO $$
BEGIN
    IF (SELECT count(*) FROM cirt_users WHERE role = 'super_admin') <> 1 THEN
        RAISE EXCEPTION 'Reset rollback: super-admin preservation check failed';
    END IF;
END $$;

COMMIT;
