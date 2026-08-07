-- Attendance: store break durations used for payroll active-hours calculation

alter table if exists "HRMS_attendance_logs"
  add column if not exists lunch_break_minutes integer not null default 0;

alter table if exists "HRMS_attendance_logs"
  add column if not exists tea_break_minutes integer not null default 0;

-- Helpful index for payroll month queries
create index if not exists hrms_attendance_logs_company_date_idx
  on "HRMS_attendance_logs"(company_id, work_date);

