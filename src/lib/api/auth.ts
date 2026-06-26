import { get, post } from "./client";

export async function apiLogin(email: string, password: string) {
  return post("/auth/login", { email, password });
}

export async function apiSignup(email: string, password: string, name?: string) {
  return post("/auth/signup", { email, password, name });
}

export async function apiLogout() {
  try {
    await post("/auth/logout");
  } catch {
    // Best-effort remote logout.
  }
}

export async function apiGetMe() {
  return get("/auth/me");
}

export async function apiChangePassword(currentPassword: string, newPassword: string) {
  return post("/auth/change-password", {
    current_password: currentPassword,
    new_password: newPassword,
  });
}
