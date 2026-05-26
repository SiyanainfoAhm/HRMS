# HRMS: React + Supabase → React + Laravel + PostgreSQL

## Schema clarifications (read before coding)

| Topic | Status |
|-------|--------|
| Table names | Quoted identifiers with `HRMS_` prefix (e.g. `"HRMS_users"`). Laravel models must set `$table` explicitly. |
| `auth_user_id` on `HRMS_employees` | Legacy Supabase column; nullable in schema. **Do not use** in Laravel. Use `user_id` only. |
| `password_hash` | bcrypt (cost 10), same as current Next.js `users.ts`. Laravel `Hash::check()` is compatible. |
| `auth_provider` | `password` \| `google`. OAuth is out of Phase 1 scope; login must reject `google` accounts for password login (match current API). |
| `auth_session_version` | Integer on `HRMS_users`. Bump on password change to invalidate tokens. Map to Sanctum token metadata or revoke all tokens on change. |
| Enums in DB | `HRMS_role_key`, `HRMS_leave_status`, `HRMS_reimbursement_status`, etc. Use string casts in Eloquent; validate in Form Requests. |
| Government payroll | Extra tables/columns from migrations `20260409140000_*`, `HRMS_government_monthly_payroll`, `HRMS_company_payroll_config`. Phase 3+. |
| File storage | Invite/onboarding uses Supabase Storage today. Laravel needs `storage` + signed URLs (Phase 4 / separate decision). |
| RPCs | e.g. `government_rpc_cpf_auto` in SQL migrations — reimplement as Service methods, not Supabase RPC calls. |

---

## 1. Backend folder structure

```
backend/
├── app/
│   ├── Enums/                    # UserRole, EmploymentStatus, LeaveStatus, ...
│   ├── Http/
│   │   ├── Controllers/Api/V1/
│   │   ├── Middleware/
│   │   ├── Requests/             # Form requests per resource
│   │   └── Resources/            # API Resources (JSON shape)
│   ├── Models/                   # Eloquent, $table = 'HRMS_*'
│   ├── Policies/                 # Optional; prefer middleware + services for roles
│   └── Services/
│       ├── AuthService.php
│       ├── UserService.php
│       ├── EmployeeService.php
│       └── ...
├── bootstrap/
├── config/
│   ├── database.php              # pgsql, search_path
│   ├── sanctum.php
│   └── cors.php
├── database/
│   └── migrations/               # Empty or Laravel-only (personal_access_tokens)
├── routes/
│   └── api.php                   # Versioned: /api/v1/...
├── .env.example
└── README.md
```

**Laravel conventions used:** Controllers thin; validation in Form Requests; business logic in Services; consistent JSON via API Resources; `auth:sanctum` on protected routes.

---

## 2. Auth design

### Identity source
- **Model:** `App\Models\HrmsUser` → table `"HRMS_users"`, primary key UUID (`$keyType = 'string'`, `$incrementing = false`).
- **No** `Authenticatable` on `HRMS_employees`; employee context resolved via `user_id` when needed.

### Login (`POST /api/v1/auth/login`)
1. Validate `email`, `password`.
2. Load user by normalized email.
3. If `auth_provider !== 'password'` → 400 (Google-only account).
4. If `password_hash` null → 401.
5. `Hash::check($password, $password_hash)`.
6. Issue Sanctum personal access token (name: `hrms-web`, abilities: `['*']` or role-scoped later).
7. Return token + `UserResource` (no password fields).

### Logout (`POST /api/v1/auth/logout`)
- `auth:sanctum` → delete **current** access token.

### Current user (`GET /api/v1/auth/me`)
- Return full profile `UserResource` (same fields as Next `mapUser` in `me/route.ts`).

### Session invalidation on password change
- Increment `auth_session_version`.
- Revoke **all** Sanctum tokens for that user (`$user->tokens()->delete()`).

