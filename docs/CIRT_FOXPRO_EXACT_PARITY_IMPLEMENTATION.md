# CIRT FoxPro September 2026 parity implementation

## Result

Exact parity is **not claimed**. The protected September run
`a30895ff-b1a4-4775-bd2b-cdf8d6e5004f` was left unchanged: no import,
recalculation, approval, lock, payment, or deployment was performed. The safe
implementation work is complete; the remaining variances require documented
source mapping or payroll-policy approval and must not be balanced artificially.

## Immutable source reference

The four workbooks in `data/imports/september-2026` were read in place. Their
SHA-256 values at verification time are:

| Workbook | SHA-256 |
|---|---|
| `Extract Sep 2026 as on 15.10.2026.xlsx` | `1CB61F846C714D2A3FFDBA2DEA5754DEE4F46CD3F89FE9B5325D53CC1F43327C` |
| `Extract Sept 2026 FoxPro.xlsx` | `24B8B934B445D9F6AB5B32AB654CD795CC315A97C954F6E9E991B6054FCE076A` |
| `Salary Data as on 15.10.2026.xlsx` | `616B7DC1437D7323965BDC13150F49EDD006FE9D5693E35452BA7CBB37E5E759` |
| `September Salary 2026 - Foxpro.xlsx` | `017222C0BE6B16F29E0AF59C866DD47C75AD6B3E28932CD9927848E124D9C09C` |

The FoxPro detail and employee input each contain 83 records. Eighty identities
match by CPF number; codes 082 Devendra Singh, 083 Vipin Kumar, and 084 Aditya
Kumar remain manual review. The CIRT saved/export population is 83 rows.

## Canonical comparison mapping

FoxPro `DA` is the source of DA (not `DA_PAY`). FoxPro detail `CPF` of
INR 1,036,728 is normalized as Extract CPF INR 995,062 plus GPF INR 41,666.
Dedicated CIRT components are used for education allowance, telephone
allowance, SP Pay, GPF, electricity, arrears, and encashment; none is folded
into an unrelated allowance.

## Before-change reconciliation basis

| Population | FoxPro gross | CIRT gross | Gross variance | FoxPro deductions | CIRT deductions | Deduction variance | FoxPro net | CIRT net | Net variance |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Whole payroll (83) | 8,685,518.00 | 8,670,218.43 | -15,299.57 | 2,702,034.00 | 2,682,254.00 | -19,780.00 | 5,983,484.00 | 5,987,964.43 | 4,480.43 |
| CPF-matched employees (80) | 8,151,268.00 | 8,123,168.43 | -28,099.57 | 2,555,697.00 | 2,534,858.00 | -20,839.00 | 5,595,571.00 | 5,588,310.43 | -7,260.57 |

The detailed-source comparison has 80 mapped employees. Its largest ranked
employee difference is code 069 (Amol Laxman Zape); the detailed workbook and
summary extract do not reconcile consistently for every component, so this is
diagnostic evidence only and not a new salary input.

## Implemented field and integrity fixes

`PayrollFieldRegistry` contains Education Allowance and Telephone Allowance as
separate earnings, SP Pay and Encashment as separate components, and GPF and
Electricity as separate deductions. Existing dynamic-field flow already carries
active components through payroll master, preview, calculated snapshot,
payslip, and monthly/three-month exports.

This implementation also fixes custom field deletion semantics:

* An unused custom field can be deleted.
* A custom field with assigned values is archived (`is_active=false`) instead;
  the response reports `archived: true` and retains dependent values.
* A field with assigned values cannot change earning/deduction classification
  or field type.
* System fields cannot be deleted. Reserved system keys cannot be duplicated.

## Outstanding approval register

| Topic | Evidence / financial effect | Required decision |
|---|---|---|
| Electricity | 2,333 units across 21 input rows; input charge is zero; FoxPro extract is INR 23,480 | Approve the effective tariff/billing mode or approved fixed imported charge with provenance. |
| CPF | CIRT CPF exceeds normalized FoxPro CPF by INR 45,366 | Approve the employee-level CPF basis/rate/cap/rounding policy, if CIRT's configured 12% basis is not authoritative. |
| Transport | CIRT exceeds FoxPro extract by INR 50,560 | Approve entitlement, level bands, DA treatment, and proration evidence. |
| HRA | CIRT differs by INR -4.57 | Approve rounding stage and accommodation eligibility rule. |
| Education / SP Pay / Telephone | FoxPro extract: INR 33,750 / 8,000 / 600; source input has only INR 8,600 special allowance | Supply employee-level component allocation. |
| Arrears / Encashment | Source contains generic arrears INR 22,636 and encashment INR 869 | Approve historical arrears classification; retain encashment as a distinct component. |
| GPF | Input and FoxPro evidence show INR 41,666 for one row | Confirm eligible employee and value assignment. |
| Identity | 082, 083, 084 have no CPF-confirmed source identity | Provide documentary pairing. |

## Verification

* Workbook inspection and reconciliation scripts were rerun without modifying
  source workbooks or payroll data.
* PHP 8.4 test suite: **167 passed, 741 assertions**. This covers custom
  earnings/deductions, GPF/telephone separation, electricity fixed/metered
  calculation paths, CPF modes, transport, snapshots, and actual XLSX
  monthly/three-month export round trips.
* Frontend production build is blocked only by the local environment attempting
  to download Google `Plus Jakarta Sans` through unavailable `127.0.0.1:9`.
  It is not a source/type failure.

## Controlled final scenario (22 October 2026)

A non-persisted 83-employee calculation was executed through
`runGovernmentPayrollCompute`; it writes no payroll rows, periods, or payslips.
It applies only these direct source-component mappings:

* Education Allowance: INR 33,750 for CPF 205, from FoxPro `TUITION`.
* Encashment: INR 869 for CPF 554, from FoxPro `ENCASH_DA`.
* HRA: source-paid input precision, increasing the aggregate by INR 4.57.

Its resulting gross/deduction/net totals are INR 8,704,842.00 / INR
2,682,254.00 / INR 6,022,588.00. This is not exact parity and is not a saved
payroll: electricity, CPF policy, transport policy, Special Pay/Telephone
split, arrears classification, GPF identity, and the three identity exceptions
remain deliberately excluded. The final workbook is
`outputs/cirt-september-2026-reconciliation/CIRT_September_2026_Final_Comparison.xlsx`.

## Changed files and rollback

* `backend/app/Services/PayrollFieldService.php`
* `backend/app/Http/Controllers/Api/V1/PayrollFieldController.php`
* `backend/tests/Unit/PayrollDynamicFieldsTest.php`

Rollback is code-only: revert those three files. No migration or database row
was created or altered by this implementation.
