import { roundMoney } from "@/lib/money";

/**
 * THE DA CPF of an employee-month = CPF on the DA arrears = the CPF Arr line (mirror: PayrollTotals::daCpf in PHP).
 * `deductions.daCpf` / `da_cpf_amount` is never read by a report: it is not an input any more (always 0), and the
 * amount is already inside Total Deductions through CPF Arr, so reading it again would count it twice.
 *
 * Accepts a monthly snapshot (camel keys), a monthly DB row (snake keys) or a Run Payroll row that carries `cpfArrear`.
 */
export function daCpfOf(source: unknown): number {
  const s = (source ?? {}) as Record<string, unknown>;
  const gm = (s.governmentMonthly ?? null) as Record<string, unknown> | null;
  const arrearDed = (s.arrearDeductions ?? null) as Record<string, unknown> | null;
  const raw = s.cpfArrear ?? s.cpf_arrear ?? gm?.cpfArrear ?? gm?.cpf_arrear ?? arrearDed?.cpfArrear ?? 0;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? Math.max(0, roundMoney(n)) : 0;
}

/** Total CPF = CPF + DA CPF. */
export function totalCpfOf(source: unknown): number {
  const s = (source ?? {}) as Record<string, unknown>;
  const ded = (s.deductions ?? null) as Record<string, unknown> | null;
  const raw = ded?.cpf ?? s.cpf_amount ?? s.cpf ?? 0;
  const cpf = Number(raw);
  return roundMoney((Number.isFinite(cpf) ? Math.max(0, cpf) : 0) + daCpfOf(s));
}
