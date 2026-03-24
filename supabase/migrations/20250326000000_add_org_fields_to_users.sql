-- Add designation_id, department_id, division_id, shift_id to HRMS_users for employee org structure
alter table if exists "HRMS_users" add column if not exists designation_id uuid references "HRMS_designations"(id) on delete set null;
alter table if exists "HRMS_users" add column if not exists department_id uuid references "HRMS_departments"(id) on delete set null;
alter table if exists "HRMS_users" add column if not exists division_id uuid references "HRMS_divisions"(id) on delete set null;
alter table if exists "HRMS_users" add column if not exists shift_id uuid references "HRMS_shifts"(id) on delete set null;
