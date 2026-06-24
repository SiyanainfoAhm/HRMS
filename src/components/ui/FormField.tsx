"use client";

import { cn } from "@/lib/cn";

export function FormField({
  label,
  htmlFor,
  required,
  error,
  helperText,
  children,
  className,
}: {
  label?: string;
  htmlFor?: string;
  required?: boolean;
  error?: string | null;
  helperText?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      {label ? (
        <label htmlFor={htmlFor} className="label-field text-xs">
          {label}
          {required ? <span className="text-red-500"> *</span> : null}
        </label>
      ) : null}
      {children}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
      {!error && helperText ? <p className="mt-1 text-xs text-brand-muted">{helperText}</p> : null}
    </div>
  );
}
