import { NextRequest } from "next/server";
import { proxyToLaravel } from "@/lib/apiProxy";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return proxyToLaravel(request, `/settings/quarters/${id}`);
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const url = new URL(request.url);
  const action = url.pathname.split("/").pop();
  if (action === "assign") return proxyToLaravel(request, `/settings/quarters/${id}/assign`);
  if (action === "unassign") return proxyToLaravel(request, `/settings/quarters/${id}/unassign`);
  if (action === "deactivate") return proxyToLaravel(request, `/settings/quarters/${id}/deactivate`);
  return proxyToLaravel(request, `/settings/quarters/${id}`);
}
