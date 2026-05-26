import { get, post, put, del } from "./client";

// Divisions
export function getDivisions() { return get("/settings/divisions"); }
export function createDivision(data: Record<string, any>) { return post("/settings/divisions", data); }
export function updateDivision(id: string, data: Record<string, any>) { return put(`/settings/divisions/${id}`, data); }
export function deleteDivision(id: string) { return del(`/settings/divisions/${id}`); }

// Departments
export function getDepartments() { return get("/settings/departments"); }
export function createDepartment(data: Record<string, any>) { return post("/settings/departments", data); }
export function updateDepartment(id: string, data: Record<string, any>) { return put(`/settings/departments/${id}`, data); }
export function deleteDepartment(id: string) { return del(`/settings/departments/${id}`); }

// Designations
export function getDesignations() { return get("/settings/designations"); }
export function createDesignation(data: Record<string, any>) { return post("/settings/designations", data); }
export function updateDesignation(id: string, data: Record<string, any>) { return put(`/settings/designations/${id}`, data); }
export function deleteDesignation(id: string) { return del(`/settings/designations/${id}`); }

// Shifts
export function getShifts() { return get("/settings/shifts"); }
export function createShift(data: Record<string, any>) { return post("/settings/shifts", data); }
export function updateShift(id: string, data: Record<string, any>) { return put(`/settings/shifts/${id}`, data); }
export function deleteShift(id: string) { return del(`/settings/shifts/${id}`); }

// Roles
export function getRoles() { return get("/settings/roles"); }
export function createRole(data: Record<string, any>) { return post("/settings/roles", data); }
export function updateRole(id: string, data: Record<string, any>) { return put(`/settings/roles/${id}`, data); }
export function deleteRole(id: string) { return del(`/settings/roles/${id}`); }
