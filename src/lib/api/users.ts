import { get, put } from "./client";

export function getUsers(params?: { role?: string; employment_status?: string; search?: string }) {
  return get("/users", params as Record<string, string>);
}

export function getUser(id: string) {
  return get(`/users/${id}`);
}

export function updateUser(id: string, data: Record<string, any>) {
  return put(`/users/${id}`, data);
}

export function getMe() {
  return get("/me");
}

export function updateMe(data: Record<string, any>) {
  return put("/me", data);
}

export function getMyDocuments() {
  return get("/me/documents");
}

export function getMyPayrollMaster() {
  return get("/me/payroll-master");
}
