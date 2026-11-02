import { NextRequest } from "next/server";
import { proxyToLaravel } from "@/lib/apiProxy";

/** Months with generated payroll (the only months a Post Payroll report can be built for). */
export async function GET(request: NextRequest) {
  return proxyToLaravel(request, "/payroll/post-downloads-months", { requireAdmin: true });
}
