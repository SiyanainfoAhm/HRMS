# TASKS

## CIRT-FIX (branch `fix/cirt-pune-issues`, local only, no deploy)

Rules: finalized payroll never changes; fields are marked inactive, never deleted; unconfirmed rules sit behind one named constant and are listed under Needs clarification.

- [ ] CIRT-01 Electricity units (Subhash 80 -> 49): trace every read/write, prove 80 survives save/draft/recalc/reset/finalise
- [ ] CIRT-02 Prakash audit: Credit Society, Quarter Rent, DA, Electricity, Mess (input -> rule -> saved -> payslip) + regression test
- [ ] CIRT-03 Performance: profile draft + list/report screens, fix safe wins, before/after timings, server-spec proposal (in reply)
- [ ] CIRT-04 Inactive fields: usage list, Inactive flag, hide from entry/selection, Unpaid Arrears inactive, candidate list
- [ ] CIRT-05 Arrears rename: Gross Arrears / Past Arrears, one label source, list all arrears fields
- [ ] CIRT-06 Deductions "DA Arr" -> "CPF Arr": amount not showing (entry, preview, payslip, reports)
- [ ] CIRT-07 Net Arrears not shown in Earnings: bind + display, formula unchanged
- [ ] CIRT-08 Night Duty Allowance = (hours / 8) x per-Pay-Level rate; rounding behind one constant
- [ ] CIRT-09 Remove Mess, Credit Society, Electricity from Master Payroll Deductions entry only; totals unchanged
- [ ] CIRT-10 Activity Log: one main record per action + child detail rows + View Details
- [ ] CIRT-11 Post Payroll Downloads: TDS, CPF, Division-Wise Excel exports (match System Format samples)
- [ ] CIRT-12 Post Payroll Downloads: Paybill Excel (flat + print-style), columns mapped to payroll fields
