-- One-time migration: convert existing HRMS_payroll_master rows from private-style
-- to government-style (aligned with supabase/migrations/20260409140000_government_payroll.sql
-- and src/lib/governmentPayroll.ts).
--
-- Does:
-- 1) Deletes HRMS_government_monthly_payroll rows for non–super-admin employees (stale snapshots;
--    regenerate via payroll run / hrm_generate_monthly_payroll).
-- 2) Backfills HRMS_users.government_pay_level = 1 where null (only users who have a payroll_master row).
-- 3) UPDATEs every HRMS_payroll_master row for employees (role <> super_admin): payroll_mode,
--    gross_basic, transport slab, DA/HRA/medical/TA earnings, zero PF/ESIC, deduction defaults,
--    take_home, ctc, component columns.
--
-- Gross basic source per row: first non-zero among user.gross_salary, master.basic, master.gross_salary
-- (minimum 1 to satisfy numeric safety). Pay level: user.government_pay_level (after backfill), minimum 1.

-- A. Remove stale government monthly detail (master ids preserved; ON DELETE RESTRICT would block master delete)
delete from "HRMS_government_monthly_payroll" g
where exists (
  select 1
  from "HRMS_payroll_master" pm
  join "HRMS_users" u on u.id = pm.employee_user_id
  where g.payroll_master_id = pm.id
    and coalesce(u.role, '') is distinct from 'super_admin'
);

-- B. Ensure pay level exists for anyone on payroll master (default level 1 — adjust in DB if needed)
update "HRMS_users" u
set government_pay_level = 1
where u.government_pay_level is null
  and coalesce(u.role, '') is distinct from 'super_admin'
  and exists (select 1 from "HRMS_payroll_master" pm where pm.employee_user_id = u.id);

