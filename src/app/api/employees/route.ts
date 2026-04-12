import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME } from "@/lib/auth";
import { getValidatedSession } from "@/lib/authValidate";
import { supabase } from "@/lib/supabaseClient";
import {
  computeGovernmentMonthlyPayroll,
  deriveTransportSlabFromLevel,
  masterRowToDeductionDefaults,
} from "@/lib/governmentPayroll";
import {
  normalizeDigits,
  validateEmailField,
  validateIndianMobileDigits,
  validateAadhaarDigits,
  validatePanNormalized,
} from "@/lib/employeeValidators";
import bcrypt from "bcryptjs";

function isManagerial(role: string): boolean {
  return role === "super_admin" || role === "admin" || role === "hr";
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function ymdOrNull(input: unknown): string | null {
  const s = typeof input === "string" ? input.slice(0, 10) : "";
  return isYmd(s) ? s : null;
}

function mapRow(row: any, lookups?: {
  designationById: Map<string, { title: string }>;
  departmentById: Map<string, { name: string }>;
  divisionById: Map<string, { name: string }>;
  shiftById: Map<string, { name: string }>;
}) {
  let ctc: number | null = row.ctc != null ? Number(row.ctc) : null;
  const govLevel = row.government_pay_level != null ? Number(row.government_pay_level) : null;
  const grossBasic = row.gross_salary != null ? Number(row.gross_salary) : null;
  if (
    ctc == null &&
    govLevel != null &&
    Number.isFinite(govLevel) &&
    govLevel >= 1 &&
    grossBasic != null &&
    grossBasic > 0
  ) {
    try {
      const preview = computeGovernmentMonthlyPayroll({
        grossBasic,
        daPercent: 53,
        hraPercent: 30,
        medicalFixed: 3000,
        transportDaPercent: 48.06,
        payLevel: govLevel,
        daysInMonth: 30,
        unpaidDays: 0,
        deductionDefaults: masterRowToDeductionDefaults({
          income_tax_default: row.tds_monthly ?? 0,
          tds: row.tds_monthly ?? 0,
          pt_default: 200,
        }),
      });
      ctc = preview.totalEarnings;
    } catch {
      ctc = grossBasic;
    }
  }
  const designationTitle = lookups?.designationById?.get(row.designation_id)?.title ?? row.designation ?? "";
  const departmentName = lookups?.departmentById?.get(row.department_id)?.name ?? "";
  const divisionName = lookups?.divisionById?.get(row.division_id)?.name ?? "";
  const shiftName = lookups?.shiftById?.get(row.shift_id)?.name ?? "";
  return {
    id: row.id as string,
    email: row.email as string,
    name: (row.name ?? null) as string | null,
    role: row.role as "super_admin" | "admin" | "hr" | "manager" | "employee",
    employmentStatus: (row.employment_status ?? "preboarding") as "preboarding" | "current" | "past",
    employeeCode: (row.employee_code ?? "") as string,
    phone: (row.phone ?? "") as string,
    dateOfJoining: row.date_of_joining ? String(row.date_of_joining) : "",
    dateOfLeaving: row.date_of_leaving ? String(row.date_of_leaving) : "",
    ctc,
    createdAt: new Date(row.created_at).toISOString(),
    designation: designationTitle,
    governmentPayLevel: row.government_pay_level != null ? Number(row.government_pay_level) : null,
    designationId: row.designation_id ?? null,
    departmentId: row.department_id ?? null,
    departmentName: departmentName || null,
    divisionId: row.division_id ?? null,
    divisionName: divisionName || null,
    shiftId: row.shift_id ?? null,
    shiftName: shiftName || null,
  };
}

const PREBOARDING_DOC_DONE = new Set(["submitted", "signed", "approved"]);

/** Latest pending invite per user; mandatory requested docs all have a done submission on that invite. */
async function preboardingDocsCompleteByUserId(
  companyId: string,
  userIds: string[],
  supabaseClient: typeof supabase,
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  for (const id of userIds) result.set(id, false);
  if (!userIds.length) return result;

  const { data: invites, error: invErr } = await supabaseClient
    .from("HRMS_employee_invites")
    .select("id, user_id, requested_document_ids, created_at")
    .eq("company_id", companyId)
    .eq("status", "pending")
    .in("user_id", userIds)
    .order("created_at", { ascending: false });
  if (invErr || !invites?.length) return result;

  const latestPendingByUser = new Map<string, { id: string; requested_document_ids: unknown }>();
  for (const inv of invites) {
    const uid = inv.user_id as string;
    if (!latestPendingByUser.has(uid)) {
      latestPendingByUser.set(uid, { id: inv.id as string, requested_document_ids: inv.requested_document_ids });
    }
  }

  const inviteIds = [...latestPendingByUser.values()].map((v) => v.id);
  const { data: subs } = await supabaseClient
    .from("HRMS_employee_document_submissions")
    .select("invite_id, document_id, status")
    .in("invite_id", inviteIds);

  const { data: allDocs, error: docErr } = await supabaseClient
    .from("HRMS_company_documents")
    .select("id, is_mandatory")
    .eq("company_id", companyId);
  if (docErr) return result;

  const subsByInvite = new Map<string, { document_id: string; status: string }[]>();
  for (const s of subs ?? []) {
    const iid = s.invite_id as string;
    if (!subsByInvite.has(iid)) subsByInvite.set(iid, []);
    subsByInvite.get(iid)!.push({ document_id: s.document_id as string, status: String(s.status) });
  }

  for (const uid of userIds) {
    const inv = latestPendingByUser.get(uid);
    if (!inv) continue;

    const requestedIds = Array.isArray(inv.requested_document_ids)
      ? (inv.requested_document_ids as unknown[]).filter((x): x is string => typeof x === "string")
      : null;

    let docScope = (allDocs ?? []) as { id: string; is_mandatory: boolean }[];
    if (requestedIds?.length) {
      const allow = new Set(requestedIds);
      docScope = docScope.filter((d) => allow.has(d.id));
    }

    const mandatoryIds = docScope.filter((d) => d.is_mandatory).map((d) => d.id);
    if (mandatoryIds.length === 0) {
      result.set(uid, true);
      continue;
    }

    const inviteSubs = subsByInvite.get(inv.id) ?? [];
    const done = new Set(
      inviteSubs.filter((s) => PREBOARDING_DOC_DONE.has(s.status)).map((s) => s.document_id),
    );
    result.set(uid, mandatoryIds.every((mid) => done.has(mid)));
  }

  return result;
}

function randomEmployeeCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "EMP-";
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

async function generateUniqueEmployeeCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomEmployeeCode();
    const { data, error } = await supabase.from("HRMS_users").select("id").eq("employee_code", code).maybeSingle();
    if (error) throw error;
    if (!data) return code;
  }
  return `EMP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const session = await getValidatedSession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Only allow super_admin/admin/hr to view full directory
  if (!isManagerial(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Find current user's company
  const { data: me, error: meErr } = await supabase
    .from("HRMS_users")
    .select("company_id")
    .eq("id", session.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });
  if (!me?.company_id) {
    return NextResponse.json({ employees: [], total: 0, page: 1, pageSize: 25 });
  }

  const companyId = me.company_id;

  const { searchParams } = new URL(request.url);
  const userIdParam = searchParams.get("userId");
  if (userIdParam) {
    const { data: u, error: uErr } = await supabase
      .from("HRMS_users")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", userIdParam)
      .maybeSingle();
    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 400 });
    if (!u) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    if (u.role === "super_admin") return NextResponse.json({ error: "Not allowed" }, { status: 403 });

    const { data: master, error: mErr } = await supabase
      .from("HRMS_payroll_master")
      .select("tds")
      .eq("company_id", companyId)
      .eq("employee_user_id", userIdParam)
      .is("effective_end_date", null)
      .order("effective_start_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (mErr) return NextResponse.json({ error: mErr.message }, { status: 400 });

    return NextResponse.json({
      employee: {
        id: u.id,
        email: u.email ?? "",
        name: u.name ?? "",
        role: u.role ?? "employee",
        employmentStatus: u.employment_status ?? "preboarding",
        employeeCode: u.employee_code ?? "",
        phone: u.phone ?? "",
        dateOfBirth: u.date_of_birth ? String(u.date_of_birth).slice(0, 10) : "",
        dateOfJoining: u.date_of_joining ? String(u.date_of_joining).slice(0, 10) : "",
        gender: u.gender ?? "",
        designation: u.designation ?? "",
        designationId: u.designation_id ?? "",
        departmentId: u.department_id ?? "",
        divisionId: u.division_id ?? "",
        shiftId: u.shift_id ?? "",
        aadhaar: u.aadhaar ?? "",
        pan: u.pan ?? "",
        uanNumber: u.uan_number ?? "",
        pfNumber: u.pf_number ?? "",
        esicNumber: u.esic_number ?? "",
        governmentPayLevel: u.government_pay_level != null ? Number(u.government_pay_level) : null,
        grossBasic: u.gross_salary != null ? Number(u.gross_salary) : null,
        cpfNumber: u.cpf_number ?? "",
        currentAddressLine1: u.current_address_line1 ?? "",
        currentAddressLine2: u.current_address_line2 ?? "",
        currentCity: u.current_city ?? "",
        currentState: u.current_state ?? "",
        currentCountry: u.current_country ?? "",
        currentPostalCode: u.current_postal_code ?? "",
        permanentAddressLine1: u.permanent_address_line1 ?? "",
        permanentAddressLine2: u.permanent_address_line2 ?? "",
        permanentCity: u.permanent_city ?? "",
        permanentState: u.permanent_state ?? "",
        permanentCountry: u.permanent_country ?? "",
        permanentPostalCode: u.permanent_postal_code ?? "",
        emergencyContactName: u.emergency_contact_name ?? "",
        emergencyContactPhone: u.emergency_contact_phone ?? "",
        bankName: u.bank_name ?? "",
        bankAccountNumber: u.bank_account_number ?? "",
        bankIfsc: u.bank_ifsc ?? "",
        grossSalary: u.gross_salary ?? null,
        incomeTaxMonthly: u.tds_monthly ?? 0,
        tds: master?.tds ?? u.tds_monthly ?? 0,
        pfEligible: Boolean(u.pf_eligible),
        esicEligible: Boolean(u.esic_eligible),
      },
    });
  }
  const paginated = searchParams.has("page");

  function buildBaseQuery() {
    let q = paginated
      ? supabase.from("HRMS_users").select("*", { count: "exact" })
      : supabase.from("HRMS_users").select("*");
    q = q
      .eq("company_id", companyId)
      .neq("role", "super_admin")
      .order("created_at", { ascending: false });
    if (paginated) {
      const statusFilter = searchParams.get("employmentStatus");
      if (statusFilter === "preboarding" || statusFilter === "current") {
        q = q.eq("employment_status", statusFilter);
      } else if (statusFilter === "past") {
        // Past tab includes:
        // - past employees
        // - "on notice" employees (current + future date_of_leaving)
        q = q.or("employment_status.eq.past,and(employment_status.eq.current,date_of_leaving.not.is.null)");
      }
    }
    return q;
  }

  let data: any[] | null;
  let error: any;
  let count: number | null = null;

  if (paginated) {
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const rawSize = parseInt(searchParams.get("pageSize") || "25", 10) || 25;
    const pageSize = Math.min(100, Math.max(1, rawSize));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const res = await buildBaseQuery().range(from, to);
    data = res.data;
    error = res.error;
    count = res.count ?? null;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const rows = data ?? [];

    // If requesting past tab, auto-offboard any "on notice" employees whose last working date is today or earlier.
    const employmentStatusParam = searchParams.get("employmentStatus");
    if (employmentStatusParam === "past" && rows.length) {
      const today = todayYmd();
      const toOffboard = rows
        .filter((r: any) => r.employment_status === "current")
        .map((r: any) => ({ id: r.id as string, dol: ymdOrNull(r.date_of_leaving) }))
        .filter((x) => x.dol && x.dol <= today)
        .map((x) => x.id);
      if (toOffboard.length) {
        try {
          await supabase
            .from("HRMS_users")
            .update({ employment_status: "past", updated_at: new Date().toISOString() })
            .eq("company_id", companyId)
            .in("id", toOffboard);
          await supabase
            .from("HRMS_employees")
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq("company_id", companyId)
            .in("user_id", toOffboard);
          for (const r of rows) {
            if (toOffboard.includes(r.id)) r.employment_status = "past";
          }
        } catch {
          // best-effort
        }
      }
    }

    const designationIds = [...new Set(rows.map((r: any) => r.designation_id).filter(Boolean))];
    const departmentIds = [...new Set(rows.map((r: any) => r.department_id).filter(Boolean))];
    const divisionIds = [...new Set(rows.map((r: any) => r.division_id).filter(Boolean))];
    const shiftIds = [...new Set(rows.map((r: any) => r.shift_id).filter(Boolean))];

    const [designationsRes, departmentsRes, divisionsRes, shiftsRes] = await Promise.all([
      designationIds.length ? supabase.from("HRMS_designations").select("id, title").in("id", designationIds) : { data: [] },
      departmentIds.length ? supabase.from("HRMS_departments").select("id, name").in("id", departmentIds) : { data: [] },
      divisionIds.length ? supabase.from("HRMS_divisions").select("id, name").in("id", divisionIds) : { data: [] },
      shiftIds.length ? supabase.from("HRMS_shifts").select("id, name").in("id", shiftIds) : { data: [] },
    ]);

    const designationById = new Map((designationsRes.data ?? []).map((d: any) => [d.id, { title: d.title }]));
    const departmentById = new Map((departmentsRes.data ?? []).map((d: any) => [d.id, { name: d.name }]));
    const divisionById = new Map((divisionsRes.data ?? []).map((d: any) => [d.id, { name: d.name }]));
    const shiftById = new Map((shiftsRes.data ?? []).map((d: any) => [d.id, { name: d.name }]));
    const lookups = { designationById, departmentById, divisionById, shiftById };

    let preboardingComplete: Map<string, boolean> | null = null;
    if (employmentStatusParam === "preboarding" && rows.length) {
      preboardingComplete = await preboardingDocsCompleteByUserId(
        companyId,
        rows.map((r: any) => r.id as string),
        supabase,
      );
    }

    return NextResponse.json({
      employees: rows.map((r: any) => {
        const base = mapRow(r, lookups);
        if (preboardingComplete) {
          return { ...base, preboardingDocsComplete: preboardingComplete.get(r.id) ?? false };
        }
        return base;
      }),
      total: count ?? 0,
      page,
      pageSize,
    });
  }

  const res = await buildBaseQuery();
  data = res.data;
  error = res.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const rows = data ?? [];
  const designationIds = [...new Set(rows.map((r: any) => r.designation_id).filter(Boolean))];
  const departmentIds = [...new Set(rows.map((r: any) => r.department_id).filter(Boolean))];
  const divisionIds = [...new Set(rows.map((r: any) => r.division_id).filter(Boolean))];
  const shiftIds = [...new Set(rows.map((r: any) => r.shift_id).filter(Boolean))];

  const [designationsRes, departmentsRes, divisionsRes, shiftsRes] = await Promise.all([
    designationIds.length ? supabase.from("HRMS_designations").select("id, title").in("id", designationIds) : { data: [] },
    departmentIds.length ? supabase.from("HRMS_departments").select("id, name").in("id", departmentIds) : { data: [] },
    divisionIds.length ? supabase.from("HRMS_divisions").select("id, name").in("id", divisionIds) : { data: [] },
    shiftIds.length ? supabase.from("HRMS_shifts").select("id, name").in("id", shiftIds) : { data: [] },
  ]);

  const designationById = new Map((designationsRes.data ?? []).map((d: any) => [d.id, { title: d.title }]));
  const departmentById = new Map((departmentsRes.data ?? []).map((d: any) => [d.id, { name: d.name }]));
  const divisionById = new Map((divisionsRes.data ?? []).map((d: any) => [d.id, { name: d.name }]));
  const shiftById = new Map((shiftsRes.data ?? []).map((d: any) => [d.id, { name: d.name }]));
  const lookups = { designationById, departmentById, divisionById, shiftById };

  return NextResponse.json({ employees: rows.map((r: any) => mapRow(r, lookups)) });
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const session = await getValidatedSession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isManagerial(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : undefined;
  const role = body?.role as string | undefined;
  const plainPassword = typeof body?.password === "string" ? body.password.trim() : "";
  const employeeCode = typeof body?.employeeCode === "string" ? body.employeeCode.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const dateOfBirth = typeof body?.dateOfBirth === "string" ? body.dateOfBirth.trim() : "";
  const dateOfJoining = typeof body?.dateOfJoining === "string" ? body.dateOfJoining.trim() : "";
  const employmentStatus = typeof body?.employmentStatus === "string" ? body.employmentStatus : "";
  const currentAddressLine1 = typeof body?.currentAddressLine1 === "string" ? body.currentAddressLine1.trim() : "";
  const currentAddressLine2 = typeof body?.currentAddressLine2 === "string" ? body.currentAddressLine2.trim() : "";
  const currentCity = typeof body?.currentCity === "string" ? body.currentCity.trim() : "";
  const currentState = typeof body?.currentState === "string" ? body.currentState.trim() : "";
  const currentCountry = typeof body?.currentCountry === "string" ? body.currentCountry.trim() : "";
  const currentPostalCode = typeof body?.currentPostalCode === "string" ? body.currentPostalCode.trim() : "";
  const permanentAddressLine1 =
    typeof body?.permanentAddressLine1 === "string" ? body.permanentAddressLine1.trim() : "";
  const permanentAddressLine2 =
    typeof body?.permanentAddressLine2 === "string" ? body.permanentAddressLine2.trim() : "";
  const permanentCity = typeof body?.permanentCity === "string" ? body.permanentCity.trim() : "";
  const permanentState = typeof body?.permanentState === "string" ? body.permanentState.trim() : "";
  const permanentCountry = typeof body?.permanentCountry === "string" ? body.permanentCountry.trim() : "";
  const permanentPostalCode =
    typeof body?.permanentPostalCode === "string" ? body.permanentPostalCode.trim() : "";
  const emergencyContactName =
    typeof body?.emergencyContactName === "string" ? body.emergencyContactName.trim() : "";
  const emergencyContactPhone =
    typeof body?.emergencyContactPhone === "string" ? body.emergencyContactPhone.trim() : "";
  const bankName = typeof body?.bankName === "string" ? body.bankName.trim() : "";
  const bankAccountNumber =
    typeof body?.bankAccountNumber === "string" ? body.bankAccountNumber.trim() : "";
  const bankIfsc = typeof body?.bankIfsc === "string" ? body.bankIfsc.trim() : "";
  const grossBasicRaw = body?.grossBasic ?? body?.grossSalary;
  const grossBasic =
    grossBasicRaw != null && grossBasicRaw !== "" ? Number(grossBasicRaw) : NaN;
  const incomeTaxRaw = body?.incomeTaxMonthly ?? body?.tds;
  const incomeTaxVal =
    incomeTaxRaw != null && incomeTaxRaw !== "" ? Math.max(0, Number(incomeTaxRaw)) : 0;
  const cpfNumber = typeof body?.cpfNumber === "string" ? body.cpfNumber.trim() || null : null;
  const allowedGenders = ["male", "female", "other"];
  const gender = allowedGenders.includes(body?.gender) ? body.gender : null;
  const designationId = typeof body?.designationId === "string" ? body.designationId.trim() || null : null;
  const designation = typeof body?.designation === "string" ? body.designation.trim() || null : null;
  const departmentId = typeof body?.departmentId === "string" ? body.departmentId.trim() || null : null;
  const divisionId = typeof body?.divisionId === "string" ? body.divisionId.trim() || null : null;
  const shiftId = typeof body?.shiftId === "string" ? body.shiftId.trim() || null : null;
  const uanNumber = typeof body?.uanNumber === "string" ? body.uanNumber.trim() || null : null;
  const pfNumber = typeof body?.pfNumber === "string" ? body.pfNumber.trim() || null : null;
  const esicNumber = typeof body?.esicNumber === "string" ? body.esicNumber.trim() || null : null;
  const governmentPayLevelRawPost = body?.governmentPayLevel;
  const governmentPayLevelPost =
    governmentPayLevelRawPost != null && governmentPayLevelRawPost !== ""
      ? Math.floor(Number(governmentPayLevelRawPost))
      : NaN;
  const requestedDocumentIds = Array.isArray(body?.requestedDocumentIds)
    ? body.requestedDocumentIds.filter((x: any) => typeof x === "string")
    : null;

  const emailFieldErr = validateEmailField(email);
  if (emailFieldErr) return NextResponse.json({ error: emailFieldErr }, { status: 400 });

  const phoneDigits = normalizeDigits(phone);
  const phoneErr = validateIndianMobileDigits(phoneDigits);
  if (phoneErr) return NextResponse.json({ error: phoneErr }, { status: 400 });

  const aadhaarDigits = normalizeDigits(typeof body?.aadhaar === "string" ? body.aadhaar : "");
  const aadhaarErr = validateAadhaarDigits(aadhaarDigits);
  if (aadhaarErr) return NextResponse.json({ error: aadhaarErr }, { status: 400 });

  const panNormalized = (typeof body?.pan === "string" ? body.pan : "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const panErr = validatePanNormalized(panNormalized);
  if (panErr) return NextResponse.json({ error: panErr }, { status: 400 });

  if (!designation?.trim()) return NextResponse.json({ error: "Designation is required" }, { status: 400 });
  if (!departmentId) return NextResponse.json({ error: "Department is required" }, { status: 400 });
  if (!divisionId) return NextResponse.json({ error: "Division is required" }, { status: 400 });
  if (!shiftId) return NextResponse.json({ error: "Shift is required" }, { status: 400 });
  if (!Number.isFinite(governmentPayLevelPost) || governmentPayLevelPost < 1) {
    return NextResponse.json({ error: "Government pay level is required (whole number ≥ 1)" }, { status: 400 });
  }
  if (!Number.isFinite(grossBasic) || grossBasic <= 0) {
    return NextResponse.json({ error: "Monthly gross basic pay is required" }, { status: 400 });
  }
  const allowedRoles = ["admin", "hr", "manager", "employee"];
  const finalRole = allowedRoles.includes(role || "") ? (role as any) : "employee";
  const allowedStatus = ["preboarding", "current", "past"];
  const requestedStatus = allowedStatus.includes(employmentStatus) ? (employmentStatus as any) : "preboarding";

  // Get company of current user
  const { data: me, error: meErr } = await supabase
    .from("HRMS_users")
    .select("company_id")
    .eq("id", session.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });
  if (!me?.company_id) return NextResponse.json({ error: "User not linked to company" }, { status: 400 });

  // Check existing
  const { data: existing, error: existErr } = await supabase
    .from("HRMS_users")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existErr) return NextResponse.json({ error: existErr.message }, { status: 400 });
  if (existing) return NextResponse.json({ error: "Email already registered" }, { status: 400 });

  const passwordToUse =
    plainPassword ||
    Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8); // 12+ chars
  const password_hash = await bcrypt.hash(passwordToUse, 10);

  const finalEmployeeCode = employeeCode || (await generateUniqueEmployeeCode());

  const dedDefaults = masterRowToDeductionDefaults({
    income_tax_default: incomeTaxVal,
    tds: incomeTaxVal,
    pt_default: 200,
  });
  const govPreview = computeGovernmentMonthlyPayroll({
    grossBasic,
    daPercent: 53,
    hraPercent: 30,
    medicalFixed: 3000,
    transportDaPercent: 48.06,
    payLevel: governmentPayLevelPost,
    daysInMonth: 30,
    unpaidDays: 0,
    deductionDefaults: dedDefaults,
  });
  const calculatedCtc = govPreview.totalEarnings;

  const { data: inserted, error } = await supabase
    .from("HRMS_users")
    .insert([
      {
        email,
        name: name ?? null,
        role: finalRole,
        // Always start in preboarding. They become "current" only after completing invite + mandatory documents.
        employment_status: requestedStatus === "past" ? "past" : "preboarding",
        employee_code: finalEmployeeCode || null,
        phone: phoneDigits,
        date_of_birth: ymdOrNull(dateOfBirth),
        date_of_joining: dateOfJoining || null,
        ctc: calculatedCtc,
        gross_salary: grossBasic,
        tds_monthly: incomeTaxVal,
        pf_eligible: false,
        esic_eligible: false,
        gender: gender ?? null,
        designation: designation ?? null,
        designation_id: designationId ?? null,
        department_id: departmentId ?? null,
        division_id: divisionId ?? null,
        shift_id: shiftId ?? null,
        aadhaar: aadhaarDigits,
        pan: panNormalized,
        uan_number: uanNumber,
        pf_number: pfNumber,
        esic_number: esicNumber,
        government_pay_level: governmentPayLevelPost,
        cpf_number: cpfNumber,
        current_address_line1: currentAddressLine1 || null,
        current_address_line2: currentAddressLine2 || null,
        current_city: currentCity || null,
        current_state: currentState || null,
        current_country: currentCountry || null,
        current_postal_code: currentPostalCode || null,
        permanent_address_line1: permanentAddressLine1 || null,
        permanent_address_line2: permanentAddressLine2 || null,
        permanent_city: permanentCity || null,
        permanent_state: permanentState || null,
        permanent_country: permanentCountry || null,
        permanent_postal_code: permanentPostalCode || null,
        emergency_contact_name: emergencyContactName || null,
        emergency_contact_phone: emergencyContactPhone || null,
        bank_name: bankName || null,
        bank_account_number: bankAccountNumber || null,
        bank_ifsc: bankIfsc || null,
        password_hash,
        company_id: me.company_id,
      },
    ])
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // NOTE: Payroll master should only exist for Current employees.

  // Generate preboarding invite link (employee completes onboarding + mandatory documents)
  let inviteToken: string | null = null;
  try {
    inviteToken = crypto.randomUUID().replace(/-/g, "");
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    await supabase.from("HRMS_employee_invites").insert([
      {
        company_id: me.company_id,
        user_id: inserted.id,
        email,
        token: inviteToken,
        requested_document_ids: requestedDocumentIds ? requestedDocumentIds : null,
        status: "pending",
        expires_at: expiresAt,
        created_by: session.id,
      },
    ]);
  } catch {
    // Best-effort; employee creation succeeded
  }

  // Keep HRMS_employees in sync for custom-auth flows
  try {
    const rawName = (name ?? inserted.name ?? "") as string;
    const fallbackFirstName = email.split("@")[0] || "Employee";
    const parts = rawName.trim().split(/\s+/).filter(Boolean);
    const firstName = (parts[0] || fallbackFirstName).slice(0, 100);
    const lastName = parts.slice(1).join(" ").slice(0, 100) || null;

    const { data: existingEmp } = await supabase
      .from("HRMS_employees")
      .select("id")
      .eq("user_id", inserted.id)
      .maybeSingle();

    if (!existingEmp) {
      await supabase.from("HRMS_employees").insert([
        {
          user_id: inserted.id,
          company_id: me.company_id,
          employee_code: finalEmployeeCode || null,
          first_name: firstName,
          last_name: lastName,
          email,
          phone: phoneDigits,
          date_of_joining: dateOfJoining || null,
          emergency_contact_name: emergencyContactName || null,
          emergency_contact_phone: emergencyContactPhone || null,
          bank_account_number: bankAccountNumber || null,
          bank_ifsc: bankIfsc || null,
          is_active: requestedStatus !== "past",
          designation_id: designationId ?? null,
          department_id: departmentId ?? null,
          division_id: divisionId ?? null,
          shift_id: shiftId ?? null,
        },
      ]);
    }
  } catch {
    // Best-effort sync; main user creation succeeded
  }

  const baseUrl =
    (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "") ||
    new URL(request.url).origin;
  const inviteUrl = inviteToken ? `${baseUrl}/invite/${inviteToken}` : null;
  return NextResponse.json({ employee: mapRow(inserted), inviteUrl });
}

export async function PUT(request: NextRequest) {
  const cookieStore = await cookies();
  const session = await getValidatedSession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isManagerial(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const userId = typeof body?.userId === "string" ? body.userId : "";
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });

  const { data: me, error: meErr } = await supabase
    .from("HRMS_users")
    .select("company_id")
    .eq("id", session.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });
  if (!me?.company_id) return NextResponse.json({ error: "User not linked to company" }, { status: 400 });

  const companyId = me.company_id;
  const { data: target, error: tErr } = await supabase
    .from("HRMS_users")
    .select("id, role, company_id")
    .eq("id", userId)
    .maybeSingle();
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 400 });
  if (!target || target.company_id !== companyId) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  if (target.role === "super_admin") return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const role = typeof body?.role === "string" ? body.role : "";
  const employeeCode = typeof body?.employeeCode === "string" ? body.employeeCode.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const dateOfBirth = typeof body?.dateOfBirth === "string" ? body.dateOfBirth.trim() : "";
  const dateOfJoining = typeof body?.dateOfJoining === "string" ? body.dateOfJoining.trim() : "";
  const employmentStatus = typeof body?.employmentStatus === "string" ? body.employmentStatus : "";
  const currentAddressLine1 = typeof body?.currentAddressLine1 === "string" ? body.currentAddressLine1.trim() : "";
  const currentAddressLine2 = typeof body?.currentAddressLine2 === "string" ? body.currentAddressLine2.trim() : "";
  const currentCity = typeof body?.currentCity === "string" ? body.currentCity.trim() : "";
  const currentState = typeof body?.currentState === "string" ? body.currentState.trim() : "";
  const currentCountry = typeof body?.currentCountry === "string" ? body.currentCountry.trim() : "";
  const currentPostalCode = typeof body?.currentPostalCode === "string" ? body.currentPostalCode.trim() : "";
  const permanentAddressLine1 =
    typeof body?.permanentAddressLine1 === "string" ? body.permanentAddressLine1.trim() : "";
  const permanentAddressLine2 =
    typeof body?.permanentAddressLine2 === "string" ? body.permanentAddressLine2.trim() : "";
  const permanentCity = typeof body?.permanentCity === "string" ? body.permanentCity.trim() : "";
  const permanentState = typeof body?.permanentState === "string" ? body.permanentState.trim() : "";
  const permanentCountry = typeof body?.permanentCountry === "string" ? body.permanentCountry.trim() : "";
  const permanentPostalCode =
    typeof body?.permanentPostalCode === "string" ? body.permanentPostalCode.trim() : "";
  const emergencyContactName =
    typeof body?.emergencyContactName === "string" ? body.emergencyContactName.trim() : "";
  const emergencyContactPhone =
    typeof body?.emergencyContactPhone === "string" ? body.emergencyContactPhone.trim() : "";
  const bankName = typeof body?.bankName === "string" ? body.bankName.trim() : "";
  const bankAccountNumber =
    typeof body?.bankAccountNumber === "string" ? body.bankAccountNumber.trim() : "";
  const bankIfsc = typeof body?.bankIfsc === "string" ? body.bankIfsc.trim() : "";
  const grossBasicRawPut = body?.grossBasic ?? body?.grossSalary;
  const grossBasicPut =
    grossBasicRawPut != null && grossBasicRawPut !== "" ? Number(grossBasicRawPut) : undefined;
  const incomeTaxRawPut = body?.incomeTaxMonthly ?? body?.tds;
  const incomeTaxPut =
    incomeTaxRawPut != null && incomeTaxRawPut !== "" ? Math.max(0, Number(incomeTaxRawPut)) : null;
  const cpfNumberPut = typeof body?.cpfNumber === "string" ? body.cpfNumber.trim() || null : undefined;
  const allowedGenders = ["male", "female", "other"];
  const gender = allowedGenders.includes(body?.gender) ? body.gender : null;
  const designationId = typeof body?.designationId === "string" ? body.designationId.trim() || null : null;
  const designation = typeof body?.designation === "string" ? body.designation.trim() || null : null;
  const departmentId = typeof body?.departmentId === "string" ? body.departmentId.trim() || null : null;
  const divisionId = typeof body?.divisionId === "string" ? body.divisionId.trim() || null : null;
  const shiftId = typeof body?.shiftId === "string" ? body.shiftId.trim() || null : null;
  const uanNumber = typeof body?.uanNumber === "string" ? body.uanNumber.trim() || null : null;
  const pfNumber = typeof body?.pfNumber === "string" ? body.pfNumber.trim() || null : null;
  const esicNumber = typeof body?.esicNumber === "string" ? body.esicNumber.trim() || null : null;
  const governmentPayLevelRaw = body?.governmentPayLevel;
  const governmentPayLevel =
    governmentPayLevelRaw != null && governmentPayLevelRaw !== ""
      ? Math.floor(Number(governmentPayLevelRaw))
      : null;
  if (
    grossBasicPut != null &&
    (governmentPayLevel == null || !Number.isFinite(governmentPayLevel) || governmentPayLevel < 1)
  ) {
    return NextResponse.json(
      { error: "Government pay level is required when gross basic is set" },
      { status: 400 },
    );
  }
  if (
    governmentPayLevel != null &&
    Number.isFinite(governmentPayLevel) &&
    governmentPayLevel >= 1 &&
    grossBasicPut != null &&
    (!Number.isFinite(grossBasicPut) || grossBasicPut <= 0)
  ) {
    return NextResponse.json({ error: "Monthly gross basic pay must be greater than zero" }, { status: 400 });
  }

  if (email) {
    const emailFieldErr = validateEmailField(email);
    if (emailFieldErr) return NextResponse.json({ error: emailFieldErr }, { status: 400 });
  }
  const phoneDigits = phone ? normalizeDigits(phone) : "";
  if (phoneDigits) {
    const phoneErr = validateIndianMobileDigits(phoneDigits);
    if (phoneErr) return NextResponse.json({ error: phoneErr }, { status: 400 });
  }

  const aadhaarDigits = normalizeDigits(typeof body?.aadhaar === "string" ? body.aadhaar : "");
  const aadhaarErr = validateAadhaarDigits(aadhaarDigits);
  if (aadhaarErr) return NextResponse.json({ error: aadhaarErr }, { status: 400 });

  const panNormalized = (typeof body?.pan === "string" ? body.pan : "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const panErr = validatePanNormalized(panNormalized);
  if (panErr) return NextResponse.json({ error: panErr }, { status: 400 });

  const allowedRoles = ["admin", "hr", "manager", "employee"];
  const finalRole = allowedRoles.includes(role || "") ? (role as any) : undefined;
  const allowedStatus = ["preboarding", "current", "past"];
  const finalStatus = allowedStatus.includes(employmentStatus) ? (employmentStatus as any) : undefined;

  const gross = grossBasicPut != null && Number.isFinite(grossBasicPut) && grossBasicPut > 0 ? grossBasicPut : null;
  let calculatedCtc: number | null = null;
  if (
    gross != null &&
    governmentPayLevel != null &&
    Number.isFinite(governmentPayLevel) &&
    governmentPayLevel >= 1
  ) {
    const dedPut = masterRowToDeductionDefaults({
      income_tax_default: incomeTaxPut ?? 0,
      tds: incomeTaxPut ?? 0,
      pt_default: 200,
    });
    calculatedCtc = computeGovernmentMonthlyPayroll({
      grossBasic: gross,
      daPercent: 53,
      hraPercent: 30,
      medicalFixed: 3000,
      transportDaPercent: 48.06,
      payLevel: governmentPayLevel,
      daysInMonth: 30,
      unpaidDays: 0,
      deductionDefaults: dedPut,
    }).totalEarnings;
  }

  const payload: any = {
    updated_at: new Date().toISOString(),
    ...(email ? { email } : {}),
    ...(name ? { name } : {}),
    ...(employeeCode ? { employee_code: employeeCode } : {}),
    ...(phoneDigits ? { phone: phoneDigits } : {}),
    ...(dateOfBirth ? { date_of_birth: ymdOrNull(dateOfBirth) } : { date_of_birth: null }),
    ...(dateOfJoining ? { date_of_joining: dateOfJoining } : {}),
    ...(finalRole ? { role: finalRole } : {}),
    ...(finalStatus ? { employment_status: finalStatus } : {}),
    gender: gender ?? null,
    designation: designation ?? null,
    designation_id: designationId ?? null,
    department_id: departmentId ?? null,
    division_id: divisionId ?? null,
    shift_id: shiftId ?? null,
    aadhaar: aadhaarDigits,
    pan: panNormalized,
    uan_number: uanNumber,
    pf_number: pfNumber,
    esic_number: esicNumber,
    government_pay_level:
      governmentPayLevel != null && Number.isFinite(governmentPayLevel) && governmentPayLevel >= 1
        ? governmentPayLevel
        : null,
    current_address_line1: currentAddressLine1 || null,
    current_address_line2: currentAddressLine2 || null,
    current_city: currentCity || null,
    current_state: currentState || null,
    current_country: currentCountry || null,
    current_postal_code: currentPostalCode || null,
    permanent_address_line1: permanentAddressLine1 || null,
    permanent_address_line2: permanentAddressLine2 || null,
    permanent_city: permanentCity || null,
    permanent_state: permanentState || null,
    permanent_country: permanentCountry || null,
    permanent_postal_code: permanentPostalCode || null,
    emergency_contact_name: emergencyContactName || null,
    emergency_contact_phone: emergencyContactPhone || null,
    bank_name: bankName || null,
    bank_account_number: bankAccountNumber || null,
    bank_ifsc: bankIfsc || null,
    gross_salary: gross,
    tds_monthly: incomeTaxPut,
    ctc: calculatedCtc,
    pf_eligible: false,
    esic_eligible: false,
    ...(cpfNumberPut !== undefined ? { cpf_number: cpfNumberPut } : {}),
  };

  const { data: updated, error: upErr } = await supabase
    .from("HRMS_users")
    .update(payload)
    .eq("company_id", companyId)
    .eq("id", userId)
    .select("*")
    .single();
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });

  // Best-effort sync to HRMS_employees mirror table
  try {
    await supabase
      .from("HRMS_employees")
      .update({
        employee_code: employeeCode || null,
        email: email || null,
        phone: phoneDigits || null,
        date_of_joining: dateOfJoining || null,
        designation_id: designationId ?? null,
        department_id: departmentId ?? null,
        division_id: divisionId ?? null,
        shift_id: shiftId ?? null,
        bank_account_number: bankAccountNumber || null,
        bank_ifsc: bankIfsc || null,
        emergency_contact_name: emergencyContactName || null,
        emergency_contact_phone: emergencyContactPhone || null,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", companyId)
      .eq("user_id", userId);
  } catch {
    // ignore
  }

  // Best-effort update payroll master TDS / income tax (latest active master row)
  if (incomeTaxPut != null) {
    try {
      await supabase
        .from("HRMS_payroll_master")
        .update({ tds: incomeTaxPut, income_tax_default: incomeTaxPut })
        .eq("company_id", companyId)
        .eq("employee_user_id", userId)
        .is("effective_end_date", null);
    } catch {
      // ignore
    }
  }

  return NextResponse.json({ employee: mapRow(updated) });
}

export async function PATCH(request: NextRequest) {
  const cookieStore = await cookies();
  const session = await getValidatedSession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isManagerial(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const action = typeof body?.action === "string" ? body.action : "";
  const userId = typeof body?.userId === "string" ? body.userId : "";
  const dateOfJoining = typeof body?.dateOfJoining === "string" ? body.dateOfJoining.trim() : "";
  const lastWorkingDate = typeof body?.lastWorkingDate === "string" ? body.lastWorkingDate.trim() : "";
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });
  if (action !== "convert_to_current" && action !== "convert_to_past" && action !== "revoke_notice")
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  const { data: me, error: meErr } = await supabase
    .from("HRMS_users")
    .select("company_id")
    .eq("id", session.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });
  if (!me?.company_id) return NextResponse.json({ error: "User not linked to company" }, { status: 400 });

  const { data: invite, error: iErr } = await supabase
    .from("HRMS_employee_invites")
    .select("*")
    .eq("company_id", me.company_id)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 400 });
  if (!invite) return NextResponse.json({ error: "No invite found for employee" }, { status: 400 });

  if (action === "convert_to_current") {
    if (invite.status !== "completed") return NextResponse.json({ error: "Invite not completed yet" }, { status: 400 });

    const requestedIds = Array.isArray(invite.requested_document_ids)
      ? (invite.requested_document_ids as any[]).filter((x) => typeof x === "string")
      : null;
    let docQuery = supabase
      .from("HRMS_company_documents")
      .select("id, is_mandatory")
      .eq("company_id", me.company_id);
    if (requestedIds && requestedIds.length) docQuery = docQuery.in("id", requestedIds);
    const { data: docs, error: dErr } = await docQuery;
    if (dErr) return NextResponse.json({ error: dErr.message }, { status: 400 });

    const mandatoryIds = (docs ?? []).filter((d: any) => d.is_mandatory).map((d: any) => d.id as string);
    if (mandatoryIds.length) {
      const { data: subs, error: sErr } = await supabase
        .from("HRMS_employee_document_submissions")
        .select("document_id, status")
        .eq("user_id", userId);
      if (sErr) return NextResponse.json({ error: sErr.message }, { status: 400 });
      const done = new Set((subs ?? []).filter((s: any) => ["submitted", "signed", "approved"].includes(s.status)).map((s: any) => s.document_id));
      const missing = mandatoryIds.filter((id) => !done.has(id));
      if (missing.length) return NextResponse.json({ error: "Mandatory documents still pending" }, { status: 400 });
    }

    const { data: userForDoj } = await supabase
      .from("HRMS_users")
      .select("date_of_joining")
      .eq("id", userId)
      .single();
    const doj = dateOfJoining || (userForDoj?.date_of_joining ? String(userForDoj.date_of_joining).slice(0, 10) : null) || new Date().toISOString().slice(0, 10);
    const { error: updErr } = await supabase
      .from("HRMS_users")
      .update({ employment_status: "current", date_of_joining: doj, date_of_leaving: null, updated_at: new Date().toISOString() })
      .eq("company_id", me.company_id)
      .eq("id", userId);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

    await supabase
      .from("HRMS_employees")
      .update({ is_active: true, date_of_joining: doj, date_of_leaving: null, updated_at: new Date().toISOString() })
      .eq("company_id", me.company_id)
      .eq("user_id", userId);

    const { data: company } = await supabase
      .from("HRMS_companies")
      .select("professional_tax_monthly")
      .eq("id", me.company_id)
      .single();
    const ptMonthly = company?.professional_tax_monthly != null ? Number(company.professional_tax_monthly) : 200;

    const { data: u } = await supabase
      .from("HRMS_users")
      .select("ctc, gross_salary, tds_monthly, government_pay_level")
      .eq("id", userId)
      .single();
    const grossBasicJoin = Number(u?.gross_salary ?? 0);
    const payLevel = u?.government_pay_level != null ? Number(u.government_pay_level) : null;
    if (payLevel == null || !Number.isFinite(payLevel) || payLevel < 1) {
      return NextResponse.json(
        { error: "Set government pay level on the employee before marking as current." },
        { status: 400 },
      );
    }
    if (!Number.isFinite(grossBasicJoin) || grossBasicJoin <= 0) {
      return NextResponse.json(
        { error: "Set monthly gross basic pay on the employee before marking as current." },
        { status: 400 },
      );
    }

    const slab = deriveTransportSlabFromLevel(payLevel);
    const tdsMonthly = u?.tds_monthly != null ? Math.max(0, Number(u.tds_monthly)) : 0;
    const ded = {
      income_tax_default: tdsMonthly,
      pt_default: ptMonthly,
      lic_default: 0,
      cpf_default: 0,
      da_cpf_default: 0,
      vpf_default: 0,
      pf_loan_default: 0,
      post_office_default: 0,
      credit_society_default: 0,
      std_licence_fee_default: 0,
      electricity_default: 0,
      water_default: 0,
      mess_default: 0,
      horticulture_default: 0,
      welfare_default: 0,
      veh_charge_default: 0,
      other_deduction_default: 0,
    };
    const preview = computeGovernmentMonthlyPayroll({
      grossBasic: grossBasicJoin,
      daPercent: 53,
      hraPercent: 30,
      medicalFixed: 3000,
      transportDaPercent: 48.06,
      payLevel,
      daysInMonth: 30,
      unpaidDays: 0,
      deductionDefaults: masterRowToDeductionDefaults(ded),
    });

    const { data: existingMaster } = await supabase
      .from("HRMS_payroll_master")
      .select("id")
      .eq("employee_user_id", userId)
      .is("effective_end_date", null)
      .maybeSingle();

    if (!existingMaster) {
      await supabase.from("HRMS_payroll_master").insert([
        {
          company_id: me.company_id,
          employee_user_id: userId,
          payroll_mode: "government",
          gross_basic: grossBasicJoin,
          gross_salary: grossBasicJoin,
          da_percent: 53,
          hra_percent: 30,
          medical_fixed: 3000,
          transport_da_percent: 48.06,
          transport_slab_group: slab.transportSlabGroup,
          transport_base: slab.transportBase,
          ...ded,
          pf_eligible: false,
          esic_eligible: false,
          pf_employee: 0,
          pf_employer: 0,
          esic_employee: 0,
          esic_employer: 0,
          pt: ded.pt_default,
          tds: tdsMonthly,
          advance_bonus: 0,
          take_home: preview.netSalary,
          ctc: grossBasicJoin,
          basic: preview.basicPaid,
          hra: preview.hraPaid,
          medical: preview.medicalPaid,
          trans: preview.transportPaid,
          lta: 0,
          personal: 0,
          effective_start_date: doj,
          effective_end_date: null,
          reason_for_change: "NewJoin",
          created_by: session.id,
        },
      ]);
    }

    await supabase
      .from("HRMS_users")
      .update({
        ctc: preview.totalEarnings,
        gross_salary: grossBasicJoin,
        pf_eligible: false,
        esic_eligible: false,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", me.company_id)
      .eq("id", userId);

    return NextResponse.json({ ok: true });
  }

  if (action === "revoke_notice") {
    const { error: revErr } = await supabase
      .from("HRMS_users")
      .update({ employment_status: "current", date_of_leaving: null, updated_at: new Date().toISOString() })
      .eq("company_id", me.company_id)
      .eq("id", userId);
    if (revErr) return NextResponse.json({ error: revErr.message }, { status: 400 });

    await supabase
      .from("HRMS_employees")
      .update({ is_active: true, date_of_leaving: null, updated_at: new Date().toISOString() })
      .eq("company_id", me.company_id)
      .eq("user_id", userId);

    return NextResponse.json({ ok: true });
  }

  // convert_to_past (notice-aware)
  const dol = lastWorkingDate || todayYmd();
  const today = todayYmd();
  const nextStatus = dol <= today ? "past" : "current";
  const { error: pastErr } = await supabase
    .from("HRMS_users")
    .update({ employment_status: nextStatus, date_of_leaving: dol, updated_at: new Date().toISOString() })
    .eq("company_id", me.company_id)
    .eq("id", userId);
  if (pastErr) return NextResponse.json({ error: pastErr.message }, { status: 400 });

  await supabase
    .from("HRMS_employees")
    .update({ is_active: nextStatus !== "past", date_of_leaving: dol, updated_at: new Date().toISOString() })
    .eq("company_id", me.company_id)
    .eq("user_id", userId);

  return NextResponse.json({ ok: true, status: nextStatus });
}

/** Super admin only: permanently remove an employee user (same company, any employment stage). */
export async function DELETE(request: NextRequest) {
  const cookieStore = await cookies();
  const session = await getValidatedSession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "super_admin") {
    return NextResponse.json({ error: "Only super admins can delete employees" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const userId = (searchParams.get("userId") || "").trim();
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });
  if (userId === session.id) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  const { data: me, error: meErr } = await supabase.from("HRMS_users").select("company_id").eq("id", session.id).maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });
  if (!me?.company_id) return NextResponse.json({ error: "User not linked to company" }, { status: 400 });

  const { data: target, error: tErr } = await supabase
    .from("HRMS_users")
    .select("id, company_id, role")
    .eq("id", userId)
    .maybeSingle();
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 400 });
  if (!target) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  if (target.company_id !== me.company_id) {
    return NextResponse.json({ error: "Employee is not in your company" }, { status: 403 });
  }
  if (target.role === "super_admin") {
    return NextResponse.json({ error: "Cannot delete a super admin" }, { status: 400 });
  }

  const { error: delErr } = await supabase.from("HRMS_users").delete().eq("id", userId);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}

