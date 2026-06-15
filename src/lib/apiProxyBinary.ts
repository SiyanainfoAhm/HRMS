import { NextRequest, NextResponse } from "next/server";
import { TOKEN_COOKIE_NAME } from "@/lib/auth";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

export async function proxyBinaryToLaravel(
  request: NextRequest,
  laravelPath: string,
  options?: { method?: string },
): Promise<NextResponse> {
  const method = options?.method || request.method;
  const url = new URL(request.url);
  const queryString = url.searchParams.toString();
  const targetUrl = `${API_BASE}${laravelPath}${queryString ? `?${queryString}` : ""}`;

  const headers: Record<string, string> = {};
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
  const fetchOptions: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD" && contentType?.includes("multipart/form-data")) {
    fetchOptions.body = await request.arrayBuffer();
    headers["Content-Type"] = contentType;
  }

  try {
    const res = await fetch(targetUrl, fetchOptions);
    const body = await res.arrayBuffer();
    const outHeaders = new Headers();
    const ct = res.headers.get("content-type");
    if (ct) outHeaders.set("Content-Type", ct);
    const cd = res.headers.get("content-disposition");
    if (cd) outHeaders.set("Content-Disposition", cd);

    return new NextResponse(body, { status: res.status, headers: outHeaders });
  } catch {
    return NextResponse.json({ error: "API unavailable" }, { status: 502 });
  }
}
