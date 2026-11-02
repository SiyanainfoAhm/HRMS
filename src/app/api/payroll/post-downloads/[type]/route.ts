import { NextRequest } from "next/server";
import { proxyBinaryToLaravel } from "@/lib/apiProxyBinary";

export async function GET(request: NextRequest, context: { params: Promise<{ type: string }> }) {
  const { type } = await context.params;
  return proxyBinaryToLaravel(request, `/payroll/post-downloads/${encodeURIComponent(type)}`, { requireAdmin: true });
}
