import { get, post, setToken } from "./client";

export async function apiLogin(email: string, password: string) {
  const data = await post("/auth/login", { email, password });
  setToken(data.token);
  return data;
}

export async function apiSignup(email: string, password: string, name?: string) {
  const data = await post("/auth/signup", { email, password, name });
  setToken(data.token);
  return data;
}

export async function apiLogout() {
  try {
    await post("/auth/logout");
  } finally {
    setToken(null);
  }
}

export async function apiGetMe() {
  return get("/auth/me");
}

export async function apiChangePassword(currentPassword: string, newPassword: string) {
  const data = await post("/auth/change-password", {
    current_password: currentPassword,
    new_password: newPassword,
  });
  if (data.token) {
    setToken(data.token);
  }
  return data;
}
