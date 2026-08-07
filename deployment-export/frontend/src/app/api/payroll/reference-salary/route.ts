import { NextRequest } from "next/server";
import { proxyToLaravel } from "@/lib/apiProxy";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.search;
  return proxyToLaravel(request, `/payroll/reference-salary${query}`);
}
