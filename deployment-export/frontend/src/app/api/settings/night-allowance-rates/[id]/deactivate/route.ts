import { proxyToLaravel } from "@/lib/apiProxy";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyToLaravel(request, `/settings/night-allowance-rates/${id}/deactivate`);
}
