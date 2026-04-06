-- Explicit lunch punch times for 4-step flow: first in → lunch out → lunch in → final out
alter table if exists "HRMS_attendance_logs"
  add column if not exists lunch_check_out_at timestamptz,
  add column if not exists lunch_check_in_at timestamptz;
