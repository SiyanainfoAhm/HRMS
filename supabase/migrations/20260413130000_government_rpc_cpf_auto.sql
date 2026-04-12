-- When cpf_default is 0, employee CPF = round(12% of total earnings), matching src/lib/governmentPayroll.ts
create or replace function public.hrm_generate_monthly_payroll(
  p_employee_user_id uuid,
  p_payroll_period_id uuid,
  p_unpaid_days integer default 0,
  p_payslip_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_level int;
  m record;
  v_days int;
  v_month date;
  v_salary_date date;
  v_group text;
  v_tbase numeric;
  v_tid uuid;
  v_unpaid int;
  v_tda_pct numeric;
  v_gb numeric;
  v_da_pct numeric;
  v_hra_pct numeric;
  v_med_fixed numeric;
  v_tr_actual numeric;
  v_basic_a numeric; v_basic_p numeric;
  v_da_a numeric; v_da_p numeric;
  v_hra_a numeric; v_hra_p numeric;
  v_med_a numeric; v_med_p numeric;
  v_tr_p numeric;
  v_te numeric; v_td numeric; v_net numeric;
  v_cpf_amt numeric;
begin
  v_unpaid := greatest(coalesce(p_unpaid_days, 0), 0);

  select u.company_id, u.government_pay_level
  into v_company_id, v_level
  from "HRMS_users" u
  where u.id = p_employee_user_id;

  if v_company_id is null then
    raise exception 'Employee not found';
  end if;
  if v_level is null then
    raise exception 'government_pay_level is required for government payroll';
  end if;

  select *
  into m
  from "HRMS_payroll_master" pm
  where pm.employee_user_id = p_employee_user_id
    and pm.company_id = v_company_id
    and pm.effective_end_date is null
    and pm.payroll_mode = 'government'
  limit 1;

  if m.id is null then
    raise exception 'Active government payroll_master row not found';
  end if;

  select p.period_start::date, p.period_end::date
  into v_month, v_salary_date
  from "HRMS_payroll_periods" p
  where p.id = p_payroll_period_id and p.company_id = v_company_id;

  if v_month is null then
    raise exception 'Payroll period not found';
  end if;

  v_days := extract(day from (date_trunc('month', v_month::timestamp) + interval '1 month - 1 day'))::int;
  if v_days < 1 then v_days := 30; end if;
  v_unpaid := least(v_unpaid, v_days);

  if v_level in (1, 2) then
    v_group := 'LEVEL_1_2'; v_tbase := 1350;
  elsif v_level >= 3 and v_level <= 8 then
    v_group := 'LEVEL_3_8'; v_tbase := 3600;
  else
    v_group := 'LEVEL_9_ABOVE'; v_tbase := 7200;
  end if;

  v_gb := coalesce(m.gross_basic, 0);
  v_da_pct := coalesce(m.da_percent, 53);
  v_hra_pct := coalesce(m.hra_percent, 30);
  v_med_fixed := coalesce(m.medical_fixed, 3000);
  v_tda_pct := coalesce(m.transport_da_percent, 48.06);

  v_tr_actual := round(v_tbase + (v_tbase * v_tda_pct / 100.0));
  v_basic_a := v_gb;
  v_da_a := round(v_gb * v_da_pct / 100.0);
  v_hra_a := round(v_gb * v_hra_pct / 100.0);
  v_med_a := v_med_fixed;

  v_basic_p := round(v_basic_a - ((v_basic_a / v_days::numeric) * v_unpaid));
  v_da_p := round(v_da_a - ((v_da_a / v_days::numeric) * v_unpaid));
  v_hra_p := round(v_hra_a - ((v_hra_a / v_days::numeric) * v_unpaid));
  v_med_p := round(v_med_a - ((v_med_a / v_days::numeric) * v_unpaid));
  v_tr_p := v_tr_actual;

  v_te := v_basic_p + v_da_p + v_hra_p + v_med_p + v_tr_p;

  v_cpf_amt := case
    when coalesce(m.cpf_default, 0) = 0 then round(v_te * 0.12)
    else coalesce(m.cpf_default, 0)
  end;

  v_td :=
    coalesce(m.income_tax_default, 0) +
    coalesce(m.pt_default, 200) +
    coalesce(m.lic_default, 0) +
    v_cpf_amt +
    coalesce(m.da_cpf_default, 0) +
    coalesce(m.vpf_default, 0) +
    coalesce(m.pf_loan_default, 0) +
    coalesce(m.post_office_default, 0) +
    coalesce(m.credit_society_default, 0) +
    coalesce(m.std_licence_fee_default, 0) +
    coalesce(m.electricity_default, 0) +
    coalesce(m.water_default, 0) +
    coalesce(m.mess_default, 0) +
    coalesce(m.horticulture_default, 0) +
    coalesce(m.welfare_default, 0) +
    coalesce(m.veh_charge_default, 0) +
    coalesce(m.other_deduction_default, 0);

  v_net := v_te - v_td;

  insert into "HRMS_government_monthly_payroll" (
    company_id, payroll_period_id, payroll_master_id, employee_user_id, payslip_id,
    month_year, salary_date, days_in_month, paid_days, unpaid_days,
    pay_level, transport_slab_group, transport_base, transport_da_percent,
    basic_actual, basic_paid, sp_pay_actual, sp_pay_paid,
    da_actual, da_paid, transport_actual, transport_paid,
    hra_actual, hra_paid, medical_actual, medical_paid,
    extra_work_allowance_actual, extra_work_allowance_paid,
    night_allowance_actual, night_allowance_paid,
    uniform_allowance_actual, uniform_allowance_paid,
    education_allowance_actual, education_allowance_paid,
    da_arrears_actual, da_arrears_paid,
    transport_arrears_actual, transport_arrears_paid,
    encashment_actual, encashment_paid,
    encashment_da_actual, encashment_da_paid,
    income_tax_amount, pt_amount, lic_amount, cpf_amount, da_cpf_amount,
    vpf_amount, pf_loan_amount, post_office_amount, credit_society_amount,
    std_licence_fee_amount, electricity_amount, water_amount, mess_amount,
    horticulture_amount, welfare_amount, veh_charge_amount, other_deduction_amount,
    total_earnings, total_deductions, net_salary
  ) values (
    v_company_id, p_payroll_period_id, m.id, p_employee_user_id, p_payslip_id,
    date_trunc('month', v_month)::date, v_salary_date, v_days, v_days - v_unpaid, v_unpaid,
    v_level, v_group, v_tbase, v_tda_pct,
    v_basic_a, v_basic_p, 0, 0,
    v_da_a, v_da_p, v_tr_actual, v_tr_p,
    v_hra_a, v_hra_p, v_med_a, v_med_p,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    coalesce(m.income_tax_default, 0),
    coalesce(m.pt_default, 200),
    coalesce(m.lic_default, 0),
    v_cpf_amt,
    coalesce(m.da_cpf_default, 0),
    coalesce(m.vpf_default, 0),
    coalesce(m.pf_loan_default, 0),
    coalesce(m.post_office_default, 0),
    coalesce(m.credit_society_default, 0),
    coalesce(m.std_licence_fee_default, 0),
    coalesce(m.electricity_default, 0),
    coalesce(m.water_default, 0),
    coalesce(m.mess_default, 0),
    coalesce(m.horticulture_default, 0),
    coalesce(m.welfare_default, 0),
    coalesce(m.veh_charge_default, 0),
    coalesce(m.other_deduction_default, 0),
    v_te, v_td, v_net
  )
  on conflict (payroll_period_id, employee_user_id) do update set
    payslip_id = excluded.payslip_id,
    salary_date = excluded.salary_date,
    days_in_month = excluded.days_in_month,
    paid_days = excluded.paid_days,
    unpaid_days = excluded.unpaid_days,
    total_earnings = excluded.total_earnings,
    total_deductions = excluded.total_deductions,
    net_salary = excluded.net_salary
  returning id into v_tid;

  return v_tid;
end;
$$;
