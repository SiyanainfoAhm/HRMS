import { NextRequest, NextResponse } from "next/server";
import { TOKEN_COOKIE_NAME } from "@/lib/auth";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

export async function proxyToLaravel(
  request: NextRequest,
  laravelPath: string,
  options?: { method?: string }
): Promise<NextResponse> {
  const method = options?.method || request.method;
  const url = new URL(request.url);
  const queryString = url.searchParams.toString();
  const targetUrl = `${API_BASE}${laravelPath}${queryString ? `?${queryString}` : ""}`;

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
      delete headers["Content-Type"];
      fetchOptions.body = await request.arrayBuffer();
    } else {
      try {
        const body = await request.text();
        if (body) fetchOptions.body = body;
      } catch { /* no body */ }
    }
  }

  try {
    const res = await fetch(targetUrl, fetchOptions);
    const data = await res.text();
    return new NextResponse(data, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "API unavailable" }, { status: 502 });
  }
}
