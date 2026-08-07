-- Store tea break as out/in timestamps (like lunch), not only minutes.

alter table if exists "HRMS_attendance_logs" add column if not exists tea_check_out_at timestamptz;
alter table if exists "HRMS_attendance_logs" add column if not exists tea_check_in_at timestamptz;

