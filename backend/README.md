# HRMS Laravel API

PostgreSQL-backed REST API for the HRMS React frontend. Reuses existing `HRMS_*` tables (no Supabase).

## Prerequisites

- PHP 8.2+ with extensions: `pdo_pgsql`, `mbstring`, `openssl`, `tokenizer`, `xml`, `ctype`, `json`, `bcmath`
- Composer 2.x
- PostgreSQL with HRMS schema already applied (`supabase/migrations` or `hrms_schema.sql`)

## Setup

```bash
cd backend
composer install
cp .env.example .env
php artisan key:generate
```

Configure `.env` with your PostgreSQL credentials (same database as the React app today).

Run only Laravel migrations (Sanctum tokens table):

```bash
php artisan migrate
```

Start the API:

```bash
php artisan serve
```

Base URL: `http://localhost:8000/api/v1`

## Phase 1 — Auth endpoints

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/v1/auth/login` | — |
| POST | `/api/v1/auth/logout` | Bearer token |
| GET | `/api/v1/auth/me` | Bearer token |

### Login

```json
POST /api/v1/auth/login
{ "email": "admin@example.com", "password": "secret" }
```

Response:

```json
{
  "user": { "id": "...", "email": "...", "name": "...", "role": "admin", "sv": 0 },
  "token": "1|...",
  "tokenType": "Bearer"
}
```

Use header: `Authorization: Bearer {token}`

Password verification uses existing `HRMS_users.password_hash` (bcrypt, compatible with the Next.js app).

### Session invalidation

`auth_session_version` is stored in token abilities (`sv:N`). When the password changes (Phase 1b), all tokens are revoked and the version increments.

## Docker (if PHP is not installed locally)

Start Docker Desktop, then:

```bash
docker run --rm -v "%cd%":/app -w /app/backend composer:2 install
docker run --rm -v "%cd%":/app -w /app/backend php:8.3-cli php artisan key:generate
docker run --rm -p 8000:8000 -v "%cd%":/app -w /app/backend php:8.3-cli php artisan serve --host=0.0.0.0
```

## Architecture

See [../docs/laravel-migration/MIGRATION_PLAN.md](../docs/laravel-migration/MIGRATION_PLAN.md) for full route plan, models, and frontend migration strategy.
