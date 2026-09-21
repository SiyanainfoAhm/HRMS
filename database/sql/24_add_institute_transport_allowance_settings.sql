-- Configurable Transport Allowance slabs on the institute profile (mirrors default_da / default_hra).
alter table if exists cirt_institute
  add column if not exists transport_allowance_level_9_plus numeric(12,2) not null default 7200,
  add column if not exists transport_allowance_level_3_8 numeric(12,2) not null default 3600,
  add column if not exists transport_allowance_level_1_2 numeric(12,2) not null default 1350,
  add column if not exists transport_allowance_level_1_2_enhanced numeric(12,2) not null default 3600,
  add column if not exists transport_allowance_basic_threshold numeric(12,2) not null default 24200;

-- Legacy table name (pre-rename) for environments that have not run rename migration yet.
alter table if exists cirt_companies
  add column if not exists transport_allowance_level_9_plus numeric(12,2) not null default 7200,
  add column if not exists transport_allowance_level_3_8 numeric(12,2) not null default 3600,
  add column if not exists transport_allowance_level_1_2 numeric(12,2) not null default 1350,
  add column if not exists transport_allowance_level_1_2_enhanced numeric(12,2) not null default 3600,
  add column if not exists transport_allowance_basic_threshold numeric(12,2) not null default 24200;

comment on column cirt_institute.transport_allowance_level_9_plus is
  'Base Transport Allowance for Pay Level 9 and above.';
comment on column cirt_institute.transport_allowance_level_3_8 is
  'Base Transport Allowance for Pay Level 3 to 8.';
comment on column cirt_institute.transport_allowance_level_1_2 is
  'Base Transport Allowance for Pay Level 1 and 2 when Basic Pay is below the threshold.';
comment on column cirt_institute.transport_allowance_level_1_2_enhanced is
  'Base Transport Allowance for Pay Level 1 and 2 when Basic Pay is at/above the threshold.';
comment on column cirt_institute.transport_allowance_basic_threshold is
  'Basic Pay threshold that upgrades Level 1–2 Transport Allowance to the enhanced amount.';
