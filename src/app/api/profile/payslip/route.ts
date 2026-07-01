import { NextRequest } from "next/server";
import { TOKEN_COOKIE_NAME } from "@/lib/auth";
import { enrichPayslipsWithLeave } from "@/lib/enrichPayslipsWithLeave";
import { NextResponse } from "next/server";
import { proxyToLaravel } from "@/lib/apiProxy";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const res = await proxyToLaravel(request, `/me/payslip${url.search}`);
  const text = await res.text();
  let data: { payslip?: unknown; user?: { id?: string }; company?: unknown };
  try {
    data = JSON.parse(text);
  } catch {
    return new NextResponse(text, { status: res.status, headers: res.headers });
  }
  if (!res.ok || !data.payslip) {
    return NextResponse.json(data, { status: res.status });
  }

  const token = request.cookies.get(TOKEN_COOKIE_NAME)?.value;
  const authHeader = request.headers.get("authorization") ?? (token ? `Bearer ${token}` : null);
  const userId = data.user?.id;
  if (!userId || !authHeader) {
    return NextResponse.json(data);
  }

  const enriched = await enrichPayslipsWithLeave(
    { payslips: [data.payslip], user: data.user, company: data.company } as Parameters<
      typeof enrichPayslipsWithLeave
    >[0],
    userId,
    authHeader,
  );
  return NextResponse.json({
    ...data,
    payslip: enriched.payslips?.[0] ?? data.payslip,
  });
}
