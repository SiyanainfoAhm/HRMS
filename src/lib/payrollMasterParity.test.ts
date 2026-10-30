/**
 * Run: npx --yes tsx src/lib/payrollMasterParity.test.ts [--write]
 *
 * The Master screen previews totals in TypeScript and the server stores them from
 * PHP. Both must give identical figures for the same inputs. The expected values
 * live in backend/tests/fixtures/master_calc_parity.json and the PHP test
 * (MasterCalcParityTest) checks the same file.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { computePayrollMasterPreview } from "./payrollMasterCalc";

type Case = {
  name: string;
  /** snake_case input for PHP; mapped to the TS preview input below */
  input: {
    pay_level: number; gross_basic_pay: number; da_percent: number; hra_percent: number; medical: number;
    professional_tax: number; income_tax?: number; lic?: number; mess?: number; welfare?: number; vpf?: number;
    pf_loan?: number; post_office?: number; credit_society?: number; electricity?: number; water?: number;
    loan_recovery?: number; other_deduction?: number; advance?: number; has_quarter?: boolean; quarter_rent?: number;
  };
};

const cases: Case[] = [
  { name: "typical level 10", input: { pay_level: 10, gross_basic_pay: 34590, da_percent: 53, hra_percent: 30, medical: 3000, professional_tax: 200 } },
  { name: "with deductions", input: { pay_level: 10, gross_basic_pay: 34590, da_percent: 53, hra_percent: 30, medical: 3000, professional_tax: 200, lic: 1500, mess: 650, credit_society: 11750, water: 314, electricity: 49, advance: 500 } },
  { name: "quarter holder (no HRA, rent deducted)", input: { pay_level: 12, gross_basic_pay: 52000, da_percent: 53, hra_percent: 30, medical: 3000, professional_tax: 200, has_quarter: true, quarter_rent: 880 } },
  { name: "zero gross", input: { pay_level: 1, gross_basic_pay: 0, da_percent: 53, hra_percent: 30, medical: 0, professional_tax: 0 } },
  { name: "very large", input: { pay_level: 14, gross_basic_pay: 5000000, da_percent: 60, hra_percent: 27, medical: 3000, professional_tax: 200, income_tax: 90000 } },
  { name: "fractional percentages", input: { pay_level: 8, gross_basic_pay: 28333, da_percent: 52.5, hra_percent: 27.5, medical: 3000, professional_tax: 200 } },
];

const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

function ts(c: Case) {
  const input: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c.input)) input[camel(k)] = v;
  const p = computePayrollMasterPreview({
    ...input,
    cpfUseCompanySettings: true,
    companyCpfPercentage: 12,
    companyCpfBasisFieldKeys: ["gross_basic", "da", "hra", "medical", "transport"],
    companyCpfCalculationMode: "percentage",
    companyCpfFixedAmount: 0,
  });
  return {
    da_amount: p.daAmount, hra_amount: p.hraAmount, transport_total: p.transportTotal,
    total_earnings: p.totalEarnings, cpf: p.cpfEffective, total_deductions: p.totalDeductions, take_home: p.takeHome,
  };
}

const path = new URL("../../backend/tests/fixtures/master_calc_parity.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const actual = cases.map((c) => ({ name: c.name, input: c.input, expected: ts(c) }));
if (process.argv.includes("--write")) {
  writeFileSync(path, JSON.stringify(actual, null, 2) + "\n");
  console.log("fixture written:", path);
} else {
  const stored = JSON.parse(readFileSync(path, "utf8"));
  if (JSON.stringify(stored) !== JSON.stringify(actual)) {
    throw new Error("TypeScript Master calculation no longer matches backend/tests/fixtures/master_calc_parity.json (regenerate with --write only after the PHP side is updated too).");
  }
  console.log("payrollMasterParity.test.ts: all tests passed");
}
