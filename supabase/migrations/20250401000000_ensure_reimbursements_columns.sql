-- Ensure HRMS_reimbursements has columns required by the app (safe to re-run).

alter table if exists "HRMS_reimbursements" add column if not exists payroll_year integer;
alter table if exists "HRMS_reimbursements" add column if not exists payroll_month integer;

update "HRMS_reimbursements" r
set
  payroll_year = coalesce(r.payroll_year, extract(year from r.claim_date)::integer),
  payroll_month = coalesce(r.payroll_month, extract(month from r.claim_date)::integer)
where r.payroll_year is null or r.payroll_month is null;

update "HRMS_reimbursements"
set
  payroll_year = extract(year from current_date)::integer,
  payroll_month = extract(month from current_date)::integer
where payroll_year is null or payroll_month is null;

alter table if exists "HRMS_reimbursements" add column if not exists employee_user_id uuid;
alter table if exists "HRMS_reimbursements" add column if not exists approver_user_id uuid;
alter table if exists "HRMS_reimbursements" add column if not exists rejection_reason text;
alter table if exists "HRMS_reimbursements" add column if not exists included_in_payroll_period_id uuid;

do $$
begin
  alter table only "HRMS_reimbursements"
    add constraint hrms_reimbursements_employee_user_id_fkey
    foreign key (employee_user_id) references "HRMS_users"(id) on delete cascade;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table only "HRMS_reimbursements"
    add constraint hrms_reimbursements_approver_user_id_fkey
    foreign key (approver_user_id) references "HRMS_users"(id) on delete set null;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table only "HRMS_reimbursements"
    add constraint hrms_reimbursements_included_payroll_period_fkey
    foreign key (included_in_payroll_period_id) references "HRMS_payroll_periods"(id) on delete set null;
exception
  when duplicate_object then null;
end $$;

update "HRMS_reimbursements" r
set employee_user_id = e.user_id
from "HRMS_employees" e
where e.id = r.employee_id and r.employee_user_id is null and e.user_id is not null;

alter table "HRMS_reimbursements" alter column payroll_year set not null;
alter table "HRMS_reimbursements" alter column payroll_month set not null;

create index if not exists hrms_reimbursements_payroll_pending_idx
  on "HRMS_reimbursements"(company_id, payroll_year, payroll_month)
  where status = 'approved' and included_in_payroll_period_id is null;
