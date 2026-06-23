import { NextRequest } from "next/server";
import { proxyToLaravel } from "@/lib/apiProxy";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return proxyToLaravel(request, "/company/me");
}

export async function PUT(request: NextRequest) {
  return proxyToLaravel(request, "/company/me");
}
