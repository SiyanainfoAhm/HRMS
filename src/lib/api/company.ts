import { get, post, put, del } from "./client";

export function getMyCompany() {
  return get("/company/me");
}

export function setupCompany(data: Record<string, any>) {
  return post("/company/setup", data);
}

export function updateMyCompany(data: Record<string, any>) {
  return put("/company/me", data);
}

export function getCompanyDocuments() {
  return get("/company/documents");
}

export function createCompanyDocument(data: Record<string, any>) {
  return post("/company/documents", data);
}

export function updateCompanyDocument(id: string, data: Record<string, any>) {
  return put(`/company/documents/${id}`, data);
}

export function deleteCompanyDocument(id: string) {
  return del(`/company/documents/${id}`);
}
