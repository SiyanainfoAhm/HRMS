-- Salary component breakdown for payslips (Basic, HRA, Medical, Trans, LTA, Personal)
alter table if exists "HRMS_payroll_master" add column if not exists basic numeric(12,2) default 0;
alter table if exists "HRMS_payroll_master" add column if not exists hra numeric(12,2) default 0;
alter table if exists "HRMS_payroll_master" add column if not exists medical numeric(12,2) default 0;
alter table if exists "HRMS_payroll_master" add column if not exists trans numeric(12,2) default 0;
alter table if exists "HRMS_payroll_master" add column if not exists lta numeric(12,2) default 0;
alter table if exists "HRMS_payroll_master" add column if not exists personal numeric(12,2) default 0;

alter table if exists "HRMS_payslips" add column if not exists medical numeric(12,2) default 0;
alter table if exists "HRMS_payslips" add column if not exists trans numeric(12,2) default 0;
alter table if exists "HRMS_payslips" add column if not exists lta numeric(12,2) default 0;
alter table if exists "HRMS_payslips" add column if not exists personal numeric(12,2) default 0;
