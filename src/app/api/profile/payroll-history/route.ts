import { NextRequest } from "next/server";
import { proxyToLaravel } from "@/lib/apiProxy";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  return proxyToLaravel(request, `/me/payroll-history${url.search}`);
}
