-- Bump when password changes so signed cookies without the new version are rejected (logout other devices).
alter table "HRMS_users"
  add column if not exists auth_session_version integer not null default 0;
