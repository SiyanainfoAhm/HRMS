import { NextRequest } from "next/server";
import { proxyToLaravel } from "@/lib/apiProxy";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyToLaravel(request, `/reimbursements/${id}`);
}
