-- Default DA % for new payroll master employees (existing rows keep their stored da_percent).
alter table if exists cirt_companies
  add column if not exists default_da_percent numeric(6,2) not null default 53;

comment on column cirt_companies.default_da_percent is
  'DA % applied to newly added/imported employees. Existing payroll master rows retain their own da_percent.';
