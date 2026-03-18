import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, getSessionFromCookie } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";

export async function GET() {
  const cookieStore = await cookies();
  const session = getSessionFromCookie(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: me, error: meErr } = await supabase
    .from("HRMS_users")
    .select("company_id")
    .eq("id", session.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });
  if (!me?.company_id) return NextResponse.json({ payslips: [] });

  // Custom-auth payslips are keyed by employee_user_id
  const { data, error } = await supabase
    .from("HRMS_payslips")
    .select("id, payroll_period_id, net_pay, gross_pay, currency, payslip_number, generated_at, bank_name, bank_account_number, bank_ifsc")
    .eq("company_id", me.company_id)
    .eq("employee_user_id", session.id)
    .order("generated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({
    payslips: (data ?? []).map((p: any) => ({
      id: p.id as string,
      payrollPeriodId: p.payroll_period_id as string,
      netPay: p.net_pay,
      grossPay: p.gross_pay,
      currency: p.currency as string,
      payslipNumber: p.payslip_number as string | null,
      generatedAt: new Date(p.generated_at).toISOString(),
      bankName: (p.bank_name ?? "") as string,
      bankAccountNumber: (p.bank_account_number ?? "") as string,
      bankIfsc: (p.bank_ifsc ?? "") as string,
    })),
  });
}

