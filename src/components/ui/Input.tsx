"use client";

import { cn } from "@/lib/cn";

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  numeric?: boolean;
  invalid?: boolean;
};

export function Input({ className, numeric, invalid, ...props }: Props) {
  return (
    <input
      {...props}
      className={cn(
        "input-field",
        numeric && "text-right tabular-nums",
        invalid && "border-red-400 focus:border-red-500 focus:ring-red-500/20",
        props.readOnly && "cursor-not-allowed bg-slate-50 text-slate-700",
        className,
      )}
    />
  );
}
