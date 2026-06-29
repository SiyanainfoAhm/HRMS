import { NextRequest } from "next/server";
import { proxyToLaravel } from "@/lib/apiProxy";

export async function PUT(request: NextRequest) {
  return proxyToLaravel(request, "/me/payroll-master/cpf-settings");
}
