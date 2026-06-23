import { NextRequest, NextResponse } from "next/server";
import { TOKEN_COOKIE_NAME } from "@/lib/auth";
import { getApiBaseUrl } from "@/lib/apiBase";

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function transformKeysToSnake(obj: any): any {
  if (Array.isArray(obj)) return obj.map(transformKeysToSnake);
  if (obj !== null && typeof obj === "object" && !(obj instanceof Date)) {
    const out: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      out[camelToSnake(key)] = transformKeysToSnake(value);
    }
    return out;
  }
  return obj;
}

export async function proxyToLaravel(
  request: NextRequest,
  laravelPath: string,
  options?: { method?: string }
): Promise<NextResponse> {
  const method = options?.method || request.method;
  const url = new URL(request.url);
  const queryString = url.searchParams.toString();
  const targetUrl = `${getApiBaseUrl()}${laravelPath}${queryString ? `?${queryString}` : ""}`;

  const headers: Record<string, string> = { Accept: "application/json" };
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    headers["Authorization"] = authHeader;
  } else {
    const tokenFromCookie = request.cookies.get(TOKEN_COOKIE_NAME)?.value;
    if (tokenFromCookie) {
      headers["Authorization"] = `Bearer ${tokenFromCookie}`;
    }
  }
  const contentType = request.headers.get("content-type");
  if (contentType) headers["Content-Type"] = contentType;

  const fetchOptions: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    if (contentType?.includes("multipart/form-data")) {
      // Keep boundary in Content-Type so Laravel can parse uploaded files.
      fetchOptions.body = await request.arrayBuffer();
      if (contentType) {
        headers["Content-Type"] = contentType;
      }
    } else if (
      method === "POST" &&
      !contentType &&
      laravelPath.includes("/upload")
    ) {
      const formData = await request.formData();
      const outbound = new FormData();
      for (const [key, value] of formData.entries()) {
        if (value instanceof Blob) {
          const name = value instanceof File ? value.name : "upload";
          outbound.append(key, value, name);
        } else {
          outbound.append(key, value);
        }
      }
      fetchOptions.body = outbound;
    } else {
      try {
        const body = await request.text();
        if (body) {
          try {
            const parsed = JSON.parse(body);
            const transformed = transformKeysToSnake(parsed);
            fetchOptions.body = JSON.stringify(transformed);
            headers["Content-Type"] = "application/json";
          } catch {
            fetchOptions.body = body;
          }
        }
      } catch { /* no body */ }
    }
  }

  try {
    const res = await fetch(targetUrl, { ...fetchOptions, cache: "no-store" });
    const data = await res.text();
    return new NextResponse(data, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "fetch failed";
    return NextResponse.json(
      {
        error: "API unavailable",
        hint: "Check API_URL / NEXT_PUBLIC_API_URL on Vercel and that the Cloudflare tunnel + php artisan serve are running.",
        apiBase: getApiBaseUrl(),
        detail: process.env.NODE_ENV === "production" ? undefined : message,
      },
      { status: 502 },
    );
  }
}
