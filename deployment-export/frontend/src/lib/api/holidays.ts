import { get, post, put, del } from "./client";

export function getHolidays(year?: string) {
  return get("/holidays", year ? { year } : undefined);
}

export function createHoliday(data: Record<string, any>) {
  return post("/holidays", data);
}

export function updateHoliday(id: string, data: Record<string, any>) {
  return put(`/holidays/${id}`, data);
}

export function deleteHoliday(id: string) {
  return del(`/holidays/${id}`);
}
