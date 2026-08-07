import { NextRequest, NextResponse } from "next/server";
import { TOKEN_COOKIE_NAME } from "@/lib/auth";
import { enrichPayslipsWithLeave } from "@/lib/enrichPayslipsWithLeave";
import { proxyToLaravel } from "@/lib/apiProxy";

export async function GET(request: NextRequest) {
  const res = await proxyToLaravel(request, "/payslips/employee");
  const text = await res.text();
  let data: { payslips?: unknown[]; user?: { id?: string } };
  try {
    data = JSON.parse(text);
  } catch {
    return new NextResponse(text, { status: res.status, headers: res.headers });
  }
  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  const url = new URL(request.url);
  const employeeUserId =
    url.searchParams.get("user_id") ??
    url.searchParams.get("employeeUserId") ??
    data.user?.id ??
    "";

  const token = request.cookies.get(TOKEN_COOKIE_NAME)?.value;
  const authHeader = request.headers.get("authorization") ?? (token ? `Bearer ${token}` : null);
  if (!employeeUserId || !authHeader) {
    return NextResponse.json(data);
  }

  const enriched = await enrichPayslipsWithLeave(data as any, employeeUserId, authHeader);
  return NextResponse.json(enriched);
}
