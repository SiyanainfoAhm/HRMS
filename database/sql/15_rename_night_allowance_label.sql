-- Rename Night Allowance display label to N. All.
UPDATE cirt_payroll_field_definitions
SET field_label = 'N. All.', updated_at = NOW()
WHERE field_key = 'night_allowance';
