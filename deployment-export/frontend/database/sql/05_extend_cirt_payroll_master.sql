-- 05_extend_cirt_payroll_master.sql
-- Manual Supabase / pgAdmin script: extend cirt_payroll_master for employee salary master.
-- Idempotent: safe to run multiple times.
-- Run after 02_rename_hrms_tables_to_cirt_tables.sql

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cirt_payroll_master') THEN
        RAISE NOTICE 'cirt_payroll_master does not exist — skip';
        RETURN;
    END IF;

    -- Identity & org
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS employee_id UUID NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS user_id UUID NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS employee_code VARCHAR(255) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS name VARCHAR(255) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS email VARCHAR(255) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS phone VARCHAR(20) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS gender VARCHAR(20) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS designation VARCHAR(255) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS department VARCHAR(255) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS division VARCHAR(255) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS pay_level INTEGER NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS gross_basic_pay NUMERIC(12,2) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS medical NUMERIC(12,2) NULL;

    -- Transport & earnings
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS transport_da NUMERIC(12,2) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS transport_total NUMERIC(12,2) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS total_earnings NUMERIC(12,2) NULL;

    -- Deductions
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS cpf_effective NUMERIC(12,2) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS da_cpf NUMERIC(12,2) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS professional_tax NUMERIC(12,2) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS income_tax NUMERIC(12,2) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS lic NUMERIC(12,2) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS mess NUMERIC(12,2) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS welfare NUMERIC(12,2) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS vpf NUMERIC(12,2) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS pf_loan NUMERIC(12,2) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS post_office NUMERIC(12,2) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS credit_society NUMERIC(12,2) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS standard_licence_fee NUMERIC(12,2) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS electricity NUMERIC(12,2) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS water NUMERIC(12,2) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS horticulture NUMERIC(12,2) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS vehicle_charge NUMERIC(12,2) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS other_deduction NUMERIC(12,2) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS advance NUMERIC(12,2) NULL;

    -- IDs & bank
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS uan VARCHAR(50) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS cpf_no VARCHAR(50) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS pan VARCHAR(20) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS aadhaar VARCHAR(12) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS bank_name VARCHAR(255) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS bank_account_number VARCHAR(50) NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS bank_ifsc VARCHAR(20) NULL;

    -- Dates & status
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS date_of_joining DATE NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS date_of_birth DATE NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS remarks TEXT NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS effective_from DATE NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS effective_to DATE NULL;
    ALTER TABLE cirt_payroll_master ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NULL;

    -- Backfill from legacy columns
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cirt_payroll_master' AND column_name = 'employee_user_id') THEN
        UPDATE cirt_payroll_master SET user_id = employee_user_id WHERE user_id IS NULL AND employee_user_id IS NOT NULL;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cirt_payroll_master' AND column_name = 'gross_basic') THEN
        UPDATE cirt_payroll_master SET gross_basic_pay = COALESCE(gross_basic_pay, gross_basic, gross_salary) WHERE gross_basic_pay IS NULL;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cirt_payroll_master' AND column_name = 'effective_start_date') THEN
        UPDATE cirt_payroll_master SET effective_from = COALESCE(effective_from, effective_start_date) WHERE effective_from IS NULL;
    END IF;

    UPDATE cirt_payroll_master SET status = 'active' WHERE status IS NULL;

    RAISE NOTICE 'cirt_payroll_master extended successfully';
END $$;

COMMIT;
