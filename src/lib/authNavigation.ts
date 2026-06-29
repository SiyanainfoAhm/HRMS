/** Sign out via API and navigate to login (full page load clears client state). */
export async function performLogout(): Promise<void> {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
  });
  window.location.assign("/auth/login");
}
