import { NextRequest } from "next/server";
import { proxyToLaravel } from "@/lib/apiProxy";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return proxyToLaravel(request, `/settings/quarters/${id}/deactivate`);
}