### Authorization layers
| Layer | Responsibility |
|-------|----------------|
| `auth:sanctum` | Valid token |
| `EnsureCompanyScope` | `company_id` on user matches resource (non–super_admin) |
| `EnsureRole` | `super_admin`, `admin`, `hr`, `manager`, `employee` |
| Policies / service checks | Row-level (e.g. manager sees team only) |

### Token transport (frontend)
- `Authorization: Bearer {token}` for SPA.
- CORS: allow React origin; `SANCTUM_STATEFUL_DOMAINS` if cookie SPA later.

### Phase 1 exclusions
- Google OAuth (`/api/auth/google`) — document for Phase 4.
- Signup (`/api/auth/signup`) — super_admin bootstrap; add when needed.

---

## 3. Route plan

```
/api/v1/
├── auth/
│   ├── POST   login
│   ├── POST   logout          [sanctum]
│   ├── GET    me              [sanctum]
│   └── POST   change-password [sanctum]   (Phase 1b)
├── users/                     (Phase 2)
├── employees/                 (Phase 2)
├── companies/                 (Phase 2)
├── settings/
│   ├── divisions|departments|designations|shifts|roles
├── attendance/                (Phase 3)
├── leave/
├── payroll/
├── payslips/
├── reimbursements/
├── notifications/
├── holidays/
└── invites/
```

---

## 4. Model list

| Laravel model | DB table | PK | Notes |
|---------------|----------|-----|-------|
| HrmsUser | HRMS_users | uuid | Authenticatable + Sanctum |
| HrmsCompany | HRMS_companies | uuid | |
| HrmsEmployee | HRMS_employees | uuid | `user_id` → HrmsUser |
| HrmsRole | HRMS_roles | uuid | company scoped |
| HrmsDivision | HRMS_divisions | uuid | |
| HrmsDepartment | HRMS_departments | uuid | |
| HrmsDesignation | HRMS_designations | uuid | |
| HrmsShift | HRMS_shifts | uuid | |
| HrmsAttendanceLog | HRMS_attendance_logs | uuid | |
| HrmsLeaveType | HRMS_leave_types | uuid | |
| HrmsLeavePolicy | HRMS_leave_policies | uuid | |
| HrmsLeaveRequest | HRMS_leave_requests | uuid | |
| HrmsHoliday | HRMS_holidays | uuid | |
| HrmsPayrollPeriod | HRMS_payroll_periods | uuid | |
| HrmsPayrollMaster | HRMS_payroll_master | uuid | |
| HrmsPayslip | HRMS_payslips | uuid | |
| HrmsGovernmentMonthlyPayroll | HRMS_government_monthly_payroll | uuid | Phase 3 |
| HrmsCompanyPayrollConfig | HRMS_company_payroll_config | uuid | Phase 3 |
| HrmsReimbursement | HRMS_reimbursements | uuid | |
| HrmsNotification | HRMS_notifications | uuid | |
| HrmsCompanyDocument | HRMS_company_documents | uuid | |
| HrmsEmployeeInvite | HRMS_employee_invites | uuid | |
| HrmsEmployeeDocumentSubmission | HRMS_employee_document_submissions | uuid | |
| HrmsEmployeeBankAccount | HRMS_employee_bank_accounts | uuid | |

---

## 5. API endpoint list (target)

### Phase 1 — Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/login` | Email/password → token + user |
| POST | `/api/v1/auth/logout` | Revoke current token |
| GET | `/api/v1/auth/me` | Current user profile |

### Phase 2 — Core HR
| Method | Path | Roles |
|--------|------|-------|
| GET/POST | `/api/v1/users` | admin+ |
| GET/PUT/PATCH | `/api/v1/users/{id}` | admin+ / self |
| GET/POST | `/api/v1/employees` | hr+ |
| GET/PUT | `/api/v1/employees/{id}` | hr+ |
| GET/PUT | `/api/v1/company` | admin+ |
| GET/POST/PUT/DELETE | `/api/v1/settings/divisions` | admin+ |
| Same pattern | `.../departments`, `.../designations`, `.../shifts`, `.../roles` | admin+ |
| GET/POST/PUT/DELETE | `/api/v1/company/documents` | admin+ |

