import { get, post, put } from "./client";

// Periods
export function getPayrollPeriods() { return get("/payroll/periods"); }
export function createPayrollPeriod(data: Record<string, any>) { return post("/payroll/periods", data); }
export function updatePayrollPeriod(id: string, data: Record<string, any>) { return put(`/payroll/periods/${id}`, data); }

// Master
export function getPayrollMaster(userId?: string) {
  return get("/payroll/master", userId ? { user_id: userId } : undefined);
}
export function createPayrollMaster(data: Record<string, any>) { return post("/payroll/master", data); }

// Run
export function runPayroll(periodId: string, employeeUserIds: string[]) {
  return post("/payroll/run", { period_id: periodId, employee_user_ids: employeeUserIds });
}

// Payslips bulk create
export function createPayslips(payslips: Record<string, any>[]) {
  return post("/payroll/payslips", { payslips });
}

// Export
export function exportPayroll(periodId: string) {
  return get("/payroll/export", { period_id: periodId });
}
