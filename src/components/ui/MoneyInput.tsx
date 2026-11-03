"use client";

import { useState } from "react";
import { roundMoney } from "@/lib/money";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "step"> & {
  /** The stored amount: always on the money grid (whole rupee). */
  value: number;
  /** Called with the rounded amount on every edit and again on blur. */
  onChange: (n: number) => void;
};

/**
 * Amount entry for payroll money fields. A typed 54.09 is rounded to 54 as soon as it is committed
 * (and the field shows 54 when it loses focus), so what is displayed is what is stored.
 */
export function MoneyInput({ value, onChange, onBlur, onFocus, ...rest }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      {...rest}
      type="number"
      min={rest.min ?? 0}
      step={1}
      value={draft ?? String(value)}
      onFocus={(e) => {
        onFocus?.(e);
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const n = Number(raw);
        onChange(raw === "" || !Number.isFinite(n) ? 0 : Math.max(0, roundMoney(n)));
      }}
      onBlur={(e) => {
        const raw = e.target.value;
        const n = Number(raw);
        const rounded = raw === "" || !Number.isFinite(n) ? 0 : Math.max(0, roundMoney(n));
        setDraft(null);
        onChange(rounded);
        onBlur?.(e);
      }}
    />
  );
}
