# CIRT Payroll — Security Testing (Section 6.18)

Manual and automated checks for payroll security hardening. Run after auth, RBAC, import, or export changes.

## Preconditions

- Admin account with company configured
- Employee account in the same company
- API base URL and Next.js app running
- `APP_DEBUG=false` in production-like verification

---

## SEC-010 — Employee role data isolation

| Step | Action | Expected |
|------|--------|----------|
| 1 | Sign in as Employee A | Dashboard / profile loads |
| 2 | `GET /api/v1/payslips/me` with Employee A token | Only Employee A payslips |
| 3 | `GET /api/v1/payslips/employee?user_id={Employee B}` | **403 Forbidden** |
| 4 | `GET /api/v1/users/{Employee B id}` | **403 Forbidden** (managerial route) |
| 5 | `GET /api/v1/payroll/master` | **403 Forbidden** |

---

## SEC-011 — Admin-only payroll actions

| Step | Action | Expected |
|------|--------|----------|
| 1 | Employee token → `POST /api/v1/payroll/run` | **403** |
| 2 | Employee token → `POST /api/v1/payroll/master/import` | **403** |
| 3 | Employee token → `GET /api/v1/payroll/export` | **403** |
| 4 | Admin token → same endpoints | **200** (or validation errors, not 403) |

---

## SEC-012 — Direct API role bypass

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open `/payroll/master` while signed out | Redirect to `/auth/login` |
| 2 | Employee: direct URL `/payroll?tab=run` | Redirect to `/profile?tab=pay` |
| 3 | Employee: `fetch('/api/payroll/master')` without cookie | **401** |
| 4 | Employee: call Laravel API directly with employee Bearer token on admin route | **403** |

---

## SEC-013 — Password field exposure check

| Step | Action | Expected |
|------|--------|----------|
| 1 | `GET /api/v1/auth/me` | No `password`, `password_hash`, or `token` fields |
| 2 | `GET /api/v1/users/{id}` as admin | No password fields in JSON |
| 3 | `POST /api/v1/payroll/master/import` success body | No plaintext `password` values |
| 4 | Browser DevTools → Application → localStorage | No `hrms_token`, password, PAN, Aadhaar, or bank account |

---

## SEC-014 — Import file type spoofing

| Step | Action | Expected |
|------|--------|----------|
| 1 | Rename `malware.exe` to `payroll.xlsx` | **422** with friendly invalid file message |
| 2 | Upload valid `.csv` payroll template | Preview succeeds |
| 3 | Upload `.pdf` renamed to `.xlsx` | **422** rejected |

---

## SEC-015 — Import malicious formula injection

| Step | Action | Expected |
|------|--------|----------|
| 1 | Import row with name `=cmd\|' /C calc'!A0` | Stored/displayed as neutralized text (leading `'` in sheet cell) |
| 2 | Import row with `@SUM(1+1)` in department | No formula execution in Excel export |

---

## SEC-016 — Large file upload limit

| Step | Action | Expected |
|------|--------|----------|
| 1 | Upload file > 10 MB | **422** “exceeds the maximum size” |
| 2 | Upload file just under 10 MB valid template | Accepted or row validation errors only |

---

## SEC-017 — Session timeout / logout

| Step | Action | Expected |
|------|--------|----------|
| 1 | Sign in, click Logout | Redirect home/login; cookies cleared |
| 2 | After logout, browser Back on payroll page | No protected data; redirect to login |
| 3 | Reuse old Bearer token after logout | **401** from `/auth/me` |
| 4 | Cookie flags (production): `HttpOnly`, `Secure`, `SameSite=Lax` | Present on session cookies |

---

## SEC-018 — Error message leakage

| Step | Action | Expected |
|------|--------|----------|
| 1 | Trigger invalid API id with `APP_DEBUG=false` | Generic JSON error, no stack trace |
| 2 | SQL/validation failure on import | User-friendly message only |
| 3 | Next.js 502 from API down | “API unavailable”, no file paths in production |

---

## SEC-019 — Download / export authorization

| Step | Action | Expected |
|------|--------|----------|
| 1 | Unsigned `GET /api/payroll/export?periodId=…` | **401** |
| 2 | Employee signed in → same URL | **403** |
| 3 | Admin signed in → export | Excel file downloads |
| 4 | Unsigned `GET /api/payroll/master/export` | **401** |

---

## SEC-020 — Payslip URL access control

| Step | Action | Expected |
|------|--------|----------|
| 1 | Employee `/profile?tab=pay` | Own slips only |
| 2 | Employee cannot open admin Salary Slips tab | Redirect / no data |
| 3 | Admin Salary Slips for selected employee | Allowed for same company only |

---

## SEC-021 — Browser storage sensitive data

| Step | Action | Expected |
|------|--------|----------|
| 1 | After login, inspect localStorage / sessionStorage | No tokens, passwords, PAN, Aadhaar, bank, full payroll export |
| 2 | Only non-sensitive UI prefs (e.g. sidebar collapsed) may persist | OK |

---

## SEC-022 — Cookie security attributes

| Step | Action | Expected |
|------|--------|----------|
| 1 | Inspect `hrms_session` and `hrms_api_token` cookies | `HttpOnly`, `Path=/`, `SameSite=Lax` |
| 2 | Production HTTPS | `Secure` flag set |

---

## SEC-023 — Brute force login check

| Step | Action | Expected |
|------|--------|----------|
| 1 | 6+ failed logins same email within 1 minute | **429** “Too many login attempts” |
| 2 | Wait 1 minute | Login allowed again |

---

## SEC-024 — Input length abuse

| Step | Action | Expected |
|------|--------|----------|
| 1 | Employee name 500+ chars in Payroll Master | Validation error, not saved |
| 2 | Department/designation with script tags | Rendered as text, not executed |

---

## SEC-025 — Hidden field / API parameter tampering

| Step | Action | Expected |
|------|--------|----------|
| 1 | Employee POST with `role: admin` on profile update | Role unchanged |
| 2 | Employee PUT another user id | **403** / **404** |
| 3 | Import row with `user_role: admin` for new employee | Only admin import can set roles; employee cannot import |
| 4 | `PUT /payroll/periods/{otherCompanyId}` | **404** / **403** |

---

## Automated unit coverage

PHPUnit: `backend/tests/Unit/PayrollSecurityTest.php`

- Formula injection sanitization
- Sensitive field masking
- Import file validation helpers
- Security-related source assertions (RBAC middleware, rate limiter)

Run:

```bash
cd backend && php vendor/bin/phpunit tests/Unit/PayrollSecurityTest.php
```

---

## Acceptance summary

- [ ] Unauthenticated users cannot access protected routes or APIs
- [ ] Employee cannot access admin screens or admin APIs
- [ ] Employee cannot view other employees’ payslips or payroll data
- [ ] Import rejects invalid / malicious files
- [ ] XSS / SQL injection attempts do not execute or corrupt data
- [ ] Passwords / tokens / sensitive data not exposed in API or browser storage
- [ ] Export / download requires admin authorization
- [ ] No stack traces or SQL errors visible to end users
