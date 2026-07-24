"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { GovernmentPayslipPrint } from "@/components/payslip/GovernmentPayslipPrint";
import { AdminPayrollRemarksNote } from "@/components/payroll/AdminPayrollRemarksNote";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { AppCard, AppCardHeader } from "@/components/ui/AppCard";
import { fmtDmy } from "@/lib/dateFormat";
import type { GovernmentMonthlySlip } from "@/lib/governmentPayslipLayout";
import { downloadPayslipPdf } from "@/lib/payslipDownload";
import { resolvePayslipDepartment } from "@/lib/payslipUserFields";
import type { GovernmentLeavePayslipDisplay } from "@/lib/leaveBalancesCompute";

export type PayslipBundle = {
  company: { name: string; address: string; logoUrl: string | null } | null;
  user: {
    name: string;
    employeeCode: string;
    designation: string;
    department?: string;
    departmentName?: string;
    dateOfJoining: string;
    aadhaar: string;
    pan: string;
    uanNumber: string;
    pfNumber: string;
    esicNumber?: string;
    cpfNumber?: string;
  } | null;
  payslips: Array<{
    id: string;
    periodMonth: string;
    periodStart: string;
    periodEnd?: string;
    generatedAt: string;
    payDays: number;
    unpaidLeaves: number;
    grossPay: number;
    deductions: number;
    netPay: number;
    basic: number;
    hra: number;
    medical: number;
    trans: number;
    professionalTax: number;
    tds: number;
    incentive: number;
    prBonus: number;
    reimbursement: number;
    bankName: string;
    bankAccountNumber: string;
    governmentMonthly?: Record<string, unknown> | null;
    leaveRemarks?: string | null;
    leavePayslip?: GovernmentLeavePayslipDisplay | null;
  }>;
};

type Props = {
  data: PayslipBundle | null;
  error?: string | null;
  compact?: boolean;
  showPreview?: boolean;
  title?: string;
  initialMonth?: string;
  initialYear?: string;
};

export function EmployeeSalarySlipPanel({
  data,
  error,
  compact = false,
  showPreview = true,
  title = "My Salary Slips",
  initialMonth,
  initialYear,
}: Props) {
  const payslipRef = useRef<HTMLDivElement>(null);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(!compact);

  useEffect(() => {
    if (initialMonth && initialYear) {
      setSelectedMonth(initialMonth.padStart(2, "0"));
      setSelectedYear(initialYear);
      setPreviewOpen(true);
      return;
    }
    if (!data?.payslips?.length) {
      const now = new Date();
      setSelectedYear(String(now.getFullYear()));
      setSelectedMonth(String(now.getMonth() + 1).padStart(2, "0"));
      return;
    }
    const first = data.payslips[0];
    if (first?.periodMonth) {
      const [y, m] = first.periodMonth.split("-");
      setSelectedYear(y || String(new Date().getFullYear()));
      setSelectedMonth(m || String(new Date().getMonth() + 1).padStart(2, "0"));
    }
  }, [data, initialMonth, initialYear]);

  const selectedSlip = useMemo(() => {
    if (!data) return null;
    return data.payslips.find((p) => p.periodMonth === `${selectedYear}-${selectedMonth}`) ?? null;
  }, [data, selectedMonth, selectedYear]);

  const yearOptions = useMemo(() => {
    const doj = data?.user?.dateOfJoining;
    const joinYear = doj ? parseInt(doj.slice(0, 4), 10) : new Date().getFullYear() - 2;
    const currentYear = new Date().getFullYear();
    const years: number[] = [];
    for (let y = currentYear; y >= Math.max(joinYear, 2020); y--) years.push(y);
    return years;
  }, [data?.user?.dateOfJoining]);

  async function handleDownload() {
    setPdfDownloading(true);
    try {
      await downloadPayslipPdf(payslipRef.current, {
        userName: data?.user?.name,
        month: selectedMonth,
        year: selectedYear,
      });
    } catch {
      window.print();
    } finally {
      setPdfDownloading(false);
    }
  }

  return (
    <AppCard>
      <AppCardHeader
        title={title}
        subtitle={
          compact
            ? "Select period to view or download your salary slip."
            : "Select month and year to view your salary slip."
        }
        badge={compact ? <Badge tone="info">Quick access</Badge> : undefined}
        actions={
          compact ? (
            <Link href="/profile?tab=pay" className="text-xs font-medium text-brand-navy hover:underline">
              Open full view
            </Link>
          ) : undefined
        }
      />

      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : !data ? (
        <EmptyState title="No payslip data" description="Payslip information is not available yet." />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="input-field max-w-[120px] py-1.5 text-[13px]"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                <option key={m} value={String(m).padStart(2, "0")}>
                  {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]}
                </option>
              ))}
            </select>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="input-field max-w-[100px] py-1.5 text-[13px]"
            >
              {yearOptions.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
            {selectedSlip ? (
              <>
                {compact ? (
                  <Button size="sm" variant="outline" type="button" onClick={() => setPreviewOpen((o) => !o)}>
                    {previewOpen ? "Hide" : "View Payslip"}
                  </Button>
                ) : null}
                <Button size="sm" type="button" onClick={() => void handleDownload()} loading={pdfDownloading}>
                  Download PDF
                </Button>
              </>
            ) : null}
          </div>

          {!selectedSlip ? (
            <EmptyState
              title="No payslip available"
              description="No payslip available for the selected period."
            />
          ) : showPreview && (!compact || previewOpen) ? (
            <div className="mt-2">{renderPayslipPreview(selectedSlip, data, payslipRef)}</div>
          ) : compact && selectedSlip ? (
            <p className="text-xs text-slate-600">
              Payslip available for {selectedMonth}/{selectedYear}. Use View or Download above.
            </p>
          ) : null}
        </>
      )}
    </AppCard>
  );
}

