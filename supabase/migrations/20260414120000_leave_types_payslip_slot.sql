-- Map leave types to government-style payslip rows (CL / EL / HPL / HL).

alter table if exists "HRMS_leave_types"
  add column if not exists payslip_slot text;

do $$
begin
  alter table "HRMS_leave_types"
    add constraint hrms_leave_types_payslip_slot_chk
    check (payslip_slot is null or payslip_slot in ('CL', 'EL', 'HPL', 'HL'));
exception
  when duplicate_object then null;
end $$;

comment on column "HRMS_leave_types".payslip_slot is
  'Optional payslip line: CL=casual, EL=earned, HPL=half pay leave, HL=half leave. Unset = not shown on government payslip leave block.';

-- Default mapping for seeded codes (idempotent).
update "HRMS_leave_types"
set payslip_slot = 'EL'
where (code ilike 'PAID' or upper(trim(code)) = 'EL')
  and payslip_slot is null;

update "HRMS_leave_types"
set payslip_slot = 'CL'
where (code ilike 'SICK' or upper(trim(code)) = 'CL')
  and payslip_slot is null;

-- Friendly names on canonical rows (only when still default names).
update "HRMS_leave_types"
set name = 'Earned Leave'
where payslip_slot = 'EL' and trim(name) = 'Paid Leave';

update "HRMS_leave_types"
set name = 'Casual Leave'
where payslip_slot = 'CL' and trim(name) = 'Sick Leave';

-- Half Leave + Half Pay Leave per company (skip if code already exists).
insert into "HRMS_leave_types" (company_id, name, code, description, is_paid, payslip_slot)
select c.id, 'Half Leave', 'HL', 'Half-day leave (counts in days, e.g. 0.5)', true, 'HL'
from "HRMS_companies" c
where not exists (
  select 1 from "HRMS_leave_types" t
  where t.company_id = c.id and (t.code = 'HL' or t.payslip_slot = 'HL')
);

insert into "HRMS_leave_types" (company_id, name, code, description, is_paid, payslip_slot)
select c.id, 'Half Pay Leave', 'HPL', 'Leave on half pay', true, 'HPL'
from "HRMS_companies" c
where not exists (
  select 1 from "HRMS_leave_types" t
  where t.company_id = c.id and (t.code = 'HPL' or t.payslip_slot = 'HPL')
);

-- Policies for new types (same calendar reset as other types).
insert into "HRMS_leave_policies" (
  company_id, leave_type_id, accrual_method, monthly_accrual_rate, annual_quota,
  prorate_on_join, reset_month, reset_day, allow_carryover, carryover_limit
)
select t.company_id, t.id, 'monthly', 0.5, 6, true, 1, 1, false, null
from "HRMS_leave_types" t
where t.code = 'HL' and t.payslip_slot = 'HL'
  and not exists (
    select 1 from "HRMS_leave_policies" p where p.company_id = t.company_id and p.leave_type_id = t.id
  );

insert into "HRMS_leave_policies" (
  company_id, leave_type_id, accrual_method, monthly_accrual_rate, annual_quota,
  prorate_on_join, reset_month, reset_day, allow_carryover, carryover_limit
)
select t.company_id, t.id, 'annual', null, 3, true, 1, 1, false, null
from "HRMS_leave_types" t
where t.code = 'HPL' and t.payslip_slot = 'HPL'
  and not exists (
    select 1 from "HRMS_leave_policies" p where p.company_id = t.company_id and p.leave_type_id = t.id
  );
