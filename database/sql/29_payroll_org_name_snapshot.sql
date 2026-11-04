-- Saved payroll rows carry the division / designation they were generated with, so renaming a division in Settings
-- never rewrites an old month in reports. Additive: no payroll amount is touched. Same change as the Laravel
-- migration 2026_11_04_100000_add_org_name_snapshot_to_monthly_payroll (run one or the other, not both).
BEGIN;
ALTER TABLE cirt_monthly_payroll ADD COLUMN IF NOT EXISTS division_name VARCHAR(255) NULL;
ALTER TABLE cirt_monthly_payroll ADD COLUMN IF NOT EXISTS designation_name VARCHAR(255) NULL;

UPDATE cirt_monthly_payroll m
SET division_name = NULLIF(BTRIM(pm.division), ''),
    designation_name = NULLIF(BTRIM(pm.designation), '')
FROM cirt_payroll_master pm
WHERE pm.id = m.payroll_master_id
  AND m.division_name IS NULL AND m.designation_name IS NULL;
COMMIT;

-- Rollback:
-- ALTER TABLE cirt_monthly_payroll DROP COLUMN IF EXISTS division_name, DROP COLUMN IF EXISTS designation_name;
