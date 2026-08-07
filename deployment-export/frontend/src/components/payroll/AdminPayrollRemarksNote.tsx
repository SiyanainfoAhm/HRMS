"use client";

type Props = {
  remarks?: string | null;
  className?: string;
};

/** Screen note above salary slip preview (admin + employee). Never part of print/PDF slip layout. */
export function AdminPayrollRemarksNote({ remarks, className }: Props) {
  const text = typeof remarks === "string" ? remarks.trim() : "";
  if (!text) return null;

  return (
    <div
      className={`print:hidden mb-3 rounded-lg border border-amber-200/80 bg-amber-50/90 px-3 py-2.5 text-sm text-amber-950 ${className ?? ""}`}
      role="note"
      aria-label="Payroll Remarks"
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800/90">Payroll Remarks</p>
      <p className="mt-1 whitespace-pre-wrap leading-relaxed text-slate-800">{text}</p>
    </div>
  );
}
