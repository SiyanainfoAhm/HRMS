import { NextRequest } from "next/server";
import { proxyToLaravel } from "@/lib/apiProxy";

export async function GET(request: NextRequest) {
  // proxyToLaravel forwards the request query string itself. Appending it here
  // produced `active_only=0?active_only=0`, which Laravel treated as active-only.
  return proxyToLaravel(request, "/settings/payroll-fields");
}

export async function POST(request: NextRequest) {
  return proxyToLaravel(request, "/settings/payroll-fields");
}
