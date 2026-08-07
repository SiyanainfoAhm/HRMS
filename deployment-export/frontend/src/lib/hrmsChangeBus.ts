export type HrmsChangeKind =
  | "leave"
  | "leave_policy"
  | "reimbursement"
  | "employee"
  | "payroll_master"
  | "payroll_period";

const HRMS_CHANGE_EVENT = "hrms:changed";

export function dispatchHrmsChange(kind: HrmsChangeKind) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(HRMS_CHANGE_EVENT, {
      detail: { kind, at: Date.now() },
    }),
  );
}

export function onHrmsChange(
  cb: (kind: HrmsChangeKind) => void,
  opts?: { kinds?: HrmsChangeKind[] },
) {
  if (typeof window === "undefined") return () => {};

  const allowed = opts?.kinds?.length ? new Set(opts.kinds) : null;
  const handler = (e: Event) => {
    const ce = e as CustomEvent<{ kind?: HrmsChangeKind }>;
    const kind = ce.detail?.kind;
    if (!kind) return;
    if (allowed && !allowed.has(kind)) return;
    cb(kind);
  };

  window.addEventListener(HRMS_CHANGE_EVENT, handler);
  return () => window.removeEventListener(HRMS_CHANGE_EVENT, handler);
}

