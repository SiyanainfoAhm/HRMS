import type { GovernmentOptionalMonthlyEarnings } from "./governmentPayroll";

/** Preserve variable earning heads when recomputing government preview after pay-day changes. */
export function govOptionalFromComputedMonthly(
  g: Record<string, unknown> | null | undefined,
): GovernmentOptionalMonthlyEarnings | undefined {
  if (!g || typeof g !== "object") return undefined;
  const spPay = Number(g.spPayPaid) || 0;
  const extraWorkAllowance = Number(g.extraWorkAllowancePaid) || 0;
  const uniformAllowance = Number(g.uniformAllowancePaid) || 0;
  const educationAllowance = Number(g.educationAllowancePaid) || 0;
  const daArrears = Number(g.daArrearsPaid) || 0;
  const transportArrears = Number(g.transportArrearsPaid) || 0;
  const encashment = Number(g.encashmentPaid) || 0;
  const encashmentDa = Number(g.encashmentDaPaid) || 0;
  if (
    !spPay &&
    !extraWorkAllowance &&
    !uniformAllowance &&
    !educationAllowance &&
    !daArrears &&
    !transportArrears &&
    !encashment &&
    !encashmentDa
  ) {
    return undefined;
  }
  return {
    spPay,
    extraWorkAllowance,
    uniformAllowance,
    educationAllowance,
    daArrears,
    transportArrears,
    encashment,
    encashmentDa,
  };
}
