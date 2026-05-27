import {
  computeLeaveBalanceRows,
  formatGovernmentLeavePayslipDisplay,
  slipBalanceAsOfYmd,
  type LeavePolicyWithTypeRow,
} from "@/lib/leaveBalancesCompute";
import type { ApprovedLeave } from "@/lib/leavePolicy";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

function policyRowsFromApi(leavePolicies: unknown[]): LeavePolicyWithTypeRow[] {
  return (leavePolicies ?? []).map((p: any) => {
    const lt = p.leaveType ?? p.leave_type ?? p.HRMS_leave_types ?? null;
    const typeObj = Array.isArray(lt) ? lt[0] : lt;
    return {
      leave_type_id: String(p.leave_type_id ?? p.leaveTypeId ?? ""),
      accrual_method: String(p.accrual_method ?? p.accrualMethod ?? "none"),
      monthly_accrual_rate: p.monthly_accrual_rate ?? p.monthlyAccrualRate ?? null,
      annual_quota: p.annual_quota ?? p.annualQuota ?? null,
      prorate_on_join: Boolean(p.prorate_on_join ?? p.prorateOnJoin),
      reset_month: p.reset_month ?? p.resetMonth ?? 1,
      reset_day: p.reset_day ?? p.resetDay ?? 1,
      allow_carryover: p.allow_carryover ?? p.allowCarryover ?? false,
      carryover_limit: p.carryover_limit ?? p.carryoverLimit ?? null,
      HRMS_leave_types: typeObj
        ? {
            name: typeObj.name,
            is_paid: typeObj.is_paid ?? typeObj.isPaid,
            code: typeObj.code,
            payslip_slot: typeObj.payslip_slot ?? typeObj.payslipSlot ?? null,
          }
        : null,
    };
  });
}

function approvedLeavesFromApi(requests: unknown[], employeeUserId: string): ApprovedLeave[] {
  return (requests ?? [])
    .filter((r: any) => String(r.employee_user_id ?? r.employeeUserId ?? "") === employeeUserId)
    .filter((r: any) => String(r.status ?? "").toLowerCase() === "approved")
    .map((r: any) => ({
      leave_type_id: String(r.leave_type_id ?? r.leaveTypeId ?? ""),
      start_date: String(r.start_date ?? r.startDate ?? "").slice(0, 10),
      end_date: String(r.end_date ?? r.endDate ?? "").slice(0, 10),
      total_days: Number(r.total_days ?? r.totalDays ?? 0) || 0,
    }));
}

/**
 * Attach leavePayslip to government-mode payslips when the company has leave policies.
 */
export async function enrichPayslipsWithLeave<T extends { payslips?: any[]; user?: any }>(
  payload: T,
  employeeUserId: string,
  authHeader: string | null,
): Promise<T> {
  if (!authHeader || !employeeUserId || !payload.payslips?.length) {
    return payload;
  }

  const headers = { Accept: "application/json", Authorization: authHeader };

  const [polRes, reqRes] = await Promise.all([
    fetch(`${API_BASE}/leave/policies`, { headers, cache: "no-store" }),
    fetch(`${API_BASE}/leave/requests?status=approved&employee_user_id=${encodeURIComponent(employeeUserId)}`, {
      headers,
      cache: "no-store",
    }),
  ]);

  if (!polRes.ok) return payload;

  const polData = await polRes.json().catch(() => ({}));
  const policyRows = policyRowsFromApi(polData.leavePolicies ?? polData.leave_policies ?? []);
  if (policyRows.length === 0) {
    return {
      ...payload,
      payslips: payload.payslips.map((s) => ({ ...s, leavePayslip: null })),
    };
  }

  const reqData = reqRes.ok ? await reqRes.json().catch(() => ({})) : {};
  const approved = approvedLeavesFromApi(
    reqData.leaveRequests ?? reqData.leave_requests ?? reqData.requests ?? [],
    employeeUserId,
  );

  const joinStr = payload.user?.dateOfJoining
    ? String(payload.user.dateOfJoining).slice(0, 10)
    : payload.user?.date_of_joining
      ? String(payload.user.date_of_joining).slice(0, 10)
      : null;

  const cache = new Map<string, ReturnType<typeof formatGovernmentLeavePayslipDisplay>>();

  const payslips = payload.payslips.map((slip: any) => {
    const isGov = (slip.payrollMode ?? slip.payroll_mode) === "government" || slip.governmentMonthly;
    if (!isGov) return { ...slip, leavePayslip: null };

    const periodEnd = slip.periodEnd ?? slip.period_end ?? "";
    const periodStart = slip.periodStart ?? slip.period_start ?? "";
    const generatedAt = slip.generatedAt ?? slip.generated_at ?? "";
    const asOf = slipBalanceAsOfYmd(periodEnd, periodStart, generatedAt);

    if (!cache.has(asOf)) {
      const rows = computeLeaveBalanceRows(policyRows, approved, joinStr, asOf);
      cache.set(asOf, formatGovernmentLeavePayslipDisplay(rows));
    }

    return { ...slip, leavePayslip: cache.get(asOf) ?? null };
  });

  return { ...payload, payslips };
}
