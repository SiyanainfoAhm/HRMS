/**
 * Laravel API root (must end with /api/v1).
 *
 * On Vercel, prefer API_URL (read at runtime on server routes).
 * NEXT_PUBLIC_API_URL is inlined at build time — if unset during build, production
 * would keep calling localhost:8000 until you redeploy.
 */
export function getApiBaseUrl(): string {
  const raw =
    process.env.API_URL ||
    process.env.LARAVEL_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8000/api/v1";

  return raw.replace(/\/$/, "");
}
