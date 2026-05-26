import { get, post } from "./client";

export function getMyAttendance(month?: string) {
  return get("/attendance/me", month ? { month } : undefined);
}

export function punchAttendance(action: string, lat?: number, lng?: number) {
  return post("/attendance", { action, lat, lng });
}

export function getCompanyAttendance(params?: { date?: string; month?: string }) {
  return get("/attendance/company", params as Record<string, string>);
}
