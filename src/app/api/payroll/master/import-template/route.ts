import { NextRequest } from "next/server";
import { proxyBinaryToLaravel } from "@/lib/apiProxyBinary";

export async function GET(request: NextRequest) {
  return proxyBinaryToLaravel(request, "/payroll/master/import-template");
}
