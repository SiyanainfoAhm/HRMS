import { NextRequest } from "next/server";
import { proxyToLaravel } from "@/lib/apiProxy";

/** Months with a generated/finalized run: the only months the TDS Data / Employee Payroll reports can use. */
export async function GET(request: NextRequest) {
  return proxyToLaravel(request, "/payroll/export-periods", { requireAdmin: true });
}
