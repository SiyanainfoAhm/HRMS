alter table if exists "HRMS_payroll_master"
  add column if not exists tds numeric(12,2) not null default 0;

alter table if exists "HRMS_payroll_master"
  add column if not exists advance_bonus numeric(12,2) not null default 0;
