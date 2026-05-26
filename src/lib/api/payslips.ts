import { get } from "./client";

export function getMyPayslips() {
  return get("/payslips/me");
}

export function getEmployeePayslips(userId: string) {
  return get("/payslips/employee", { user_id: userId });
}
