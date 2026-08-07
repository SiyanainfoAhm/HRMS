-- 06_make_payroll_master_user_ids_nullable.sql
-- Payroll master rows can exist without a linked login (import / manual add).
-- Idempotent: safe to run multiple times.

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cirt_payroll_master') THEN
        RAISE NOTICE 'cirt_payroll_master does not exist — skip';
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'cirt_payroll_master' AND column_name = 'employee_user_id'
    ) THEN
        ALTER TABLE cirt_payroll_master ALTER COLUMN employee_user_id DROP NOT NULL;
        RAISE NOTICE 'employee_user_id is now nullable';
    END IF;
END $$;

COMMIT;
