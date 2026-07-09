# CIRT Payroll — Pre-Deployment Performance Checklist

Use this checklist before deploying to Windows Server (~120 employees, 3-year maintenance).

## Acceptance tests (PERF-001 – PERF-020)

| ID | Test | Status | Notes |
|----|------|--------|-------|
| PERF-001 | Payroll Master loads with pagination 25 rows | Implemented | `PayrollMasterController` + `PayrollMasterScreen` |
| PERF-002 | Payroll Master search debounced (300ms) and server-side | Implemented | `useDebouncedValue` + `paginatedListForCompany` |
| PERF-003 | Run Payroll employee list loads paginated | Implemented | `PayrollController::runPreview` + payroll page |
| PERF-004 | Run Payroll does not calculate all employees on page load | Implemented | Paginated preview; `all=1` only on Generate |
| PERF-005 | Generate all processes in chunks | Implemented | 25-row DB transactions in `executePayrollRun` |
| PERF-006 | Import duplicate checks use batch queries | Implemented | `buildImportUniquenessIndex` |
| PERF-007 | Import blocks invalid file before DB write | Existing | Template/file validation before save |
| PERF-008 | Export shows loading and prevents double-click | Partial | Payroll Master export has loading state |
| PERF-009 | Reports filter by month/year server-side | Verify | Confirm reports API uses query filters |
| PERF-010 | No N+1 in Run Payroll employee load | Improved | NDA rates, custom fields, config preloaded |
| PERF-011 | NDA rates loaded once per request | Implemented | `resolveFromPreloadedRates` |
| PERF-012 | Dynamic payroll field definitions loaded once | Implemented | Batch `getCustomFieldValuesForMasters` |
| PERF-013 | EOL/HPL reference snapshots in one query | Verify | Existing reference salary batch paths |
| PERF-014 | Employee Dashboard loads logged-in employee only | Verify | `PayslipController::me` scoped |
| PERF-015 | No API returns unpaginated large data by default | Partial | `?all=1` for export/generate only |
| PERF-016 | Duplicate monthly payroll rows cannot be created | Implemented | Unique index `ux_cirt_gov_monthly_period_user` |
| PERF-017 | Deadlock-safe payroll confirm transactions | Improved | Short per-chunk transactions, sorted user IDs |
| PERF-018 | Production build succeeds | Run before deploy | `npm run build` |
| PERF-019 | APP_DEBUG=false, no stack traces | Configure | `.env` production |
| PERF-020 | Database indexes on filter/search fields | Implemented | `2026_07_25_100000_performance_indexes.php` |

## Manual deployment readiness

- [ ] `php artisan migrate` — run `2026_07_25_100000_performance_indexes.php` on PostgreSQL
- [ ] `php artisan test`
- [ ] `npm run build`
- [ ] `php artisan config:cache` / `route:cache` / `view:cache`
- [ ] `APP_DEBUG=false`, `APP_ENV=production`
- [ ] Sanctum/CORS domains configured for production host
- [ ] API base URL set in Next.js production env
- [ ] Laravel logs writable; no sensitive data in logs
- [ ] File upload max size ≤ 10 MB (payroll import)

## Remaining risks

1. **Settings tables** (departments, quarters, NDA rates, etc.) — pagination not yet applied to all settings UIs; low risk at ~120 employees.
2. **Run Payroll preview** — still builds full employee list server-side then slices; acceptable at 120 rows but should move filters into SQL for larger scale.
3. **Settings caching** — Laravel cache for stable settings not fully wired; optional for current scale.
4. **Reports list** — confirm server-side month/year filters per deployment test.

## Key files

- `backend/app/Support/ApiPagination.php`
- `backend/database/migrations/2026_07_25_100000_performance_indexes.php`
- `backend/app/Services/PayrollMasterService.php`
- `backend/app/Http/Controllers/Api/V1/PayrollController.php`
- `src/lib/pagination.ts`
- `src/components/ui/PaginationControls.tsx`
- `src/components/payroll/PayrollMasterScreen.tsx`
- `src/app/(app)/payroll/page.tsx`
