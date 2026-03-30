-- Attendance: persist running break timers across tab close

alter table if exists "HRMS_attendance_logs"
  add column if not exists lunch_break_started_at timestamptz;

alter table if exists "HRMS_attendance_logs"
  add column if not exists tea_break_started_at timestamptz;

create index if not exists hrms_attendance_logs_employee_date_idx
  on "HRMS_attendance_logs"(employee_id, work_date);

