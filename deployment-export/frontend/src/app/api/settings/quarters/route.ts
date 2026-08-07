import { NextRequest } from "next/server";
import { proxyToLaravel } from "@/lib/apiProxy";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  return proxyToLaravel(request, `/settings/quarters${url.search}`);
}

export async function POST(request: NextRequest) {
  return proxyToLaravel(request, "/settings/quarters");
}
