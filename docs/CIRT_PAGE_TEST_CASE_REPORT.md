# CIRT — Page Test Case Report

Manual QA suite for all active CIRT HRMS pages (Sep 2026).

**Companion:** interactive canvas in Cursor chat · existing `docs/PAYROLL_ACCEPTANCE_TESTS.md` for payroll-import detail.

## Smoke path (release gate)

| Role | Path |
|------|------|
| Admin | Login → Payroll Master CRUD/import → Run Payroll generate → Salary Slips PDF → Settings (quarters/electricity) |
| Employee | Login → Dashboard → My Salary Slips PDF → Payroll History → Profile password |

## Priority

| Pri | Meaning |
|-----|---------|
| P0 | Release blocker / core money path |
| P1 | Important / common path |
| P2 | Secondary / legacy / polish |

## Coverage summary

| Module | Focus |
|--------|--------|
| Auth / Navigation | Login, logout, role redirects |
| Payroll Master | CRUD, import, exports, quarter, deactivate |
| Run Payroll | Draft, generate, audit, exports, electricity |
| Salary Slips | Admin preview/PDF |
| Settings | Institute, roles, org, increment, fields, quarters, night, electricity |
| Employees | Preboarding/current/past (not in sidebar) |
| Employee Portal / Profile | Dashboard, history, slips, password |
| Legacy | Attendance/Holidays/Approvals/Invite redirects |

---

## Auth & Navigation

