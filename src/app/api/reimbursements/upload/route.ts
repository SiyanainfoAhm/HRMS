import { NextRequest, NextResponse } from "next/server";
import { TOKEN_COOKIE_NAME } from "@/lib/auth";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

/** Forward multipart uploads with a fresh FormData so Laravel receives the file field. */
export async function POST(request: NextRequest) {
  let inbound: FormData;
  try {
    inbound = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload request" }, { status: 400 });
  }

  const file = inbound.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json(
      {
        error: "Attachment file is required",
        message: "The file field is required.",
        errors: { file: ["The file field is required."] },
      },
      { status: 422 },
    );
  }

  const outbound = new FormData();
  const fileName = file instanceof File ? file.name : "attachment";
  outbound.append("file", file, fileName);

  const headers: Record<string, string> = { Accept: "application/json" };
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    headers["Authorization"] = authHeader;
  } else {
    const token = request.cookies.get(TOKEN_COOKIE_NAME)?.value;
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(`${API_BASE}/reimbursements/upload`, {
      method: "POST",
      headers,
      body: outbound,
    });
    const data = await res.text();
    return new NextResponse(data, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "API unavailable" }, { status: 502 });
  }
}
