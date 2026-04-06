import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, getSessionFromCookie } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";

function isManagerial(role: string): boolean {
  return role === "super_admin" || role === "admin" || role === "hr";
}

function isSuperAdmin(role: string): boolean {
  return role === "super_admin";
}

export async function GET() {
  const cookieStore = await cookies();
  const session = getSessionFromCookie(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isManagerial(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: me, error: meErr } = await supabase
    .from("HRMS_users")
    .select("company_id")
    .eq("id", session.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });
  if (!me?.company_id) return NextResponse.json({ masters: [] });

  const { data: masters } = await supabase
    .from("HRMS_payroll_master")
    .select("*")
    .eq("company_id", me.company_id)
    .is("effective_end_date", null);
  if (!masters?.length) return NextResponse.json({ masters: [] });

  const userIds = [...new Set((masters ?? []).map((m: any) => m.employee_user_id))];
  const { data: users } = await supabase
    .from("HRMS_users")
    .select("id, name, email, role")
    .in("id", userIds);
  const userMap = new Map((users ?? []).map((u: any) => [u.id, u]));

  const list = masters
    .filter((m: any) => {
      const u = userMap.get(m.employee_user_id);
      return u && u.role !== "super_admin";
    })
    .map((m: any) => {
      const u = userMap.get(m.employee_user_id);
      return {
        employeeUserId: m.employee_user_id,
        employeeName: u?.name ?? null,
        employeeEmail: u?.email ?? "",
        master: {
          id: m.id,
          grossSalary: m.gross_salary,
          ctc: m.ctc,
          pfEligible: m.pf_eligible,
          esicEligible: m.esic_eligible,
          pfEmployee: m.pf_employee,
          pfEmployer: m.pf_employer,
          esicEmployee: m.esic_employee,
          esicEmployer: m.esic_employer,
          pt: m.pt,
          tds: m.tds ?? 0,
          advanceBonus: m.advance_bonus ?? 0,
          takeHome: m.take_home,
          effectiveStartDate: m.effective_start_date,
          basic: m.basic ?? 0,
          hra: m.hra ?? 0,
          medical: m.medical ?? 0,
          trans: m.trans ?? 0,
          lta: m.lta ?? 0,
          personal: m.personal ?? 0,
        },
      };
    });

  return NextResponse.json({ masters: list });
}

export async function PATCH(request: NextRequest) {
  const cookieStore = await cookies();
  const session = getSessionFromCookie(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isManagerial(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const userId = typeof body?.employeeUserId === "string" ? body.employeeUserId : "";
  let grossSalary = body?.grossSalary != null ? Number(body.grossSalary) : 0;
  const pfEligible = body?.pfEligible === true;
  const esicEligible = body?.esicEligible === true;
  const effectiveStartDate = typeof body?.effectiveStartDate === "string" ? body.effectiveStartDate : "";
  let reasonForChange = typeof body?.reasonForChange === "string" ? body.reasonForChange.trim() : "";
  if (!reasonForChange && isSuperAdmin(session.role)) {
    reasonForChange = "Payroll master update";
  }

  const ptOverride = body?.pt != null ? Math.max(0, Number(body.pt)) : null;
  const tdsVal = body?.tds != null ? Math.max(0, Number(body.tds)) : 0;
  const advanceBonusVal = body?.advanceBonus != null ? Math.max(0, Number(body.advanceBonus)) : 0;

  // Optional salary component breakdown (Basic, HRA, Medical, Trans, LTA, Personal)
  const basic = body?.basic != null ? Number(body.basic) : 0;
  const hra = body?.hra != null ? Number(body.hra) : 0;
  const medical = body?.medical != null ? Number(body.medical) : 0;
  const trans = body?.trans != null ? Number(body.trans) : 0;
  const lta = body?.lta != null ? Number(body.lta) : 0;
  const personal = body?.personal != null ? Number(body.personal) : 0;
  const componentsSum = basic + hra + medical + trans + lta + personal;
  if (componentsSum > 0) grossSalary = componentsSum;

  if (!userId || !effectiveStartDate) {
    return NextResponse.json({ error: "employeeUserId and effectiveStartDate are required" }, { status: 400 });
  }
  if (!reasonForChange) {
    return NextResponse.json({ error: "reasonForChange is required" }, { status: 400 });
  }

  const { data: me, error: meErr } = await supabase
    .from("HRMS_users")
    .select("company_id")
    .eq("id", session.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });
  if (!me?.company_id) return NextResponse.json({ error: "No company" }, { status: 400 });

  const { data: target } = await supabase
    .from("HRMS_users")
    .select("id, company_id, employment_status")
    .eq("id", userId)
    .single();
  if (!target || target.company_id !== me.company_id || target.employment_status !== "current") {
    return NextResponse.json({ error: "Invalid employee" }, { status: 400 });
  }

  const { data: company } = await supabase
    .from("HRMS_companies")
    .select("professional_tax_monthly")
    .eq("id", me.company_id)
    .single();
  const companyPt = company?.professional_tax_monthly != null ? Number(company.professional_tax_monthly) : 200;
  const ptMonthly = ptOverride != null && Number.isFinite(ptOverride) ? ptOverride : companyPt;

  const salaryBreakup = componentsSum > 0
    ? { basic, hra, medical, trans, lta, personal }
    : undefined;
  const calc = (await import("@/lib/payrollCalc")).computePayrollFromGross(
    grossSalary,
    pfEligible,
    esicEligible,
    ptMonthly,
    salaryBreakup
  );
  const { pfEmp, pfEmpr, esicEmp, esicEmpr, ctc, takeHome: baseTakeHome, basic: calcBasic, hra: calcHra, medical: calcMedical, trans: calcTrans, lta: calcLta, personal: calcPersonal } = calc;
  const takeHome = Math.max(0, baseTakeHome - tdsVal + advanceBonusVal);

  const { data: oldMaster } = await supabase
    .from("HRMS_payroll_master")
    .select("id")
    .eq("employee_user_id", userId)
    .is("effective_end_date", null)
    .maybeSingle();

  if (oldMaster) {
    const d = new Date(effectiveStartDate + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    const prevDay = d.toISOString().slice(0, 10);
    await supabase
      .from("HRMS_payroll_master")
      .update({ effective_end_date: prevDay })
      .eq("id", oldMaster.id);
  }

  const salaryComponents = {
    basic: calcBasic,
    hra: calcHra,
    medical: calcMedical,
    trans: calcTrans,
    lta: calcLta,
    personal: calcPersonal,
  };

  await supabase.from("HRMS_payroll_master").insert([
    {
      company_id: me.company_id,
      employee_user_id: userId,
      gross_salary: grossSalary,
      ctc,
      pf_eligible: pfEligible,
      esic_eligible: esicEligible,
      pf_employee: pfEmp,
      pf_employer: pfEmpr,
      esic_employee: esicEmp,
      esic_employer: esicEmpr,
      pt: ptMonthly,
      tds: tdsVal,
      advance_bonus: advanceBonusVal,
      take_home: takeHome,
      effective_start_date: effectiveStartDate,
      effective_end_date: null,
      reason_for_change: reasonForChange,
      created_by: session.id,
      ...salaryComponents,
    },
  ]);

  await supabase
    .from("HRMS_users")
    .update({ ctc, gross_salary: grossSalary, pf_eligible: pfEligible, esic_eligible: esicEligible, updated_at: new Date().toISOString() })
    .eq("id", userId);

  return NextResponse.json({ ok: true });
}
