/** Polished shimmer skeleton loaders */

function Shimmer({ className = "" }: { className?: string }) {
  return <div className={`skeleton-shimmer rounded-lg ${className}`} aria-hidden />;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <Shimmer className={className} />;
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2.5" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }).map((_, i) => (
        <Shimmer key={i} className={`h-3.5 ${i === lines - 1 ? "w-2/3" : "w-full max-w-md"}`} />
      ))}
    </div>
  );
}

type SkeletonTableProps = { rows?: number; columns?: number; stickyHeader?: boolean };

export function SkeletonTable({ rows = 5, columns = 6, stickyHeader = true }: SkeletonTableProps) {
  return (
    <div className="data-table-shell" aria-busy="true" aria-label="Loading table">
      <table className="w-full min-w-full border-collapse text-left text-sm">
        {stickyHeader && (
          <thead>
            <tr>
              {Array.from({ length: columns }).map((_, ci) => (
                <th key={ci} className="border-b border-slate-100 px-3 py-3">
                  <Shimmer className="h-3 w-16" />
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {Array.from({ length: rows }).map((_, ri) => (
            <tr key={ri}>
              {Array.from({ length: columns }).map((_, ci) => (
                <td key={ci} className="border-t border-slate-50 px-3 py-3">
                  <Shimmer className={`h-4 ${ci === 0 ? "w-24" : ci === 1 ? "w-32" : "w-20"}`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SkeletonList({ items = 4 }: { items?: number }) {
  return (
    <ul className="divide-y divide-slate-100 rounded-xl border border-brand-border bg-white" aria-busy="true" aria-label="Loading list">
      {Array.from({ length: items }).map((_, i) => (
        <li key={i} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0 flex-1 space-y-2">
            <Shimmer className="h-4 w-40" />
            <Shimmer className="h-3 w-28" />
          </div>
          <Shimmer className="h-8 w-20 shrink-0" />
        </li>
      ))}
    </ul>
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-brand-border bg-white p-5" aria-busy="true">
      <Shimmer className="mb-4 h-5 w-48" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Shimmer className="h-3 w-20" />
            <Shimmer className="h-9 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonPayslip() {
  return (
    <div className="mx-auto w-full max-w-[190mm] rounded-xl border border-brand-border bg-white p-6" aria-busy="true">
      <Shimmer className="mx-auto mb-6 h-12 w-48" />
      <div className="space-y-3">
        <Shimmer className="h-4 w-full" />
        <Shimmer className="h-4 w-5/6" />
        <Shimmer className="mt-6 h-40 w-full" />
        <Shimmer className="h-4 w-3/4" />
      </div>
    </div>
  );
}

export function SkeletonEmployeeList({ items = 6 }: { items?: number }) {
  return (
    <div className="divide-y divide-slate-100" aria-busy="true">
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-2 px-3 py-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Shimmer className="h-4 w-36" />
            <Shimmer className="h-3 w-24" />
          </div>
          <Shimmer className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
