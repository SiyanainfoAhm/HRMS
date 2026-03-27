-- HRMS schema for Supabase (no RLS policies)
-- All tables are prefixed with HRMS_

create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

create table if not exists "HRMS_companies" (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique,
  industry text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  country text,
  postal_code text,
  phone text,
  professional_tax_annual numeric(12,2) not null default 200,
  professional_tax_monthly numeric(12,2) not null default 200,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- App auth: users with hashed passwords (use with your app login/signup)
create table if not exists "HRMS_users" (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  name text,
  employee_code text,
  phone text,
  date_of_birth date,
  date_of_joining date,
  current_address_line1 text,
  current_address_line2 text,
  current_city text,
  current_state text,
  current_country text,
  current_postal_code text,
  permanent_address_line1 text,
  permanent_address_line2 text,
  permanent_city text,
  permanent_state text,
  permanent_country text,
  permanent_postal_code text,
  emergency_contact_name text,
  emergency_contact_phone text,
  bank_name text,
  bank_account_number text,
  bank_ifsc text,
  employment_status text not null default 'preboarding' check (employment_status in ('preboarding', 'current', 'past')),
  role text not null default 'employee' check (role in ('super_admin', 'admin', 'hr', 'manager', 'employee')),
  company_id uuid references "HRMS_companies"(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- If you already created the tables, run these ALTERs in Supabase SQL editor
alter table if exists "HRMS_users" add column if not exists employee_code text;
alter table if exists "HRMS_users" add column if not exists phone text;
alter table if exists "HRMS_users" add column if not exists date_of_birth date;
alter table if exists "HRMS_users" add column if not exists date_of_joining date;
alter table if exists "HRMS_users" add column if not exists date_of_leaving date;
alter table if exists "HRMS_users" add column if not exists current_address_line1 text;
alter table if exists "HRMS_users" add column if not exists current_address_line2 text;
alter table if exists "HRMS_users" add column if not exists current_city text;
alter table if exists "HRMS_users" add column if not exists current_state text;
alter table if exists "HRMS_users" add column if not exists current_country text;
alter table if exists "HRMS_users" add column if not exists current_postal_code text;
alter table if exists "HRMS_users" add column if not exists permanent_address_line1 text;
alter table if exists "HRMS_users" add column if not exists permanent_address_line2 text;
alter table if exists "HRMS_users" add column if not exists permanent_city text;
alter table if exists "HRMS_users" add column if not exists permanent_state text;
alter table if exists "HRMS_users" add column if not exists permanent_country text;
alter table if exists "HRMS_users" add column if not exists permanent_postal_code text;
alter table if exists "HRMS_users" add column if not exists emergency_contact_name text;
alter table if exists "HRMS_users" add column if not exists emergency_contact_phone text;
alter table if exists "HRMS_users" add column if not exists bank_name text;
alter table if exists "HRMS_users" add column if not exists bank_account_number text;
alter table if exists "HRMS_users" add column if not exists bank_ifsc text;
alter table if exists "HRMS_users" add column if not exists employment_status text;
alter table if exists "HRMS_users" alter column employment_status set default 'preboarding';
alter table if exists "HRMS_users" add column if not exists ctc numeric(12,2);
alter table if exists "HRMS_users" add column if not exists gender text check (gender in ('male', 'female', 'other'));
alter table if exists "HRMS_users" add column if not exists designation text;
alter table if exists "HRMS_users" add column if not exists aadhaar text;
alter table if exists "HRMS_users" add column if not exists pan text;
alter table if exists "HRMS_users" add column if not exists uan_number text;
alter table if exists "HRMS_users" add column if not exists pf_number text;
alter table if exists "HRMS_users" add column if not exists esic_number text;

-- Employee code uniqueness per company (when company_id is set)
create unique index if not exists hrms_users_company_employee_code_uniq
  on "HRMS_users"(company_id, employee_code)
  where employee_code is not null and company_id is not null;

do $$
begin
  create type HRMS_role_key as enum ('super_admin','admin','hr','manager','employee');
exception
  when duplicate_object then null;
end $$;

create table if not exists "HRMS_roles" (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references "HRMS_companies"(id) on delete cascade,
  role_key HRMS_role_key not null,
  name text not null,
  description text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  unique (company_id, role_key)
);
alter table if exists "HRMS_roles" add column if not exists is_active boolean;
alter table if exists "HRMS_roles" alter column is_active set default true;

create table if not exists "HRMS_divisions" (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references "HRMS_companies"(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  is_active boolean not null default true,
  unique (company_id, name)
);
alter table if exists "HRMS_divisions" add column if not exists is_active boolean;
alter table if exists "HRMS_divisions" alter column is_active set default true;

create table if not exists "HRMS_departments" (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references "HRMS_companies"(id) on delete cascade,
  division_id uuid references "HRMS_divisions"(id) on delete set null,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  is_active boolean not null default true,
  unique (company_id, name)
);
alter table if exists "HRMS_departments" add column if not exists is_active boolean;
alter table if exists "HRMS_departments" alter column is_active set default true;

create table if not exists "HRMS_designations" (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references "HRMS_companies"(id) on delete cascade,
  title text not null,
  level int,
  created_at timestamptz not null default now(),
  is_active boolean not null default true,
  unique (company_id, title)
);
alter table if exists "HRMS_designations" add column if not exists is_active boolean;
alter table if exists "HRMS_designations" alter column is_active set default true;

create table if not exists "HRMS_shifts" (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references "HRMS_companies"(id) on delete cascade,
  name text not null,
  start_time time not null,
  end_time time not null,
  is_night_shift boolean not null default false,
  created_at timestamptz not null default now(),
  is_active boolean not null default true,
  unique (company_id, name)
);
alter table if exists "HRMS_shifts" add column if not exists is_active boolean;
alter table if exists "HRMS_shifts" alter column is_active set default true;

create table if not exists "HRMS_employees" (
  id uuid primary key default gen_random_uuid(),
  -- For Supabase Auth based flows
  auth_user_id uuid references auth.users(id) on delete cascade,
  -- For custom auth based flows (this app)
  user_id uuid references "HRMS_users"(id) on delete cascade,
  company_id uuid not null references "HRMS_companies"(id) on delete cascade,
  employee_code text,
  first_name text not null,
  last_name text,
  email text not null,
  phone text,
  date_of_birth date,
  date_of_joining date,
  date_of_leaving date,
  division_id uuid references "HRMS_divisions"(id) on delete set null,
  department_id uuid references "HRMS_departments"(id) on delete set null,
  designation_id uuid references "HRMS_designations"(id) on delete set null,
  shift_id uuid references "HRMS_shifts"(id) on delete set null,
  manager_id uuid references "HRMS_employees"(id) on delete set null,
  role_id uuid references "HRMS_roles"(id) on delete set null,
  is_active boolean not null default true,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  country text,
  postal_code text,
  emergency_contact_name text,
  emergency_contact_phone text,
  bank_account_number text,
  bank_ifsc text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, employee_code),
  unique (auth_user_id),
  unique (user_id)
);

-- If you already created HRMS_employees, run these ALTERs
alter table if exists "HRMS_employees" alter column auth_user_id drop not null;
alter table if exists "HRMS_employees" add column if not exists user_id uuid;
alter table if exists "HRMS_employees" add column if not exists date_of_leaving date;
do $$
begin
  alter table "HRMS_employees"
    add constraint hrms_employees_user_id_fkey
    foreign key (user_id) references "HRMS_users"(id) on delete cascade;
exception
  when duplicate_object then null;
end $$;
create unique index if not exists hrms_employees_user_id_uniq on "HRMS_employees"(user_id) where user_id is not null;

create table if not exists "HRMS_attendance_logs" (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references "HRMS_companies"(id) on delete cascade,
  employee_id uuid not null references "HRMS_employees"(id) on delete cascade,
  work_date date not null,
  check_in_at timestamptz,
  check_in_lat numeric(9,6),
  check_in_lng numeric(9,6),
  check_out_at timestamptz,
  check_out_lat numeric(9,6),
  check_out_lng numeric(9,6),
  total_hours numeric(6,2),
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, work_date)
);

create table if not exists "HRMS_leave_types" (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references "HRMS_companies"(id) on delete cascade,
  name text not null,
  code text,
  description text,
  is_paid boolean not null default true,
  annual_quota numeric(5,2),
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

do $$
begin
  create type HRMS_leave_accrual_method as enum ('monthly','annual','none');
exception
  when duplicate_object then null;
end $$;

create table if not exists "HRMS_leave_policies" (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references "HRMS_companies"(id) on delete cascade,
  leave_type_id uuid not null references "HRMS_leave_types"(id) on delete cascade,
  accrual_method HRMS_leave_accrual_method not null default 'annual',
  monthly_accrual_rate numeric(5,2),
  annual_quota numeric(5,2),
  prorate_on_join boolean not null default true,
  reset_month int not null default 1,
  reset_day int not null default 1,
  allow_carryover boolean not null default false,
  carryover_limit numeric(5,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, leave_type_id)
);

do $$
begin
  create type HRMS_leave_status as enum ('pending','approved','rejected','cancelled');
exception
  when duplicate_object then null;
end $$;

create table if not exists "HRMS_leave_requests" (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references "HRMS_companies"(id) on delete cascade,
  employee_id uuid references "HRMS_employees"(id) on delete cascade,
  employee_user_id uuid references "HRMS_users"(id) on delete cascade,
  manager_id uuid references "HRMS_employees"(id) on delete set null,
  department_id uuid references "HRMS_departments"(id) on delete set null,
  leave_type_id uuid not null references "HRMS_leave_types"(id) on delete restrict,
  start_date date not null,
  end_date date not null,
  total_days numeric(5,2) not null,
  reason text,
  status HRMS_leave_status not null default 'pending',
  approver_id uuid references "HRMS_employees"(id) on delete set null,
  approver_user_id uuid references "HRMS_users"(id) on delete set null,
  approved_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists "HRMS_leave_requests" add column if not exists employee_user_id uuid;
alter table if exists "HRMS_leave_requests" add column if not exists approver_user_id uuid;
alter table if exists "HRMS_leave_requests" add column if not exists paid_days numeric(5,2);
alter table if exists "HRMS_leave_requests" add column if not exists unpaid_days numeric(5,2);

create table if not exists "HRMS_holidays" (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references "HRMS_companies"(id) on delete cascade,
  name text not null,
  holiday_date date not null,
  is_optional boolean not null default false,
  location text,
  created_at timestamptz not null default now(),
  unique (company_id, holiday_date, name)
);

create table if not exists "HRMS_payroll_periods" (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references "HRMS_companies"(id) on delete cascade,
  period_name text not null,
  period_start date not null,
  period_end date not null,
  is_locked boolean not null default false,
  created_at timestamptz not null default now(),
  unique (company_id, period_start, period_end)
);
alter table if exists "HRMS_payroll_periods" add column if not exists excel_file_path text;

create table if not exists "HRMS_payslips" (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references "HRMS_companies"(id) on delete cascade,
  employee_id uuid not null references "HRMS_employees"(id) on delete cascade,
  -- For custom auth flows that do not use auth.users / HRMS_employees
  employee_user_id uuid references "HRMS_users"(id) on delete cascade,
  payroll_period_id uuid not null references "HRMS_payroll_periods"(id) on delete cascade,
  basic numeric(12,2) not null default 0,
  hra numeric(12,2) not null default 0,
  allowances numeric(12,2) not null default 0,
  deductions numeric(12,2) not null default 0,
  gross_pay numeric(12,2) not null default 0,
  net_pay numeric(12,2) not null default 0,
  currency char(3) not null default 'INR',
  payslip_number text,
  -- Bank snapshot for audit & correctness
  bank_name text,
  bank_account_number text,
  bank_ifsc text,
  generated_at timestamptz not null default now(),
  created_by uuid references "HRMS_employees"(id),
  unique (employee_id, payroll_period_id)
);

-- Bank accounts history (custom auth)
create table if not exists "HRMS_employee_bank_accounts" (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references "HRMS_companies"(id) on delete cascade,
  user_id uuid not null references "HRMS_users"(id) on delete cascade,
  bank_name text,
  bank_account_number text,
  bank_ifsc text,
  is_active boolean not null default true,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_by uuid references "HRMS_users"(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists hrms_employee_bank_accounts_user_active_idx
  on "HRMS_employee_bank_accounts"(user_id, is_active);

-- If you already created the tables, run these ALTERs in Supabase SQL editor
alter table if exists "HRMS_payslips" add column if not exists employee_user_id uuid;
alter table if exists "HRMS_payslips" add column if not exists bank_name text;
alter table if exists "HRMS_payslips" add column if not exists bank_account_number text;
alter table if exists "HRMS_payslips" add column if not exists bank_ifsc text;
alter table if exists "HRMS_payslips" add column if not exists pay_days numeric(5,2);
alter table if exists "HRMS_payslips" add column if not exists ctc numeric(12,2);
alter table if exists "HRMS_payslips" add column if not exists pf_employee numeric(12,2) default 0;
alter table if exists "HRMS_payslips" add column if not exists pf_employer numeric(12,2) default 0;
alter table if exists "HRMS_payslips" add column if not exists esic_employee numeric(12,2) default 0;
alter table if exists "HRMS_payslips" add column if not exists esic_employer numeric(12,2) default 0;
alter table if exists "HRMS_payslips" add column if not exists professional_tax numeric(12,2) default 0;
alter table if exists "HRMS_payslips" add column if not exists incentive numeric(12,2) default 0;
alter table if exists "HRMS_payslips" add column if not exists pr_bonus numeric(12,2) default 0;
alter table if exists "HRMS_payslips" add column if not exists reimbursement numeric(12,2) default 0;
alter table if exists "HRMS_payslips" add column if not exists tds numeric(12,2) default 0;
alter table if exists "HRMS_payslips" alter column employee_id drop not null;
create unique index if not exists hrms_payslips_period_user_uniq on "HRMS_payslips"(payroll_period_id, employee_user_id) where employee_user_id is not null;
alter table if exists "HRMS_payslips" add column if not exists medical numeric(12,2) default 0;
alter table if exists "HRMS_payslips" add column if not exists trans numeric(12,2) default 0;
alter table if exists "HRMS_payslips" add column if not exists lta numeric(12,2) default 0;
alter table if exists "HRMS_payslips" add column if not exists personal numeric(12,2) default 0;
alter table if exists "HRMS_payroll_master" add column if not exists basic numeric(12,2) default 0;
alter table if exists "HRMS_payroll_master" add column if not exists hra numeric(12,2) default 0;
alter table if exists "HRMS_payroll_master" add column if not exists medical numeric(12,2) default 0;
alter table if exists "HRMS_payroll_master" add column if not exists trans numeric(12,2) default 0;
alter table if exists "HRMS_payroll_master" add column if not exists lta numeric(12,2) default 0;
alter table if exists "HRMS_payroll_master" add column if not exists personal numeric(12,2) default 0;

-- Payroll master: salary structure per employee, versioned by effective dates
create table if not exists "HRMS_payroll_master" (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references "HRMS_companies"(id) on delete cascade,
  employee_user_id uuid not null references "HRMS_users"(id) on delete cascade,
  gross_salary numeric(12,2) not null default 0,
  ctc numeric(12,2) not null default 0,
  pf_eligible boolean not null default false,
  esic_eligible boolean not null default false,
  pf_employee numeric(12,2) not null default 0,
  pf_employer numeric(12,2) not null default 0,
  esic_employee numeric(12,2) not null default 0,
  esic_employer numeric(12,2) not null default 0,
  pt numeric(12,2) not null default 0,
  take_home numeric(12,2) not null default 0,
  effective_start_date date not null,
  effective_end_date date,
  reason_for_change text,
  created_at timestamptz not null default now(),
  created_by uuid references "HRMS_users"(id) on delete set null
);
create index if not exists hrms_payroll_master_user_effective_idx on "HRMS_payroll_master"(employee_user_id, effective_end_date);

alter table if exists "HRMS_users" add column if not exists gross_salary numeric(12,2);
alter table if exists "HRMS_users" add column if not exists pf_eligible boolean default false;
alter table if exists "HRMS_users" add column if not exists esic_eligible boolean default false;
alter table if exists "HRMS_companies" add column if not exists professional_tax_annual numeric(12,2) default 200;
alter table if exists "HRMS_companies" add column if not exists professional_tax_monthly numeric(12,2) default 200;

do $$
begin
  create type HRMS_company_document_kind as enum ('upload','digital_signature');
exception
  when duplicate_object then null;
end $$;

create table if not exists "HRMS_company_documents" (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references "HRMS_companies"(id) on delete cascade,
  name text not null,
  kind HRMS_company_document_kind not null,
  is_mandatory boolean not null default true,
  -- For digital signature documents (e.g. Offer Letter), store the content/template reference.
  content_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);

create table if not exists "HRMS_employee_invites" (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references "HRMS_companies"(id) on delete cascade,
  user_id uuid references "HRMS_users"(id) on delete set null,
  email text not null,
  token text not null unique,
  requested_document_ids jsonb,
  status text not null default 'pending' check (status in ('pending','completed','expired','revoked')),
  expires_at timestamptz,
  completed_at timestamptz,
  created_by uuid references "HRMS_users"(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists hrms_employee_invites_company_email_idx on "HRMS_employee_invites"(company_id, email);

create table if not exists "HRMS_employee_document_submissions" (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references "HRMS_companies"(id) on delete cascade,
  invite_id uuid references "HRMS_employee_invites"(id) on delete cascade,
  user_id uuid references "HRMS_users"(id) on delete cascade,
  document_id uuid not null references "HRMS_company_documents"(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','submitted','signed','approved','rejected')),
  file_url text,
  signature_name text,
  signed_at timestamptz,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references "HRMS_users"(id) on delete set null,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (invite_id, document_id),
  unique (user_id, document_id)
);

do $$
begin
  create type HRMS_reimbursement_status as enum ('pending','approved','rejected','paid');
exception
  when duplicate_object then null;
end $$;

create table if not exists "HRMS_reimbursements" (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references "HRMS_companies"(id) on delete cascade,
  employee_id uuid not null references "HRMS_employees"(id) on delete cascade,
  department_id uuid references "HRMS_departments"(id) on delete set null,
  category text not null,
  amount numeric(12,2) not null,
  currency char(3) not null default 'INR',
  claim_date date not null,
  description text,
  attachment_url text,
  status HRMS_reimbursement_status not null default 'pending',
  approver_id uuid references "HRMS_employees"(id) on delete set null,
  approver_user_id uuid references "HRMS_users"(id) on delete set null,
  employee_user_id uuid references "HRMS_users"(id) on delete cascade,
  payroll_year integer not null default (extract(year from current_date))::integer,
  payroll_month integer not null default (extract(month from current_date))::integer,
  rejection_reason text,
  included_in_payroll_period_id uuid references "HRMS_payroll_periods"(id) on delete set null,
  approved_at timestamptz,
  rejected_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists "HRMS_notifications" (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references "HRMS_companies"(id) on delete cascade,
  title text not null,
  message text not null,
  audience text not null,
  department_id uuid references "HRMS_departments"(id) on delete set null,
  employee_id uuid references "HRMS_employees"(id) on delete set null,
  created_by uuid references "HRMS_employees"(id) on delete set null,
  created_at timestamptz not null default now(),
  valid_from timestamptz,
  valid_to timestamptz
);

