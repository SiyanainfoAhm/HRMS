import { NextRequest } from "next/server";
import { proxyToLaravel } from "@/lib/apiProxy";

export async function POST(request: NextRequest) {
  const body = await request.clone().json().catch(() => ({}));
  const id = body?.id;
  if (!id) {
    return Response.json({ error: "ID is required" }, { status: 400 });
  }
  return proxyToLaravel(request, `/settings/payroll-fields/${id}/deactivate`);
}
