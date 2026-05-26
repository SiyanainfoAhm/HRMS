-- Backfill default private payroll config for all existing companies
-- and auto-create defaults for new companies.

-- 1) Backfill: create a config row for every company missing one
insert into "HRMS_company_payroll_config" (company_id, private_config, updated_at)
select
  c.id as company_id,
  jsonb_build_object(
    'pfRate', 0.12,
    'pfWageCap', 15000,
    'pfCap', 1800,
    'esicEmployeeRate', 0.0075,
    'esicEmployerRate', 0.0325,
    'esicGrossCeilingInclusive', 21000,
    'ptMonthlyDefault', coalesce(c.professional_tax_monthly, 200),
    'breakupPct', jsonb_build_object(
      'basicPct', 0.50,
      'hraPct', 0.20,
      'medicalPct', 0.05,
      'transPct', 0.05,
      'ltaPct', 0.10,
      'personalPct', 0.10
    )
  ) as private_config,
  now() as updated_at
from "HRMS_companies" c
left join "HRMS_company_payroll_config" cfg
  on cfg.company_id = c.id
where cfg.company_id is null;

-- 2) Default-on-insert: create a config row whenever a new company is inserted
create or replace function hrms_company_payroll_config_default_on_company_insert()
returns trigger
language plpgsql
as $$
begin
  insert into "HRMS_company_payroll_config" (company_id, private_config, updated_at)
  values (
    new.id,
    jsonb_build_object(
      'pfRate', 0.12,
      'pfWageCap', 15000,
      'pfCap', 1800,
      'esicEmployeeRate', 0.0075,
      'esicEmployerRate', 0.0325,
      'esicGrossCeilingInclusive', 21000,
      'ptMonthlyDefault', coalesce(new.professional_tax_monthly, 200),
      'breakupPct', jsonb_build_object(
        'basicPct', 0.50,
        'hraPct', 0.20,
        'medicalPct', 0.05,
        'transPct', 0.05,
        'ltaPct', 0.10,
        'personalPct', 0.10
      )
    ),
    now()
  )
  on conflict (company_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_hrms_company_payroll_config_default on "HRMS_companies";
create trigger trg_hrms_company_payroll_config_default
after insert on "HRMS_companies"
for each row
execute function hrms_company_payroll_config_default_on_company_insert();