function renderPayslipPreview(
  slip: PayslipBundle["payslips"][0],
  data: PayslipBundle,
  payslipRef: React.RefObject<HTMLDivElement>,
) {
  const company = data.company;
  const user = data.user;
  const gov = slip.governmentMonthly;
  const leaveRemarks = typeof slip.leaveRemarks === "string" ? slip.leaveRemarks.trim() : "";

  if (gov) {
    return (
      <div className="mx-auto w-full max-w-[190mm]">
        <AdminPayrollRemarksNote remarks={leaveRemarks} />
        <GovernmentPayslipPrint
          ref={payslipRef}
          company={company}
          user={{
            name: user?.name,
            employeeCode: user?.employeeCode,
            designation: user?.designation,
            department: user?.department,
            departmentName: user?.departmentName,
            dateOfJoining: user?.dateOfJoining,
            uanNumber: user?.uanNumber,
            pfNumber: user?.pfNumber,
            cpfNumber: user?.cpfNumber ?? user?.pfNumber,
          }}
          slip={{
            generatedAt: slip.generatedAt,
            periodStart: slip.periodStart,
            payDays: slip.payDays,
            unpaidLeaves: slip.unpaidLeaves,
            bankName: slip.bankName,
            bankAccountNumber: slip.bankAccountNumber,
            netPay: slip.netPay,
          }}
          gov={gov as GovernmentMonthlySlip}
          leavePayslip={slip.leavePayslip ?? null}
        />
      </div>
    );
  }

  const n = (x: number) => (x ?? 0).toLocaleString("en-IN");
  const [y, m] = slip.periodMonth.split("-");

  return (
    <div className="mx-auto w-full max-w-[190mm]">
      <AdminPayrollRemarksNote remarks={leaveRemarks} />
      <div ref={payslipRef} className="overflow-x-auto rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <p className="font-semibold text-slate-900">{company?.name || "Company"}</p>
        <p className="text-slate-600">
          Salary Slip —{" "}
          {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][parseInt(m, 10) - 1]} {y}
        </p>
        <div className="mt-3 grid gap-1 text-slate-700">
          <div>Employee: {user?.name}</div>
          <div>Department: {resolvePayslipDepartment(user)}</div>
          <div>Gross: {n(slip.grossPay)}</div>
          <div>Deductions: {n(slip.deductions)}</div>
          <div className="font-semibold text-emerald-800">Net Pay: {n(slip.netPay)}</div>
          <div className="text-xs text-slate-500">Generated: {fmtDmy(slip.generatedAt)}</div>
        </div>
      </div>
    </div>
  );
}
