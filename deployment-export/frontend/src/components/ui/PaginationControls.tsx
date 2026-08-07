"use client";

import { PAGE_SIZE_OPTIONS, type PaginationMeta } from "@/lib/pagination";
import { Button } from "@/components/ui/Button";

type Props = {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
  onPerPageChange?: (perPage: number) => void;
  loading?: boolean;
  className?: string;
};

export function PaginationControls({
  meta,
  onPageChange,
  onPerPageChange,
  loading = false,
  className,
}: Props) {
  const { current_page, per_page, total, last_page } = meta;
  const from = total === 0 ? 0 : (current_page - 1) * per_page + 1;
  const to = Math.min(total, current_page * per_page);

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 text-sm ${className ?? ""}`}>
      <p className="text-slate-600">
        {total === 0 ? "No records" : `Showing ${from}–${to} of ${total}`}
        {loading ? <span className="ml-2 text-slate-400">Loading…</span> : null}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {onPerPageChange ? (
          <label className="flex items-center gap-1.5 text-slate-600">
            <span className="text-xs">Rows</span>
            <select
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm"
              value={per_page}
              disabled={loading}
              onChange={(e) => onPerPageChange(Number(e.target.value))}
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          disabled={loading || current_page <= 1}
          onClick={() => onPageChange(current_page - 1)}
        >
          Previous
        </Button>
        <span className="tabular-nums text-slate-700">
          Page {current_page} / {last_page}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={loading || current_page >= last_page}
          onClick={() => onPageChange(current_page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
