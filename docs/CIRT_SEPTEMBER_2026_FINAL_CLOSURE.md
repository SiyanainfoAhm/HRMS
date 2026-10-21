# CIRT September 2026 Reconciliation Closure

## Scope and baseline

- Local development database: PostgreSQL `hrms`; CIRT API: `http://127.0.0.1:8001`.
- Run: `a30895ff-b1a4-4775-bd2b-cdf8d6e5004f`, unapproved and unlocked.
- Population: 83 CIRT employees, including 21 active quarter assignments; DA is 60%.
- Protection: the sole super-admin and the verified pre-reset backup remain preserved.
- No reset, employee re-import, duplicate run, payment, posting, approval, lock, or deployment was performed.

## Normalized FoxPro comparison basis

FoxPro detail `CPF` is `1,036,728`: Extract CPF `995,062` plus Extract GPF
`41,666`. Comparative reports therefore treat CPF and GPF separately. FoxPro
DA is `2,559,666` from the `DA` field; `DA_PAY` is not the comparison field.

| Population | FoxPro gross | CIRT gross | Difference | FoxPro deductions | CIRT deductions | Difference | FoxPro net | CIRT net | Difference |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Whole payroll (83) | 8,685,518.00 | 8,670,218.43 | -15,299.57 | 2,702,034.00 | 2,682,254.00 | -19,780.00 | 5,983,484.00 | 5,987,964.43 | 4,480.43 |
| CPF-verified match (80) | 8,151,268.00 | 8,123,168.43 | -28,099.57 | 2,555,697.00 | 2,534,858.00 | -20,839.00 | 5,595,571.00 | 5,588,310.43 | -7,260.57 |

## Implemented corrections

- Fixed reporting normalization for FoxPro DA and CPF/GPF separation.
- Added separate dynamic payroll classifications:
  - `telephone_allowance`: earnings, included in gross earnings.
  - `gpf`: deduction, independent from CPF and DA CPF.
- Applied `2026_10_21_130000_add_gpf_and_telephone_payroll_fields` only.
  The unrelated `2026_09_29_120000_include_numeric_statutory_fields_in_payroll_deductions` migration remains pending.
- The dynamic-field pipeline provides employee-master configuration, calculation
  custom maps, payslip rows, monthly-snapshot JSON, and salary-export columns.

## Component mapping and status

| Component | CIRT classification | Source evidence | Status |
|---|---|---|---|
| Education allowance | dedicated earning | FoxPro extract 33,750; no employee-input column | Pending source-to-employee mapping |
| SP Pay | dedicated earning | FoxPro extract 8,000; `special_allowance` source total is 8,600 | Pending separation from telephone |
| Telephone allowance | dedicated earning, newly added | residual 600 within 8,600 source special allowance | Approval required for eligibility/split |
| Encashment | dedicated snapshot/payslip/export field | `encashment_arrears` 869, one source row | Verified source field; snapshot unchanged |
| Arrears | DA/transport/gross/net classifications | generic source `arrears` 22,636, one row | Pending classification |
| GPF | dedicated deduction, newly added | `gpf` 41,666, one source row | Pending eligibility/value assignment |
| Electricity | dedicated deduction, fixed or metered | zero monetary input; 2,333 units across 21 source rows; FoxPro extract 23,480 | Pending tariff/mode validation |

## Approval table

| Decision | Current CIRT treatment | FoxPro treatment | Financial effect | Recommendation |
|---|---|---|---:|---|
| CPF basis/rate/rounding | configured 12% formula | CPF 995,062 | CPF variance +45,366 | retain CIRT formula pending written policy |
| Transport eligibility/rates | configured pay-level calculation | lower total | gross variance +50,560 | confirm entitlement/rate table before change |
| HRA rounding | CIRT paid-result rounding | source aggregate differs | -4.57 | confirm intended rounding stage |
| Generic arrears | no generic bucket | 22,636 | -22,636 gross | create a classified historical-arrears rule only with approval |
| SP Pay/telephone split | no source mapping loaded | 8,000/600 | -8,600 gross | obtain employee-level split evidence |
| GPF | field available, no values applied | 41,666 | -41,666 deductions | approve eligible employee/value |
| Electricity | no monetary value loaded | 23,480 | -23,480 deductions | validate tariff/effective date and fixed vs metered mode |

## Manual identity review

Codes `082` Devendra Singh, `083` Vipin Kumar, and `084` Aditya Kumar remain
Manual Review. They are included in CIRT payroll but excluded from matched
FoxPro employee-variance totals.

## Persistence, export, testing, rollback

- Existing run remains 83 saved monthly snapshots and 83 exported rows; the
  export reads persisted monthly snapshots, with no export-only variance found.
- PHP 8.4.25 unit suite: 160 passed / 682 assertions. One existing risky test
  warning remains in `EmployeePayrollExportLongFormatTest`.
- Changed files include `PayrollFieldRegistry.php`,
  `2026_10_21_130000_add_gpf_and_telephone_payroll_fields.php`, and
  `PayrollDynamicFieldsTest.php`.
- Rollback: restore the existing pre-reset PostgreSQL custom dump, or roll back
  only the new migration after confirming no GPF/telephone values have been
  entered. The September payroll itself has not been recalculated.

## Approval readiness

Not ready for approval: policy decisions above must be approved and then
applied through the existing calculation engine with a recorded before/after
audit. Aggregate agreement alone is not treated as reconciliation closure.
