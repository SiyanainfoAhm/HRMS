import { cn } from "@/lib/cn";

export type StatusChipVariant =
  | "present"
  | "absent"
  | "late"
  | "approved"
  | "pending"
  | "rejected"
  | "paid"
  | "unpaid"
  | "active"
  | "inactive"
  | "completed"
  | "draft"
  | "info";

const STYLES: Record<StatusChipVariant, string> = {
  present: "bg-success-soft text-green-800 ring-green-600/15",
  approved: "bg-success-soft text-green-800 ring-green-600/15",
  active: "bg-success-soft text-green-800 ring-green-600/15",
  paid: "bg-success-soft text-green-800 ring-green-600/15",
  completed: "bg-success-soft text-green-800 ring-green-600/15",
  pending: "bg-warning-soft text-amber-900 ring-amber-600/15",
  late: "bg-warning-soft text-amber-900 ring-amber-600/15",
  draft: "bg-warning-soft text-amber-900 ring-amber-600/15",
  rejected: "bg-danger-soft text-red-800 ring-red-600/15",
  absent: "bg-danger-soft text-red-800 ring-red-600/15",
  inactive: "bg-danger-soft text-red-800 ring-red-600/15",
  unpaid: "bg-danger-soft text-red-800 ring-red-600/15",
  info: "bg-blue-50 text-blue-800 ring-blue-600/15",
};

export function statusToVariant(status: string | null | undefined): StatusChipVariant {
  const s = String(status ?? "").toLowerCase();
  if (["present", "approved", "active", "paid", "completed"].includes(s)) return s as StatusChipVariant;
  if (["pending", "late", "draft"].includes(s)) return s as StatusChipVariant;
  if (["rejected", "absent", "inactive", "unpaid", "cancelled"].includes(s)) return "rejected";
  return "info";
}

export function StatusChip({
  label,
  variant,
  className,
}: {
  label: string;
  variant?: StatusChipVariant;
  className?: string;
}) {
  const v = variant ?? statusToVariant(label);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset",
        STYLES[v],
        className,
      )}
    >
      {label}
    </span>
  );
}
