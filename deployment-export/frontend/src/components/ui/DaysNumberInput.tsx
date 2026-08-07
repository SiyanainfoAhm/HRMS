"use client";

import { useEffect, useState, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { digitsOnlyMax2, formatDayCount, parseDayCount } from "@/lib/daysInput";

type DaysNumberInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange" | "min" | "max" | "inputMode"
> & {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
};

/**
 * Day-count field limited to 2 digits (0–max). Use for pay days, HPL/EOL days, etc.
 */
export function DaysNumberInput({
  value,
  onChange,
  min = 0,
  max = 31,
  className,
  onBlur,
  ...rest
}: DaysNumberInputProps) {
  const ceiling = Math.max(min, Math.floor(max));
  const floor = Math.min(min, ceiling);
  const [text, setText] = useState(() => formatDayCount(value, floor, ceiling));

  useEffect(() => {
    setText(formatDayCount(value, floor, ceiling));
  }, [value, floor, ceiling]);

  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={2}
      autoComplete="off"
      value={text}
      className={cn(className)}
      onChange={(e) => {
        const digits = digitsOnlyMax2(e.target.value);
        setText(digits);
        // Allow clearing while typing; commit 0 on blur if still empty.
        if (digits === "") return;
        onChange(parseDayCount(digits, floor, ceiling));
      }}
      onBlur={(e) => {
        const next = parseDayCount(text, floor, ceiling);
        setText(formatDayCount(next, floor, ceiling));
        if (next !== value) onChange(next);
        onBlur?.(e);
      }}
    />
  );
}
