# Backend tests

Run with PHP 8.4: `C:\php84\php.exe vendor/bin/phpunit` (from `backend/`).

**The tests never touch the real payroll database (`hrms`).** `phpunit.xml` forces `DB_DATABASE=cirt_payroll_test`
(schema cloned from `hrms`, no data), an in-memory cache/session, and `DatabaseTestCase` refuses to run against any
database not named `*_test`. Every database test runs in a transaction that is rolled back, on top of
`Tests\Support\TestWorld`: a synthetic company, admin, employees with Payroll Masters, quarters, field definitions,
night-allowance rates, a tariff and three generated months, created fresh for each test.

Setting up the test database (once):

1. `CREATE DATABASE cirt_payroll_test;`
2. Load the structure only: `pg_dump --schema-only --no-owner hrms | psql cirt_payroll_test`, plus the `migrations` table rows.
3. `php artisan migrate --env=testing` (applies migrations newer than the clone). `.env.testing` points at the test database.

Skipped by design (they need the client's real data): `ClientDataCopyTest`, `PrakashAuditTest`, `SubhashElectricityUnitsTest`,
and the two quarter tests that need a schema without the one-open-assignment index.
