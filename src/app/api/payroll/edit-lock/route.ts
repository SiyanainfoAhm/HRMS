import { NextRequest } from "next/server";
import { proxyToLaravel } from "@/lib/apiProxy";

export async function POST(request: NextRequest) {
  const data = await request.json().catch(() => ({}));
  const action = data.action;
  if (action !== "acquire" && action !== "heartbeat" && action !== "release") {
    return Response.json({ error: "Invalid lock action" }, { status: 400 });
  }
  const body = JSON.stringify(data);
  const bridged = new NextRequest(request.url, { method: "POST", headers: { "Content-Type": "application/json", cookie: request.headers.get("cookie") ?? "" }, body });
  return proxyToLaravel(bridged, `/payroll/edit-lock/${action}`, { requireAdmin: true });
}