### Phase 3 — Operations
| Method | Path |
|--------|------|
| GET/POST/PATCH | `/api/v1/attendance/me`, `/api/v1/attendance/company` |
| GET/POST | `/api/v1/leave/requests`, `/api/v1/leave/balance`, `/api/v1/leave/types`, `/api/v1/leave/policies` |
| CRUD | `/api/v1/holidays` |
| CRUD | `/api/v1/payroll/periods`, `/api/v1/payroll/master`, `/api/v1/payroll/run`, `/api/v1/payroll/export` |
| GET | `/api/v1/payslips/me`, `/api/v1/payslips/employee` |
| CRUD | `/api/v1/reimbursements`, upload, approve |
| CRUD | `/api/v1/notifications` |
| Invites | `/api/v1/invites`, `/api/v1/invites/{token}` |

### Phase 4 — Frontend
- Replace Next.js API routes + direct Supabase with `src/lib/api/` client → Laravel base URL.

---

## 6. Migration / reuse strategy (existing tables)

1. **No Laravel migrations to recreate HRMS tables** — database already provisioned via `supabase/migrations` and `hrms_schema.sql`.
2. **Run only Laravel stock migrations:** `personal_access_tokens` (Sanctum), optionally `cache`, `jobs` if needed.
3. **Eloquent configuration:**
   - `$table = 'HRMS_users'` (quoted case-sensitive names in PostgreSQL).
   - Disable Laravel timestamps auto-management if columns exist (`created_at`, `updated_at` already on tables).
   - UUID trait: `HasUuids` or custom boot generating `gen_random_uuid()` via DB default on insert.
4. **Do not rename tables** — keeps parity with existing data and reports.
5. **Remove dependency on `auth.users`:** ensure `auth_user_id` is never read/written; optional future migration to drop column.
6. **Password column:** never expose `password_hash` in API Resources; use `hidden` on model.

---

## 7. Frontend migration strategy

### Inventory (Supabase touchpoints)

**Direct Supabase client (`@/lib/supabaseClient`):**
- `src/lib/users.ts`, `src/lib/authValidate.ts`
- Most `src/app/api/**/route.ts` (42 Next API routes — proxy layer today)
- Pages: `src/app/(app)/employees/page.tsx`, `settings/role-settings.tsx`, `profile/role-profile.tsx`, `invite/[token]/page.tsx` (storage)
- `src/app/(app)/layout.tsx` (session validation)

**Not Supabase:** `src/lib/auth.ts` (HMAC cookie) — replace with Bearer token storage.

### Target architecture

```
src/lib/api/
├── client.ts          # fetch/axios, base URL, interceptors
├── auth.ts            # login, logout, me, token storage
├── users.ts
├── employees.ts
└── ...
```

### Steps
1. Add `NEXT_PUBLIC_API_URL` → Laravel `http://localhost:8000/api/v1`.
2. Implement `api/client.ts` with token in `localStorage` or memory + refresh on login.
3. Phase 4a: Point React pages that call `/api/*` (Next) to Laravel instead (or keep Next as BFF temporarily).
4. Phase 4b: Remove `supabase` package and Next API routes module-by-module.
5. Replace Supabase Storage with Laravel uploads (`POST /api/v1/files/...`).

### Auth UX change
- Cookie session (`hrms_session`) → Bearer token from Sanctum.
- `AuthContext` fed from `GET /auth/me` on app load.
- Middleware in Next.js app router can validate token via Laravel or defer to client-side guard.

---

## Implementation phases (execution order)

| Phase | Deliverable |
|-------|-------------|
| **1** | Laravel app, pgsql, Sanctum, HrmsUser, login/logout/me |
| **2** | Users, employees, company, settings CRUD |
| **3** | Attendance, leave, payroll, payslips, reimbursements, notifications |
| **4** | React `api/` layer, env, remove Supabase |
