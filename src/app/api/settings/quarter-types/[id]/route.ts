import { NextRequest } from "next/server";
import { proxyToLaravel } from "@/lib/apiProxy";

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return proxyToLaravel(request, `/settings/quarter-types/${id}`);
}
