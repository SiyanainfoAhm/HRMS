-- Add excel_file_path column to HRMS_payroll_periods for storing uploaded payroll Excel path
alter table if exists "HRMS_payroll_periods" add column if not exists excel_file_path text;
