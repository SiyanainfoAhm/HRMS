-- Monthly payroll leave remarks (run-time only; not Payroll Master).
-- Mirror of Laravel migration 2026_07_26_100000_add_leave_remarks_to_monthly_payroll.php

ALTER TABLE cirt_monthly_payroll
  ADD COLUMN IF NOT EXISTS leave_remarks TEXT NULL;
