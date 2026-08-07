-- Company-level payroll configuration (private payroll rules)
-- Allows Super Admin to customize PF/ESIC/PT + default breakup percentages per company.

create table if not exists "HRMS_company_payroll_config" (
  company_id uuid primary key references "HRMS_companies"(id) on delete cascade,
  private_config jsonb not null default '{}'::jsonb,
  updated_by uuid references "HRMS_users"(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Helpful index for auditing / queries
create index if not exists hrms_company_payroll_config_updated_at_idx
  on "HRMS_company_payroll_config"(updated_at desc);

