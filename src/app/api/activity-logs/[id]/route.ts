import { NextRequest } from "next/server";
import { proxyToLaravel } from "@/lib/apiProxy";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyToLaravel(request, `/activity-logs/${encodeURIComponent(id)}`, { requireAdmin: true });
}
