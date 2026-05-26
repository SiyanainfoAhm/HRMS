import { NextRequest } from "next/server";
import { proxyToLaravel } from "@/lib/apiProxy";

export async function GET(request: NextRequest) {
  return proxyToLaravel(request, "/payroll/payslips");
}

export async function POST(request: NextRequest) {
  return proxyToLaravel(request, "/payroll/payslips");
}
