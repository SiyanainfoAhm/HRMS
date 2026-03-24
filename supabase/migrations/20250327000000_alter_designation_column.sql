-- Ensure designation (text) column exists in HRMS_users for free-form storage
alter table if exists "HRMS_users" add column if not exists designation text;
