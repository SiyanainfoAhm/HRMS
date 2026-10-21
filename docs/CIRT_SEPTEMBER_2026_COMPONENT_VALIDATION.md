# September 2026 Component Validation

Date: 2026-10-21. Evidence was read from the four supplied workbooks,
`.phase2-export.json`, and the existing saved September response. The protected
run `a30895ff-b1a4-4775-bd2b-cdf8d6e5004f` was not recalculated, changed,
approved, or locked.

## Required end-to-end path

| Component | Settings/master | Calculation and preview | Saved snapshot/payslip | Monthly / quarterly / extract Excel | Status |
| --- | --- | --- | --- | --- | --- |
| Basic, DA, Medical | Present | Equal to source aggregate | Persisted | Present | PASS |
| HRA | Master percentage | Present | Persisted | Present | PASS for saved data; import precision fix prepared |
| Transport | Pay-level slab settings/master override | Present | Persisted | Present | PASS technically; FoxPro policy variance open |
| CPF | 12%, configured basis | Present | Persisted | Present | PASS technically; FoxPro basis variance open |
| DA CPF | Dedicated deduction | Present | Persisted | Present | PASS (both totals zero) |
| GPF | Dedicated registry classification exists | Not seeded from September master | No saved amount | No dedicated populated amount | FAIL — structural mapping remains incomplete |
| Electricity | Tariff/manual setting exists | Present when units/amount are supplied | Persisted | Present, including units | FAIL for September source-to-master mapping |
| Water | Master deduction | Present | Persisted | Present | PASS |
| Quarter rent | Quarter assignment/rent | Present | Persisted | Present | PASS |
| LIC, VPF, PF loan, Post Office, Credit Society, Income Tax, PT, Mess, Welfare, Loan Recovery, Vehicle, Other | Dedicated master deductions | Present | Persisted | Present | PASS from current code path |
| Dynamic earnings/deductions | Payroll-field definition/value maps | Included once | JSON snapshot maps / payslip | Dynamic Excel columns | PASS |

Monthly and quarterly exports both read saved `cirt_monthly_payroll` rows. The
quarterly selection is a long-format set of the selected monthly snapshots; it
does not repeat one monthly value across three months. The salary extract is
serialized from those same saved rows. The existing evidence contains 83 saved
and exported rows, so saved/export values are identical for the reported fields.

## September variance evidence

| Component | FoxPro | CIRT | CIRT − FoxPro | Origin and decision |
| --- | ---:| ---:| ---:| --- |
| Electricity | 23,480 | 0 | -23,480 | Source payroll input has 2,333 units over 21 rows, but its electricity money column is zero. September snapshots have 83 `manual_fixed` rows, 0 units and ₹0. Do not derive charges: tariff/meter/billing basis must be approved. |
| CPF | 995,062 | 1,040,428 | +45,366 | CIRT configuration is 12% of Basic + DA + HRA + Medical + Transport. The excess is a basis-policy/source difference, not an export/persistence defect. Do not change formula without approval. |
| DA CPF | 0 | 0 | 0 | Dedicated component reconciles. |
| GPF | 41,666 | 0 | -41,666 | One source input row has GPF. The field definition is separate from CPF/DA CPF, but the September importer/master/snapshot pipeline has no dedicated GPF amount mapping. This is a verified structural defect; do not backfill protected September snapshots. |
| Transport | 536,400 | 586,960 | +50,560 | CIRT applies configured pay-level slabs and DA on transport. The CPF-matched detailed comparison is +37,760; the whole-payroll extract comparison is +50,560. Eligibility/rate rules differ from FoxPro and require policy confirmation. |
| HRA | 1,008,487 | 1,008,482.43 | -4.57 | Confirmed importer precision loss: source HRA was converted to a percentage rounded to two decimals then reconstructed. The importer now retains the full ratio for future imports; no September snapshot was changed. |

The detailed source uses inconsistent aggregate fields, so whole-payroll extract
totals and the 80 CPF-verified matched population are reported separately. Three
records remain in Manual Review and are not identity-matched.

## Safe correction made

`scripts/import-september-2026.php` no longer rounds the intermediate HRA
percentage to two decimals. This preserves the source-paid HRA when a future,
explicitly authorized import is calculated. It does not execute an import or
alter the September draft.

## Required next approvals

1. Approve the authoritative CPF basis if FoxPro’s lower basis is intended.
2. Provide electricity bill/meter or tariff-effective evidence for the 2,333
   source units; no amount will be inferred from units alone.
3. Approve the FoxPro transport eligibility/rate table before changing slabs or
   employee eligibility.
4. Authorize the dedicated GPF master-to-snapshot migration and an explicitly
   scoped future run/reconciliation. It must not backfill the protected draft.
