import { proxyToLaravel } from "@/lib/apiProxy";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  return proxyToLaravel(request, `/settings/night-allowance-rates${url.search}`);
}

export async function POST(request: NextRequest) {
  return proxyToLaravel(request, "/settings/night-allowance-rates");
}
