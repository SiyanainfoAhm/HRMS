/**
 * One-off dry run for the CIRT leave calculation change (ADM:Gen:1521). Writes nothing.
 * Reads a JSON dump of draft rows + reference-salary responses and prints old -> new for Basic, DA, HRA,
 * Medical, Gross and Net using the SAME compute the Run Payroll screen uses.
 *
 *   npx tsx scripts/leave-lines-dry-run.ts <dump.json>
 */
import fs from "node:fs";
import { runGovernmentPayrollCompute, type GovRecalcPayload } from "../src/lib/govRunPayrollCompute";
import { applyFrozenSheetOverridesToComputed } from "../src/lib/runPayrollSheetEdit";
import { applyBasicDaEarningsCut, computeEolHplDeductions } from "../src/lib/hplEolDeductions";
import type { LeaveLine } from "../src/lib/leaveDeductions";

type Ref = { grossBasic: number; daPercent: number; daysInMonth: number; daPercentPaid?: number };
type Dump = { name: string; userId: string; row: Record<string, unknown>; payDays: number | null; netPay: number; refs: Record<string, Ref> }[];

const dump: Dump = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const RUN = { year: 2026, month: 10, dim: 31 };
const fmt = (n: unknown) => Number(n ?? 0).toLocaleString("en-IN");

function compute(gr: GovRecalcPayload, gm: Record<string, unknown>, payDays: number) {
  const { comp } = runGovernmentPayrollCompute(gr, { daysInMonth: RUN.dim, payDays, runYear: RUN.year, runMonth: RUN.month, governmentMonthly: gm });
  return applyFrozenSheetOverridesToComputed(gr, comp as unknown as Record<string, unknown>) as Record<string, number>;
}
// Net / deductions are stored-draft values plus the computed change, because this harness has no electricity tariff or
// quarter data (those deductions come from the server-side reconcile and are not touched by leave).
const pick = (c: Record<string, number>) => ({ basic: c.basicPaid, da: c.daPaid, hra: c.hraPaid, medical: c.medicalPaid, gross: c.totalEarnings, ded: c.totalDeductions, net: c.netSalary });
const line = (label: string, p: ReturnType<typeof pick>) =>
  `  ${label.padEnd(34)} Basic ${fmt(p.basic).padStart(7)}  DA ${fmt(p.da).padStart(7)}  HRA ${fmt(p.hra).padStart(7)}  Medical ${fmt(p.medical).padStart(6)}  Gross ${fmt(p.gross).padStart(8)}  Net ${fmt(p.net).padStart(8)}`;

for (const e of dump) {
  const gm = (e.row.governmentMonthly ?? {}) as Record<string, number>;
  const gr0 = e.row.govRecalc as unknown as GovRecalcPayload;
  const payDays = Number(e.row.payDays ?? e.payDays ?? RUN.dim);
  const clean: GovRecalcPayload = { ...gr0, hplDays: 0, eolDays: 0, leaveLines: undefined, hplDeductionManualOverride: false, eolDeductionManualOverride: false };
  // Same overrides the screen clears when HPL / EOL days are edited.
  const cleared: GovRecalcPayload = { ...clean, earningPaidOverrides: undefined, deductionPaidOverrides: clean.deductionPaidOverrides ? { ...clean.deductionPaidOverrides } : undefined, cpfManualOverride: false };

  const isVeena = e.name.includes("Veena");
  const sep = e.refs["2026-9"];
  const oct = e.refs["2026-10"];
  const leave: LeaveLine[] = isVeena
    ? [{ type: "HPL", month: 9, year: 2026, days: 1, grossBasic: sep.grossBasic, daPercent: sep.daPercent, daysInMonth: sep.daysInMonth }]
    : [
        { type: "HPL", month: 9, year: 2026, days: 4, grossBasic: sep.grossBasic, daPercent: sep.daPercent, daysInMonth: sep.daysInMonth },
        { type: "EOL", month: 9, year: 2026, days: 2, grossBasic: sep.grossBasic, daPercent: sep.daPercent, daysInMonth: sep.daysInMonth },
        { type: "HPL", month: 10, year: 2026, days: 1 },
        { type: "EOL", month: 10, year: 2026, days: 2 },
      ];

  console.log(`\n${e.name}  (draft Gross ${fmt(gm.totalEarnings)}, Net ${fmt(gm.netSalary)})`);
  console.log(`  Sep ref: Gross Basic ${fmt(sep.grossBasic)}, DA ${sep.daPercent}% (Sep was PAID at ${sep.daPercentPaid}%), ${sep.daysInMonth} days; Oct: ${oct.daysInMonth} days`);
  const base0 = pick(compute(cleared, gm, payDays));
  const storedNet = Number(gm.netSalary);
  const storedDed = Number(gm.totalDeductions);
  const shown = (p: ReturnType<typeof pick>) => ({ ...p, net: storedNet + (p.net - base0.net), ded: storedDed + (p.ded - base0.ded) });
  if (Math.abs(base0.gross - Number(gm.totalEarnings)) > 0.5) console.log(`  !! harness Gross differs from the stored draft: ${base0.gross} vs ${gm.totalEarnings}`);
  const base = shown(base0);
  console.log(line("Draft now (no leave entered)", base));
  if (isVeena) {
    // Old app, reproduced from the old code still in hplEolDeductions.ts: one cut on (Basic + DA at the stored 60%)
    // x 0.5 / 30, then split between the CURRENT Basic and DA paid in proportion.
    const oldRef = { basic: sep.grossBasic, da: Math.round(sep.grossBasic * (sep.daPercentPaid ?? 60) / 100), hra: 0, medical: 0 };
    const cut = computeEolHplDeductions({ referenceSalary: oldRef, daysInReferenceMonth: sep.daysInMonth, hplDays: 1 }).hplDeduction;
    const after = applyBasicDaEarningsCut({ basic: base.basic, da: base.da, hra: base.hra, medical: base.medical }, cut);
    console.log(line(`Old app, HPL 1 day (cut ${fmt(cut)})`, { ...base, basic: after.basic, da: after.da, gross: base.gross - cut, net: base.net - cut }));
  }
  const withLeave = shown(pick(compute({ ...cleared, leaveLines: leave, hplDays: leave.filter((l) => l.type === "HPL").reduce((s, l) => s + l.days, 0), eolDays: leave.filter((l) => l.type === "EOL").reduce((s, l) => s + l.days, 0) }, gm, payDays)));
  console.log(line("NEW rules with leave entered", withLeave));
  console.log(`  change vs draft now:  Basic ${fmt(withLeave.basic - base.basic)}  DA ${fmt(withLeave.da - base.da)}  HRA ${fmt(withLeave.hra - base.hra)}  Medical ${fmt(withLeave.medical - base.medical)}  Gross ${fmt(withLeave.gross - base.gross)}  Deductions ${fmt(withLeave.ded - base.ded)}  Net ${fmt(withLeave.net - base.net)}`);
}
