-- Retire PF Loan, STD licence fee, and Vehicle Charge from payroll field definitions.
UPDATE cirt_payroll_field_definitions
SET
  is_active = false,
  show_in_payroll_master = false,
  show_in_run_payroll = false,
  show_in_salary_slip = false,
  include_in_total_deductions = false,
  updated_at = NOW()
WHERE field_key IN ('pf_loan', 'standard_licence_fee', 'vehicle_charge');