| ID | Pri | Role | Route | Title | Steps | Expected |
|----|-----|------|-------|-------|-------|----------|
| AUTH-001 | P0 | Public | /auth/login | Admin login | Sign in as admin | Lands on /payroll/master |
| AUTH-002 | P0 | Public | /auth/login | Employee login | Sign in as employee | Lands on /employee/dashboard |
| AUTH-003 | P0 | Public | /auth/login | Bad password | Wrong password | Error; no session |
| AUTH-004 | P1 | Public | /auth/login | next= for admin | login?next=/payroll?tab=run | Run Payroll opens |
| AUTH-005 | P1 | Public | /auth/login | next= blocked for employee | login?next=/settings as employee | Does not open Settings |
| AUTH-006 | P2 | Public | /auth/signup | Signup disabled | Open signup | Unavailable; link to login |
| AUTH-007 | P1 | Public | / | Root redirect | Visit / logged out/in | Login or role home |
| NAV-001 | P0 | Both | /* | Logout | Confirm logout | Session cleared → login |
| NAV-002 | P1 | Admin | /employee/dashboard | Admin off employee home | Visit employee dashboard | Redirect to admin home |
| NAV-003 | P0 | Employee | /payroll,/settings | Employee blocked | Visit admin routes | Redirect to employee dashboard |

## Payroll Master (/payroll/master) — Admin

| ID | Pri | Title | Steps | Expected |
|----|-----|-------|-------|----------|
| PM-001 | P0 | List + search | Search code/name/email | Filtered list; pagination |
| PM-002 | P0 | Add employee | Fill required → Save | Appears in list |
| PM-003 | P0 | Edit employee | Change amounts → Save | Persists after refresh |
| PM-004 | P0 | Code conflict | Reuse another code | Conflict dialog; no silent overwrite |
| PM-005 | P0 | Import invalid | Upload bad Excel | Confirm disabled; no partial import |
| PM-006 | P0 | Import success | Valid template → Confirm | Rows imported |
| PM-007 | P1 | Export Master | Click Export Master | xlsx; codes keep leading zeros |
| PM-008 | P0 | Export Employee Payroll | 1–3 months → Download | Long format; Month column; quarter name/type when assigned |
| PM-009 | P1 | Quarter assign | Assign quarter → Save | Assigned Yes; rent path |
| PM-010 | P1 | Deactivate | Deactivate → confirm | Inactive as designed |
| PM-011 | P2 | Sync Employees | Click Sync | Completes; toast |

## Run Payroll (/payroll?tab=run) — Admin

| ID | Pri | Title | Steps | Expected |
|----|-----|-------|-------|----------|
| RP-001 | P0 | Calculate preview | Select month → load | Rows with net |
| RP-002 | P0 | Save draft | Edit → Save Draft → refresh | Draft restored |
| RP-003 | P1 | Reset draft | Reset to Calculation | Calculated values restored |
| RP-004 | P0 | Generate | Generate | Finalized; slips created |
| RP-005 | P0 | Audit update | Amend + reason | Updates + audit; locked blocked |
| RP-006 | P1 | Electricity units | Enter units | Deduction from tariff |
| RP-007 | P1 | Preview/Extract/Bank Letter | Click each | Files download |
| RP-008 | P0 | Employee Payroll export | 3 months | Long format; no wide headers |
| RP-009 | P1 | Dirty month switch | Change month unsaved | Confirm dialog |
| RP-010 | P1 | Filters | Division/dept/search | Filtered sheet |

## Salary Slips (/payroll?tab=slips) — Admin

| ID | Pri | Title | Steps | Expected |
|----|-----|-------|-------|----------|
| SS-001 | P0 | View slip | Select employee+month | Matches generated payroll |
| SS-002 | P0 | Download PDF | Download | PDF OK |

## Settings (/settings) — Admin

| ID | Pri | Area | Title | Expected |
|----|-----|------|-------|----------|
| SET-001 | P0 | Institute | View profile | Fixed branding RO; DA/HRA visible |
| SET-002 | P0 | Institute | Change DA% | Masters revise after confirm |
| SET-003 | P1 | Roles | CRUD | Custom OK; system protected |
| SET-004 | P1 | Org | Div/Dept/Desig | Available in Master |
| SET-005 | P1 | Increment | Apply cycle | Basic updated; history |
| SET-006 | P1 | Fields | Custom fields | On Master/Run/export (one column) |
| SET-007 | P0 | Quarters | Add type+quarter | Unique; assignable |
| SET-008 | P1 | Night | Rates/ceiling | Used in Run |
| SET-009 | P0 | Electricity | Tariff slabs | New runs use active; history frozen |

## Employees (/employees) — Admin (not in sidebar)

| ID | Pri | Title | Expected |
|----|-----|-------|----------|
| EMP-001 | P1 | Tabs | Preboarding/Current/Past load |
| EMP-002 | P1 | Invite | Invite created; accept route known gap → login |
| EMP-003 | P2 | Company docs | Upload/list works |

## Employee Portal

| ID | Pri | Route | Title | Expected |
|----|-----|-------|-------|----------|
| ED-001 | P0 | /employee/dashboard | Stats load | Net/gross/latest payroll |
| ED-002 | P1 | /employee/dashboard | Quarter badges | HRA/rent indicators |
| ED-003 | P0 | /employee/payroll-history | History download | Opens pay tab |
| PR-001 | P0 | /profile?tab=profile | Change password | Re-login works |
| PR-002 | P0 | /profile?tab=pay | View/Download slip | Correct PDF |
| PR-003 | P1 | /profile?tab=pay | Deep link month/year | Correct month selected |

## Legacy redirects

| ID | Pri | Routes | Expected |
|----|-----|--------|----------|
| LEG-001 | P2 | /attendance, /holidays, /approvals | → /payroll/master |
| LEG-002 | P2 | /setup/company, /invite/* | → settings or login |

## Known gaps (document, do not fail product smoke)

- Self-signup disabled by design
- Attendance / Holidays / Approvals UI retired (redirect only)
- Invite accept UI currently redirects to login
- Employees module exists but is not in admin sidebar

## Pass / Fail log template

| ID | Tester | Date | Result (Pass/Fail) | Notes |
|----|--------|------|--------------------|-------|
| AUTH-001 | 
| | | |
| … | | | | |
