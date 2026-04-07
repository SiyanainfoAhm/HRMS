-- Support OAuth providers (Google) alongside password auth.
-- - password_hash becomes nullable for OAuth-only users
-- - auth_provider indicates how the account was created / should be authenticated

alter table "HRMS_users"
  add column if not exists auth_provider text not null default 'password'
  check (auth_provider in ('password', 'google'));

alter table "HRMS_users"
  alter column password_hash drop not null;

-- Backfill: if there are any rows without password_hash, mark them as google.
update "HRMS_users"
  set auth_provider = 'google'
  where password_hash is null and auth_provider = 'password';

