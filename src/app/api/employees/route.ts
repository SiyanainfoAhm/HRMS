import { NextRequest, NextResponse } from "next/server";
import { proxyToLaravel } from "@/lib/apiProxy";
import { TOKEN_COOKIE_NAME } from "@/lib/auth";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

function splitName(full: string): { first_name: string; last_name: string | null } {
  const parts = full.trim().split(/\s+/);
  const first_name = parts[0] || "";
  const last_name = parts.length > 1 ? parts.slice(1).join(" ") : null;
  return { first_name, last_name };
}

function transformEmployeeBody(body: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};

  if (body.name) {
    const { first_name, last_name } = splitName(body.name);
    out.first_name = first_name;
    if (last_name) out.last_name = last_name;
  }

  const mapping: Record<string, string> = {
    userId: "user_id",
    employeeCode: "employee_code",
    dateOfBirth: "date_of_birth",
    dateOfJoining: "date_of_joining",
    dateOfLeaving: "date_of_leaving",
    divisionId: "division_id",
    departmentId: "department_id",
    designationId: "designation_id",
    shiftId: "shift_id",
    managerId: "manager_id",
    roleId: "role_id",
    isActive: "is_active",
    addressLine1: "address_line1",
    addressLine2: "address_line2",
    currentAddressLine1: "current_address_line1",
    currentAddressLine2: "current_address_line2",
    currentCity: "current_city",
    currentState: "current_state",
    currentCountry: "current_country",
    currentPostalCode: "current_postal_code",
    permanentAddressLine1: "permanent_address_line1",
    permanentAddressLine2: "permanent_address_line2",
    permanentCity: "permanent_city",
    permanentState: "permanent_state",
    permanentCountry: "permanent_country",
    permanentPostalCode: "permanent_postal_code",
    emergencyContactName: "emergency_contact_name",
    emergencyContactPhone: "emergency_contact_phone",
    bankName: "bank_name",
    bankAccountNumber: "bank_account_number",
    bankIfsc: "bank_ifsc",
    grossBasic: "gross_salary",
    incomeTaxMonthly: "tds_monthly",
    governmentPayLevel: "government_pay_level",
    employmentStatus: "employment_status",
    uanNumber: "uan_number",
    pfNumber: "pf_number",
    cpfNumber: "cpf_number",
    requestedDocumentIds: "requested_document_ids",
  };

  for (const [camel, snake] of Object.entries(mapping)) {
    if (body[camel] !== undefined) out[snake] = body[camel];
  }

  const directFields = [
    "email", "phone", "gender", "designation", "aadhaar", "pan",
    "role", "password", "action",
  ];
  for (const f of directFields) {
    if (body[f] !== undefined) out[f] = body[f];
  }

  return out;
}

export async function GET(request: NextRequest) {
  return proxyToLaravel(request, "/employees");
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const transformed = transformEmployeeBody(body);
  const token = request.cookies.get(TOKEN_COOKIE_NAME)?.value;
  const authHeader = request.headers.get("authorization");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (authHeader) {
    headers["Authorization"] = authHeader;
  } else if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(`${API_BASE}/employees`, {
      method: "POST",
      headers,
      body: JSON.stringify(transformed),
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

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const transformed = transformEmployeeBody(body);
  const id = transformed.user_id || body.userId;
  const token = request.cookies.get(TOKEN_COOKIE_NAME)?.value;
  const authHeader = request.headers.get("authorization");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (authHeader) {
    headers["Authorization"] = authHeader;
  } else if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const url = id ? `${API_BASE}/employees/${id}` : `${API_BASE}/employees`;
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers,
      body: JSON.stringify(transformed),
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

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const transformed = transformEmployeeBody(body);
  const token = request.cookies.get(TOKEN_COOKIE_NAME)?.value;
  const authHeader = request.headers.get("authorization");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (authHeader) {
    headers["Authorization"] = authHeader;
  } else if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const id = transformed.user_id || body.userId;
  const url = id ? `${API_BASE}/employees/${id}` : `${API_BASE}/employees`;
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers,
      body: JSON.stringify(transformed),
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

export async function DELETE(request: NextRequest) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  return proxyToLaravel(request, `/employees/${userId}`);
}
