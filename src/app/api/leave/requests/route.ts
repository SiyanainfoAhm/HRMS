import { NextRequest, NextResponse } from "next/server";
import { proxyToLaravel } from "@/lib/apiProxy";
import { TOKEN_COOKIE_NAME } from "@/lib/auth";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

export async function GET(request: NextRequest) {
  return proxyToLaravel(request, "/leave/requests");
}

export async function POST(request: NextRequest) {
  return proxyToLaravel(request, "/leave/requests");
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const id = body.id;
  if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });

  const actionMap: Record<string, string> = {
    approve: "approved",
    reject: "rejected",
    cancel: "cancelled",
  };

  const payload: Record<string, any> = {};
  if (body.action && actionMap[body.action]) {
    payload.status = actionMap[body.action];
  } else if (body.action) {
    payload.status = body.action;
  }
  if (body.rejectionReason || body.rejection_reason) {
    payload.rejection_reason = body.rejectionReason || body.rejection_reason;
  }

  const token = request.cookies.get(TOKEN_COOKIE_NAME)?.value;
  const authHeader = request.headers.get("authorization");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (authHeader) headers["Authorization"] = authHeader;
  else if (token) headers["Authorization"] = `Bearer ${token}`;

  try {
    const res = await fetch(`${API_BASE}/leave/requests/${id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(payload),
    });
    const data = await res.text();
    return new NextResponse(data, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "API unavailable" }, { status: 502 });
  }
}
