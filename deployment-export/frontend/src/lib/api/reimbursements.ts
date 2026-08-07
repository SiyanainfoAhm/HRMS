import { get, post, put, upload } from "./client";

export function getReimbursements(filters?: { status?: string; payroll_year?: string; payroll_month?: string }) {
  return get("/reimbursements", filters as Record<string, string>);
}

export function createReimbursement(data: Record<string, any>) {
  return post("/reimbursements", data);
}

export function updateReimbursement(id: string, data: Record<string, any>) {
  return put(`/reimbursements/${id}`, data);
}

export function uploadReimbursementFile(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return upload("/reimbursements/upload", formData);
}
