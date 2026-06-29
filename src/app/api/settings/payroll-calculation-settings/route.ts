import { NextRequest } from "next/server";
import { proxyToLaravel } from "@/lib/apiProxy";

export async function GET(request: NextRequest) {
  return proxyToLaravel(request, "/settings/payroll-calculation-settings");
}

export async function PUT(request: NextRequest) {
  return proxyToLaravel(request, "/settings/payroll-calculation-settings");
}
