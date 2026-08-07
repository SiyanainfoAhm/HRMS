import { cn } from "@/lib/cn";

export function RecordCard({
  title,
  subtitle,
  children,
  actions,
  className,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <article className={cn("record-card", className)}>
      {(title || subtitle) && (
        <div className="record-card-header">
          {title ? <h3 className="record-card-title">{title}</h3> : null}
          {subtitle ? <p className="record-card-subtitle">{subtitle}</p> : null}
        </div>
      )}
      {children ? <div className={title || subtitle ? "record-card-body" : "text-sm text-slate-800"}>{children}</div> : null}
      {actions ? <div className="record-card-actions">{actions}</div> : null}
    </article>
  );
}
