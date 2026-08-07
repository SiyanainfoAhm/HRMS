-- Add gender column to HRMS_users
alter table if exists "HRMS_users" add column if not exists gender text check (gender in ('male', 'female', 'other'));
