import { cn } from "@/lib/cn";

export function FilterCard({
  label,
  children,
  className,
}: {
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("filter-card", className)}>
      {label ? <p className="filter-card-label">{label}</p> : null}
      {children}
    </div>
  );
}
