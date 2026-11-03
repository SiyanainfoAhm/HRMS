import { NextRequest } from "next/server";
import { proxyToLaravel } from "@/lib/apiProxy";

/** On-screen preview of the multi-period TDS Data / Employee Payroll report. */
export async function GET(request: NextRequest, context: { params: Promise<{ type: string }> }) {
  const { type } = await context.params;
  const url = new URL(request.url);
  return proxyToLaravel(request, `/payroll/period-report/${encodeURIComponent(type)}${url.search}`, { requireAdmin: true });
}
