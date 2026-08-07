import { get, post, put } from "./client";

export function getLeaveTypes() { return get("/leave/types"); }
export function createLeaveType(data: Record<string, any>) { return post("/leave/types", data); }

export function getLeavePolicies() { return get("/leave/policies"); }
export function createLeavePolicy(data: Record<string, any>) { return post("/leave/policies", data); }

export function getLeaveBalance(userId?: string) {
  return get("/leave/balance", userId ? { user_id: userId } : undefined);
}

export function getLeaveRequests(status?: string) {
  return get("/leave/requests", status ? { status } : undefined);
}

export function createLeaveRequest(data: Record<string, any>) {
  return post("/leave/requests", data);
}

export function updateLeaveRequest(id: string, data: Record<string, any>) {
  return put(`/leave/requests/${id}`, data);
}
