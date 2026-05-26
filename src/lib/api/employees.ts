import { get, post, put } from "./client";

export function getEmployees() {
  return get("/employees");
}

export function getEmployee(id: string) {
  return get(`/employees/${id}`);
}

export function createEmployee(data: Record<string, any>) {
  return post("/employees", data);
}

export function updateEmployee(id: string, data: Record<string, any>) {
  return put(`/employees/${id}`, data);
}

export function getEmployeeOnboarding(id: string) {
  return get(`/employees/${id}/onboarding`);
}
