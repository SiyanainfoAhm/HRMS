import { NextRequest, NextResponse } from "next/server";
import { proxyToLaravel } from "@/lib/apiProxy";
import { TOKEN_COOKIE_NAME } from "@/lib/auth";

import { getApiBaseUrl } from "@/lib/apiBase";

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
    bankAccountHolderName: "bank_account_holder_name",
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
    lastWorkingDate: "last_working_date",
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

  // Pass through payrollMaster as-is (object with snake_case keys already)
  if (body.payrollMaster !== undefined) {
    out.payroll_master = body.payrollMaster;
  }

  return out;
}

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function toYmd(val: any): string | null {
  if (!val) return null;
  const s = String(val);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : s;
}

function flattenEmployee(emp: any): any {
  if (!emp) return emp;
  const flat: any = { ...emp };

  if (emp.designation && typeof emp.designation === "object") {
    flat.designation = emp.designation.title || emp.designation.name || null;
    flat.designationId = emp.designation.id;
  }
  if (emp.department && typeof emp.department === "object") {
    flat.departmentName = emp.department.name || null;
    flat.departmentId = emp.department.id;
  }
  if (emp.division && typeof emp.division === "object") {
    flat.divisionName = emp.division.name || null;
    flat.divisionId = emp.division.id;
  }
  if (emp.shift && typeof emp.shift === "object") {
    flat.shiftName = emp.shift.name || null;
    flat.shiftId = emp.shift.id;
  }
  if (emp.role && typeof emp.role === "object") {
    flat.roleName = emp.role.name || emp.role.title || null;
    flat.roleId = emp.role.id;
  }
  if (emp.user && typeof emp.user === "object") {
    const u = emp.user;
    flat.name = flat.name || u.name || [emp.first_name, emp.last_name].filter(Boolean).join(" ") || null;
    flat.email = flat.email || u.email;
    flat.role = u.role;
    flat.employmentStatus = u.employment_status;
    flat.employeeCode = u.employee_code || emp.employee_code;
    flat.ctc = u.ctc ?? u.gross_salary ?? null;
    flat.phone = flat.phone || u.phone;
    flat.gender = u.gender || emp.gender;
    flat.dateOfBirth = toYmd(emp.date_of_birth || u.date_of_birth);
    flat.dateOfJoining = toYmd(emp.date_of_joining || u.date_of_joining);
    flat.dateOfLeaving = toYmd(emp.date_of_leaving || u.date_of_leaving);
    flat.createdAt = u.created_at;
    flat.aadhaar = u.aadhaar || emp.aadhaar;
    flat.pan = u.pan || emp.pan;
    flat.uanNumber = u.uan_number || emp.uan_number;
    flat.pfNumber = u.pf_number || emp.pf_number;
    flat.cpfNumber = u.cpf_number || emp.cpf_number;
    flat.governmentPayLevel = u.government_pay_level ?? emp.government_pay_level ?? null;
    flat.grossBasic = u.gross_salary ?? emp.gross_salary ?? null;
    flat.grossSalary = u.gross_salary ?? emp.gross_salary ?? null;
    flat.incomeTaxMonthly = u.tds_monthly ?? u.tds ?? emp.tds_monthly ?? null;
    flat.bankName = u.bank_name || emp.bank_name || null;
    flat.bankAccountHolderName = u.bank_account_holder_name || null;
    flat.bankAccountNumber = u.bank_account_number || emp.bank_account_number || null;
    flat.bankIfsc = u.bank_ifsc || emp.bank_ifsc || null;
    flat.currentAddressLine1 = u.current_address_line1 || emp.current_address_line1 || null;
    flat.currentAddressLine2 = u.current_address_line2 || emp.current_address_line2 || null;
    flat.currentCity = u.current_city || emp.current_city || null;
    flat.currentState = u.current_state || emp.current_state || null;
    flat.currentCountry = u.current_country || emp.current_country || null;
    flat.currentPostalCode = u.current_postal_code || emp.current_postal_code || null;
    flat.permanentAddressLine1 = u.permanent_address_line1 || emp.permanent_address_line1 || null;
    flat.permanentAddressLine2 = u.permanent_address_line2 || emp.permanent_address_line2 || null;
    flat.permanentCity = u.permanent_city || emp.permanent_city || null;
    flat.permanentState = u.permanent_state || emp.permanent_state || null;
    flat.permanentCountry = u.permanent_country || emp.permanent_country || null;
    flat.permanentPostalCode = u.permanent_postal_code || emp.permanent_postal_code || null;
    flat.emergencyContactName = u.emergency_contact_name || emp.emergency_contact_name || null;
    flat.emergencyContactPhone = u.emergency_contact_phone || emp.emergency_contact_phone || null;
  }

  if (emp.user_id) {
    flat.userId = emp.user_id;
  } else if (emp.user?.id) {
    flat.userId = emp.user.id;
  }

  if (!flat.name) {
    flat.name = [emp.first_name, emp.last_name].filter(Boolean).join(" ") || null;
  }
  if (!flat.employeeCode) flat.employeeCode = emp.employee_code;
  if (!flat.dateOfJoining) flat.dateOfJoining = toYmd(emp.date_of_joining);
  if (!flat.dateOfBirth) flat.dateOfBirth = toYmd(emp.date_of_birth);
  if (!flat.createdAt) flat.createdAt = emp.created_at;

  for (const key of Object.keys(flat)) {
    if (key.includes("_") && !key.startsWith("_")) {
      const camel = snakeToCamel(key);
      if (!(camel in flat)) flat[camel] = flat[key];
    }
  }

  return flat;
}

export async function GET(request: NextRequest) {
  const token = request.cookies.get(TOKEN_COOKIE_NAME)?.value;
  const authHeader = request.headers.get("authorization");
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");

  const headers: Record<string, string> = { Accept: "application/json" };
  if (authHeader) {
    headers["Authorization"] = authHeader;
  } else if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const targetUrl = userId
    ? `${getApiBaseUrl()}/employees/${userId}`
    : `${getApiBaseUrl()}/employees${url.searchParams.toString() ? `?${url.searchParams.toString()}` : ""}`;

  try {
    const res = await fetch(targetUrl, { headers, cache: "no-store" });
    if (!res.ok) {
      const data = await res.text();
      return new NextResponse(data, {
        status: res.status,
        headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
      });
    }
    const data = await res.json();

    if (data.employees && Array.isArray(data.employees)) {
      data.employees = data.employees.map(flattenEmployee);
    }
    if (data.employee) {
      data.employee = flattenEmployee(data.employee);
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "API unavailable" }, { status: 502 });
  }
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
    const res = await fetch(`${getApiBaseUrl()}/employees`, {
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

  const url = id ? `${getApiBaseUrl()}/employees/${id}` : `${getApiBaseUrl()}/employees`;
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
  const url = id ? `${getApiBaseUrl()}/employees/${id}` : `${getApiBaseUrl()}/employees`;
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

export async function DELETE(request: NextRequest) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  return proxyToLaravel(request, `/employees/${userId}`);
}
