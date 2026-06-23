-- Payroll master history split (run after cirt_payroll_master exists)
-- Laravel migration: 2026_06_18_100000_create_cirt_payroll_master_history_and_cleanup.php

CREATE TABLE IF NOT EXISTS cirt_payroll_master_history (LIKE cirt_payroll_master INCLUDING DEFAULTS EXCLUDING CONSTRAINTS);
ALTER TABLE cirt_payroll_master_history RENAME COLUMN id TO original_master_id;
ALTER TABLE cirt_payroll_master_history ADD COLUMN IF NOT EXISTS history_id UUID PRIMARY KEY DEFAULT gen_random_uuid();
ALTER TABLE cirt_payroll_master_history ADD COLUMN IF NOT EXISTS archive_action TEXT NOT NULL DEFAULT 'REVISION';
ALTER TABLE cirt_payroll_master_history ADD COLUMN IF NOT EXISTS archive_reason TEXT NULL;
ALTER TABLE cirt_payroll_master_history ADD COLUMN IF NOT EXISTS is_superseded BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE cirt_payroll_master_history ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE cirt_payroll_master_history ADD COLUMN IF NOT EXISTS archived_by UUID NULL;
ALTER TABLE cirt_payroll_master_history ADD COLUMN IF NOT EXISTS replaced_by_master_id UUID NULL;

-- Verification after Laravel data cleanup migration:
-- SELECT company_id, employee_user_id, COUNT(*) FROM cirt_payroll_master GROUP BY 1,2 HAVING COUNT(*) > 1;
