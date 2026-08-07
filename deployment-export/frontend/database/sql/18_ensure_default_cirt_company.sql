-- Ensure default CIRT institute row and backfill company_id (single-organization deployment).
-- Safe to run multiple times. Does not drop cirt_institute or company_id columns.

DO $$
DECLARE
  v_company_id uuid;
  v_table regclass;
BEGIN
  v_table := COALESCE(to_regclass('public.cirt_institute'), to_regclass('public.cirt_companies'));
  IF v_table IS NULL THEN
    RAISE NOTICE 'Skipped: cirt_institute / cirt_companies does not exist';
    RETURN;
  END IF;

  EXECUTE format('SELECT id FROM %s WHERE LOWER(code) = ''cirt'' ORDER BY created_at LIMIT 1', v_table)
    INTO v_company_id;

  IF v_company_id IS NULL THEN
    EXECUTE format('SELECT id FROM %s WHERE LOWER(name) = ''cirt'' ORDER BY created_at LIMIT 1', v_table)
      INTO v_company_id;
  END IF;

  IF v_company_id IS NULL THEN
    EXECUTE format(
      'INSERT INTO %s (id, name, code, created_at, updated_at) VALUES (gen_random_uuid(), ''CIRT'', ''CIRT'', NOW(), NOW()) RETURNING id',
      v_table
    ) INTO v_company_id;
    RAISE NOTICE 'Created default CIRT institute %', v_company_id;
  ELSE
    RAISE NOTICE 'Using existing CIRT institute %', v_company_id;
  END IF;
END $$;
