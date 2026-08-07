-- Rename legacy multi-tenant table name to reflect single CIRT institute profile.
-- Safe to run once. FK constraints on company_id continue to reference this table.

DO $$
BEGIN
  IF to_regclass('public.cirt_companies') IS NOT NULL
     AND to_regclass('public.cirt_institute') IS NULL THEN
    ALTER TABLE public.cirt_companies RENAME TO cirt_institute;
    RAISE NOTICE 'Renamed cirt_companies to cirt_institute';
  ELSIF to_regclass('public.cirt_institute') IS NOT NULL THEN
    RAISE NOTICE 'cirt_institute already exists — skipped';
  ELSE
    RAISE NOTICE 'Neither cirt_companies nor cirt_institute found — skipped';
  END IF;
END $$;

COMMENT ON TABLE cirt_institute IS
  'Single CIRT institute profile (address, PT, DA/HRA defaults, logo). Legacy name was cirt_companies.';