-- C. Rewrite payroll_master to government mode
with src as (
  select
    pm.id as pm_id,
    pm.employee_user_id,
    greatest(
      1::numeric,
      coalesce(
        nullif(u.gross_salary, 0),
        nullif(pm.basic, 0),
        nullif(pm.gross_salary, 0),
        1::numeric
      )
    ) as gb,
    greatest(1, coalesce(u.government_pay_level, 1)) as lvl,
    coalesce(pm.income_tax_default, pm.tds, 0::numeric) as inc_tax,
    coalesce(pm.lic_default, 0::numeric) as lic_d,
    coalesce(pm.cpf_default, 0::numeric) as cpf_d,
    coalesce(pm.da_cpf_default, 0::numeric) as da_cpf_d,
    coalesce(pm.vpf_default, 0::numeric) as vpf_d,
    coalesce(pm.pf_loan_default, 0::numeric) as pf_loan_d,
    coalesce(pm.post_office_default, 0::numeric) as post_office_d,
    coalesce(pm.credit_society_default, 0::numeric) as credit_soc_d,
    coalesce(pm.std_licence_fee_default, 0::numeric) as std_lic_d,
    coalesce(pm.electricity_default, 0::numeric) as elec_d,
    coalesce(pm.water_default, 0::numeric) as water_d,
    coalesce(pm.mess_default, 0::numeric) as mess_d,
    coalesce(pm.horticulture_default, 0::numeric) as hort_d,
    coalesce(pm.welfare_default, 0::numeric) as welfare_d,
    coalesce(pm.veh_charge_default, 0::numeric) as veh_d,
    coalesce(pm.other_deduction_default, 0::numeric) as other_d,
    coalesce(pm.pt_default, pm.pt, c.professional_tax_monthly, 200::numeric) as pt_src
  from "HRMS_payroll_master" pm
  join "HRMS_users" u on u.id = pm.employee_user_id
  join "HRMS_companies" c on c.id = pm.company_id
  where coalesce(u.role, '') is distinct from 'super_admin'
),
calc as (
  select
    s.*,
    case
      when s.lvl <= 2 then 'LEVEL_1_2'::text
      when s.lvl between 3 and 8 then 'LEVEL_3_8'::text
      else 'LEVEL_9_ABOVE'::text
    end as tgroup,
    case
      when s.lvl <= 2 then 1350::numeric
      when s.lvl between 3 and 8 then 3600::numeric
      else 7200::numeric
    end as tbase
  from src s
),
nums as (
  select
    c.*,
    round(c.tbase + (c.tbase * 48.06 / 100.0), 0) as tr_a,
    round(c.gb * 53 / 100.0, 0) as da_a,
    round(c.gb * 30 / 100.0, 0) as hra_a,
    3000::numeric as med_a
  from calc c
),
nums2 as (
  select
    n.*,
    n.gb + n.da_a + n.hra_a + n.med_a + n.tr_a as total_e,
    n.inc_tax + n.pt_src + n.lic_d + n.cpf_d + n.da_cpf_d + n.vpf_d
      + n.pf_loan_d + n.post_office_d + n.credit_soc_d + n.std_lic_d + n.elec_d + n.water_d
      + n.mess_d + n.hort_d + n.welfare_d + n.veh_d + n.other_d as total_d
  from nums n
)
update "HRMS_payroll_master" pm
set
  payroll_mode = 'government',
  gross_basic = x.gb,
  gross_salary = x.gb,
  da_percent = 53,
  hra_percent = 30,
  medical_fixed = 3000,
  transport_da_percent = 48.06,
  transport_slab_group = x.tgroup,
  transport_base = x.tbase,
  income_tax_default = x.inc_tax,
  pt_default = x.pt_src,
  lic_default = x.lic_d,
  cpf_default = x.cpf_d,
  da_cpf_default = x.da_cpf_d,
  vpf_default = x.vpf_d,
  pf_loan_default = x.pf_loan_d,
  post_office_default = x.post_office_d,
  credit_society_default = x.credit_soc_d,
  std_licence_fee_default = x.std_lic_d,
  electricity_default = x.elec_d,
  water_default = x.water_d,
  mess_default = x.mess_d,
  horticulture_default = x.hort_d,
  welfare_default = x.welfare_d,
  veh_charge_default = x.veh_d,
  other_deduction_default = x.other_d,
  pf_eligible = false,
  esic_eligible = false,
  pf_employee = 0,
  pf_employer = 0,
  esic_employee = 0,
  esic_employer = 0,
  pt = x.pt_src,
  tds = x.inc_tax,
  basic = x.gb,
  hra = x.hra_a,
  medical = x.med_a,
  trans = x.tr_a,
  lta = 0,
  personal = 0,
  ctc = x.total_e,
  take_home = round(x.total_e - x.total_d, 0),
  reason_for_change = case
    when pm.reason_for_change is null or btrim(pm.reason_for_change) = '' then 'MigratedToGovernmentPayroll'
    else btrim(pm.reason_for_change) || ' | MigratedToGovernmentPayroll'
  end
from nums2 x
where pm.id = x.pm_id;

-- D. Sync employee profile from active (open-ended) master — gross basic + package + flags
with active as (
  select distinct on (pm.employee_user_id)
    pm.employee_user_id,
    pm.gross_basic,
    pm.ctc,
    u.government_pay_level
  from "HRMS_payroll_master" pm
  join "HRMS_users" u on u.id = pm.employee_user_id
  where pm.effective_end_date is null
    and coalesce(u.role, '') is distinct from 'super_admin'
    and coalesce(pm.payroll_mode, 'private') = 'government'
  order by pm.employee_user_id, pm.effective_start_date desc
)
update "HRMS_users" u
set
  gross_salary = coalesce(a.gross_basic, u.gross_salary),
  ctc = coalesce(a.ctc, u.ctc),
  government_pay_level = coalesce(a.government_pay_level, u.government_pay_level),
  pf_eligible = false,
  esic_eligible = false,
  updated_at = now()
from active a
where u.id = a.employee_user_id;
