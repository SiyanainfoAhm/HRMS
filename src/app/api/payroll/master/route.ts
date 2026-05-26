import { NextRequest } from "next/server";
import { proxyToLaravel } from "@/lib/apiProxy";

export async function GET(request: NextRequest) {
  return proxyToLaravel(request, "/payroll/master");
}

export async function PATCH(request: NextRequest) {
  return proxyToLaravel(request, "/payroll/master");
}
