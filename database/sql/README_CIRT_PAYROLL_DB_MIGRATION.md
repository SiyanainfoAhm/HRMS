# CIRT Payroll — database migration (manual SQL)

This folder contains **review-first** PostgreSQL scripts to migrate from `HRMS_*` tables to `cirt_*` for the **CIRT Payroll** scope.

**Do not run these automatically from the app.** Run them manually in Supabase SQL Editor, DBeaver, or pgAdmin after review.

## Backup (required)

Before any change:

```bash
# Example — adjust connection string for your environment
pg_dump -Fc -f cirt_payroll_backup_$(date +%Y%m%d).dump "$DATABASE_URL"
```

In Supabase Dashboard: **Project → Database → Backups** (enable PITR if available).

## Execution order

| Step | File | Purpose |
|------|------|---------|
| 1 | `01_verify_current_hrms_schema.sql` | Read-only inventory: tables, types, row counts, FKs, indexes |
| 2 | `02_rename_hrms_tables_to_cirt_tables.sql` | Rename active payroll tables + `hrms_role_key` → `cirt_role_key` |
| 3 | — | Deploy / verify application code uses `cirt_*` table names |
| 4 | — | Test login, payroll master, run payroll, payslips |
| 5 | `03_drop_unused_hrms_tables.sql` | **Destructive** — drop unused HRMS modules (only after step 4 passes) |
| 6 | `04_verify_cirt_payroll_schema.sql` | Confirm required `cirt_*` tables exist and HRMS modules are gone |

### Rollback (rename only)

If you need to undo the **rename** (not dropped data):

1. Revert application code to `HRMS_*` table names.
2. Run `99_rollback_cirt_table_rename.sql`.

**Dropped tables** (step 5) are **not** recreated by rollback. Restore from backup if needed.

## Table naming (important)

PostgreSQL may **display** old names as `HRMS_companies` (mixed case, quoted at creation) or as lowercase in some tools. After migration you should see:

| Old (HRMS) | New (CIRT) | What it is |
|------------|------------|------------|
| `"HRMS_companies"` | `cirt_companies` | **Single CIRT institute profile** (name, address, PT, logo) — not “many companies” |
| `"HRMS_divisions"` | `cirt_divisions` | Org divisions (e.g. regional units) |
| `"HRMS_departments"` | `cirt_departments` | Org departments **under** divisions (e.g. Accounts, HR) |

**Departments and divisions are different tables.** Do not merge them: employees and payslips use both for dropdowns.

### Why `cirt_companies` exists for CIRT-only payroll

The app is **single-tenant**: you will have **one row** in `cirt_companies` for Central Institute of Road Transport. The table name is legacy from the old multi-company HRMS design. It is the anchor for:

- `company_id` on users, employees, payroll, payslips
- Institute address/logo on salary slips
- Professional tax defaults

Renaming the table to `cirt_institute` would require changing every `company_id` foreign key — not done in this migration. The UI now says **“CIRT Institute”** instead of “Company”.


| From | To |
|------|-----|
| `"HRMS_companies"` | `cirt_companies` |
| `"HRMS_users"` | `cirt_users` |
| `"HRMS_roles"` | `cirt_roles` |
| `"HRMS_divisions"` | `cirt_divisions` |
| `"HRMS_departments"` | `cirt_departments` |
| `"HRMS_designations"` | `cirt_designations` |
| `"HRMS_employees"` | `cirt_employees` |
| `"HRMS_employee_bank_accounts"` | `cirt_employee_bank_accounts` |
| `"HRMS_payroll_periods"` | `cirt_payroll_periods` |
| `"HRMS_payroll_master"` | `cirt_payroll_master` |
| `"HRMS_government_monthly_payroll"` | `cirt_monthly_payroll` |
| `"HRMS_payslips"` | `cirt_payslips` |
| `"HRMS_payroll_rule_settings"` (if exists) | `cirt_payroll_rule_settings` |
| `"HRMS_payroll_import_batches"` (if exists) | `cirt_payroll_import_batches` |

Enum: `hrms_role_key` → `cirt_role_key` (if present).

## Tables dropped (step 5 — destructive)

- `"HRMS_employee_document_submissions"`
- `"HRMS_employee_invites"`
- `"HRMS_company_documents"`
- `"HRMS_leave_requests"`
- `"HRMS_leave_policies"`
- `"HRMS_leave_types"`
- `"HRMS_attendance_logs"`
- `"HRMS_holidays"`
- `"HRMS_reimbursements"`
- `"HRMS_notifications"`
- `"HRMS_shifts"`

Unused enums dropped after tables: `hrms_leave_accrual_method`, `hrms_leave_status`, `hrms_company_document_kind`, `hrms_reimbursement_status`.

## Not renamed / not dropped

- `migrations`, `personal_access_tokens`, `failed_jobs`, `jobs`, `password_reset_tokens`, `cache`, `cache_locks`
- `auth.users`, Supabase `storage` schema, system catalogs

## Optional legacy tables (review manually)

These may exist in your Supabase project but are **not** in the automated rename/drop lists:

- `"HRMS_company_payroll_config"` — payroll config JSON; consider renaming to `cirt_company_payroll_config` in a follow-up script if still used.

## Supabase SQL Editor

1. Open **SQL Editor → New query**.
2. Paste contents of `01_verify_current_hrms_schema.sql`.
3. Run and save results.
4. Repeat for `02_…`, then test the app before `03_…`.
5. Check **Logs / NOTICES** panel for `RAISE NOTICE` messages from rename/drop scripts.

## DBeaver / pgAdmin

1. Connect to the target database.
2. Open each `.sql` file and execute as a single script (F5 in DBeaver).
3. Review NOTICE output in the messages panel.
4. If step 3 fails on `HRMS_shifts`, confirm step 2 completed and that the script dropped `shift_id` FKs from `cirt_users` / `cirt_employees` first.

## Laravel note

These scripts are for **Supabase / direct PostgreSQL** migration. The Laravel app models already use `cirt_*` names. **Do not run `php artisan migrate` for this rename** unless you intentionally want Laravel migration history to diverge from manual SQL.

## Application branding

- App name: **CIRT Payroll**
- Payslip institute (unchanged): **CENTRAL INSTITUTE OF ROAD TRANSPORT**, BHOSARI, PUNE 411026
