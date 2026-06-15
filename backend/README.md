# CIRT Payroll API (Laravel)

PostgreSQL-backed REST API for the CIRT Payroll React frontend. Uses `cirt_*` tables.

## Setup

```bash
cd backend
composer install
cp .env.example .env   # configure DB_* and APP_KEY
php artisan key:generate
php artisan migrate
php artisan serve
```

Default API base: `http://localhost:8000/api/v1`

Password verification uses `cirt_users.password_hash` (bcrypt).

## Migrations

Manual Supabase / PostgreSQL scripts for HRMS → CIRT table rename live in:

`../database/sql/README_CIRT_PAYROLL_DB_MIGRATION.md`

Laravel migrations in `database/migrations/` are separate; **use the SQL files for Supabase manual migration** unless you intentionally align both paths.
