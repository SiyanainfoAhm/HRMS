import { NextRequest, NextResponse } from "next/server";
import { proxyToLaravel } from "@/lib/apiProxy";

export async function GET(request: NextRequest) {
  return proxyToLaravel(request, "/settings/divisions");
}

export async function POST(request: NextRequest) {
  return proxyToLaravel(request, "/settings/divisions");
}

export async function PUT(request: NextRequest) {
  const body = await request.clone().json().catch(() => ({}));
  const id = body?.id;
  if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });
  return proxyToLaravel(request, `/settings/divisions/${id}`);
}

export async function PATCH(request: NextRequest) {
  const body = await request.clone().json().catch(() => ({}));
  const id = body?.id;
  if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });
  return proxyToLaravel(request, `/settings/divisions/${id}`);
}

export async function DELETE(request: NextRequest) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });
  return proxyToLaravel(request, `/settings/divisions/${id}`);
}
