import { NextRequest } from "next/server";
import { proxyBinaryToLaravel } from "@/lib/apiProxyBinary";

export async function POST(request: NextRequest) {
  return proxyBinaryToLaravel(request, "/payroll/bank-letter", {
    method: "POST",
    requireAdmin: true,
  });
}
