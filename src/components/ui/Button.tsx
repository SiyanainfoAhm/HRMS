"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md";

const variantClass: Record<Variant, string> = {
  primary: "btn btn-primary",
  secondary: "btn btn-secondary",
  outline: "btn btn-outline",
  ghost: "btn btn-ghost",
  danger: "btn btn-danger",
};

const sizeClass: Record<Size, string> = {
  sm: "btn-sm !rounded-lg",
  md: "",
};

export function Button({
  children,
  variant = "primary",
  size = "md",
  loading,
  disabled,
  type = "button",
  className,
  onClick,
}: {
  children: React.ReactNode;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  className?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className={cn(variantClass[variant], sizeClass[size], className)}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  children,
  label,
  className,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-xl border border-brand-border text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}
