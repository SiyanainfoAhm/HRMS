-- 06_rename_horticulture_to_loan_recovery.sql
-- Rename deduction field Horticulture → Loan Recovery (display: Bank Recovery).
-- Idempotent: safe to run multiple times.
-- Run after 05_extend_cirt_payroll_master.sql

BEGIN;

DO $$
BEGIN
    -- cirt_payroll_master
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'cirt_payroll_master' AND column_name = 'horticulture'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'cirt_payroll_master' AND column_name = 'loan_recovery'
    ) THEN
        ALTER TABLE public.cirt_payroll_master RENAME COLUMN horticulture TO loan_recovery;
        RAISE NOTICE 'Renamed cirt_payroll_master.horticulture → loan_recovery';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'cirt_payroll_master' AND column_name = 'horticulture_default'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'cirt_payroll_master' AND column_name = 'loan_recovery_default'
    ) THEN
        ALTER TABLE public.cirt_payroll_master RENAME COLUMN horticulture_default TO loan_recovery_default;
        RAISE NOTICE 'Renamed cirt_payroll_master.horticulture_default → loan_recovery_default';
    END IF;

    -- cirt_payroll_master_history
    IF to_regclass('public.cirt_payroll_master_history') IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'cirt_payroll_master_history' AND column_name = 'horticulture'
        ) AND NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'cirt_payroll_master_history' AND column_name = 'loan_recovery'
        ) THEN
            ALTER TABLE public.cirt_payroll_master_history RENAME COLUMN horticulture TO loan_recovery;
            RAISE NOTICE 'Renamed cirt_payroll_master_history.horticulture → loan_recovery';
        END IF;

        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'cirt_payroll_master_history' AND column_name = 'horticulture_default'
        ) AND NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'cirt_payroll_master_history' AND column_name = 'loan_recovery_default'
        ) THEN
            ALTER TABLE public.cirt_payroll_master_history RENAME COLUMN horticulture_default TO loan_recovery_default;
            RAISE NOTICE 'Renamed cirt_payroll_master_history.horticulture_default → loan_recovery_default';
        END IF;
    END IF;

    -- cirt_monthly_payroll (government run / payslip deductions)
    IF to_regclass('public.cirt_monthly_payroll') IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'cirt_monthly_payroll' AND column_name = 'horticulture_amount'
        ) AND NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'cirt_monthly_payroll' AND column_name = 'loan_recovery_amount'
        ) THEN
            ALTER TABLE public.cirt_monthly_payroll RENAME COLUMN horticulture_amount TO loan_recovery_amount;
            RAISE NOTICE 'Renamed cirt_monthly_payroll.horticulture_amount → loan_recovery_amount';
        END IF;
    END IF;
END $$;

COMMIT;
