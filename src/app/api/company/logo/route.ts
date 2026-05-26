import { NextRequest } from "next/server";
import { proxyToLaravel } from "@/lib/apiProxy";

export async function POST(request: NextRequest) {
  return proxyToLaravel(request, "/company/logo");
}

export async function DELETE(request: NextRequest) {
  return proxyToLaravel(request, "/company/logo");
}
