"use client";

import { cn } from "@/lib/cn";
import { roundMoney } from "@/lib/money";

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  numeric?: boolean;
  invalid?: boolean;
  /**
   * A payroll amount: a typed 54.09 is rounded to the whole rupee (54) when the field loses focus, so what
   * is shown is what is stored. Needs a controlled `value` + `onChange` (the rounded value is sent through it).
   */
  money?: boolean;
};

export function Input({ className, numeric, invalid, money, ...props }: Props) {
  return (
    <input
      {...props}
      onBlur={(e) => {
        props.onBlur?.(e);
        if (!money || !props.onChange) return;
        const raw = e.currentTarget.value;
        const n = Number(raw);
        if (raw === "" || !Number.isFinite(n)) return;
        const rounded = String(roundMoney(n));
        if (rounded === raw) return;
        props.onChange({ target: { value: rounded, name: e.currentTarget.name }, currentTarget: e.currentTarget } as unknown as React.ChangeEvent<HTMLInputElement>);
      }}
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
