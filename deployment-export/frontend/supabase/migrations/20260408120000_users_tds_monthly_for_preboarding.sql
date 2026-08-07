-- Store draft monthly TDS on user record (preboarding).
-- Payroll master should only contain current employees.

alter table "HRMS_users"
  add column if not exists tds_monthly numeric;

