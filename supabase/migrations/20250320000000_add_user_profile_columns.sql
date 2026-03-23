-- Run this in Supabase SQL Editor if you get "column 'aadhaar' does not exist"
alter table if exists "HRMS_users" add column if not exists designation text;
alter table if exists "HRMS_users" add column if not exists aadhaar text;
alter table if exists "HRMS_users" add column if not exists pan text;
alter table if exists "HRMS_users" add column if not exists uan_number text;
alter table if exists "HRMS_users" add column if not exists pf_number text;
alter table if exists "HRMS_users" add column if not exists esic_number text;
