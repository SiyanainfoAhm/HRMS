import { NextRequest } from "next/server";
import { proxyToLaravel } from "@/lib/apiProxy";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  return proxyToLaravel(request, `/settings/electricity-tariffs/${id}/deactivate`);
}
