-- Default HRA % for new payroll master employees (existing rows keep their stored hra_percent).
alter table if exists cirt_companies
  add column if not exists default_hra_percent numeric(6,2) not null default 30;

comment on column cirt_companies.default_hra_percent is
  'HRA % applied to newly added/imported employees. Existing payroll master rows retain their own hra_percent.';
