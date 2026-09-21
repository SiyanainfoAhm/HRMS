-- Editable Pay Level band boundaries for Transport Allowance.
-- High band: pay_level >= high_min_level
-- Mid band:  mid_min_level <= pay_level < high_min_level
-- Low band:  1 <= pay_level < mid_min_level (enhanced when basic >= threshold)

alter table if exists cirt_institute
  add column if not exists transport_allowance_high_min_level smallint not null default 9,
  add column if not exists transport_allowance_mid_min_level smallint not null default 3;

alter table if exists cirt_companies
  add column if not exists transport_allowance_high_min_level smallint not null default 9,
  add column if not exists transport_allowance_mid_min_level smallint not null default 3;

comment on column cirt_institute.transport_allowance_high_min_level is
  'Minimum Pay Level for the highest Transport Allowance band (default 9 = Level 9 & above).';
comment on column cirt_institute.transport_allowance_mid_min_level is
  'Minimum Pay Level for the middle Transport Allowance band (default 3 = Levels 3 to high_min-1).';
