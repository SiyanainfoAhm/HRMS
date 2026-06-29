import { NextRequest } from "next/server";
import { proxyToLaravel } from "@/lib/apiProxy";

export async function POST(request: NextRequest) {
  return proxyToLaravel(request, "/settings/salary-increment/apply");
}
