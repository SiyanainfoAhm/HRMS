"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/cn";

export type SelectOption = { value: string; label: string; disabled?: boolean };

type Props = {
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
  className?: string;
  required?: boolean;
  error?: string | null;
  searchable?: boolean;
};

export function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  disabled,
  loading,
  placeholder,
  className,
  required,
  error,
  searchable,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedLabel = options.find((o) => o.value === value)?.label ?? "";

  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, searchable]);

  if (!searchable) {
    return (
      <div className={cn("min-w-0", className)}>
        {label ? (
          <label htmlFor={id} className="label-field">
            {label}
            {required ? <span className="text-red-500"> *</span> : null}
          </label>
        ) : null}
        <div className="relative">
          <select
            id={id}
            value={value}
            required={required}
            disabled={disabled || loading}
            onChange={(e) => onChange(e.target.value)}
            className={cn(
              "input-field appearance-none pr-9",
              (disabled || loading) && "cursor-not-allowed bg-slate-50 text-slate-500",
              error && "border-red-400 focus:border-red-500 focus:ring-red-500/20",
            )}
          >
            {placeholder ? (
              <option value="" disabled>
                {placeholder}
              </option>
            ) : null}
            {loading ? (
              <option value={value}>Loading…</option>
            ) : (
              options.map((o) => (
                <option key={o.value} value={o.value} disabled={o.disabled}>
                  {o.label}
                </option>
              ))
            )}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        </div>
        {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className={cn("relative min-w-0", className)}>
      {label ? (
        <label className="label-field">
          {label}
          {required ? <span className="text-red-500"> *</span> : null}
        </label>
      ) : null}
      <button
        type="button"
        id={id}
        disabled={disabled || loading}
        onClick={() => !disabled && !loading && setOpen((o) => !o)}
        className={cn(
          "input-field flex items-center justify-between gap-2 text-left",
          (disabled || loading) && "cursor-not-allowed bg-slate-50 text-slate-500",
          error && "border-red-400",
        )}
      >
        <span className={cn("truncate", !value && "text-slate-400")}>
          {loading ? "Loading…" : value ? selectedLabel : placeholder ?? "Select…"}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
      {open && !disabled && !loading ? (
        <>
          <button type="button" className="fixed inset-0 z-[80]" aria-label="Close" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 z-[81] mt-1 overflow-hidden rounded-xl border border-brand-border bg-white shadow-xl">
            <div className="border-b border-slate-100 p-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search…"
                  className="input-field py-1.5 pl-8 text-[13px]"
                  autoFocus
                />
              </div>
            </div>
            <ul className="max-h-56 overflow-y-auto py-1" role="listbox">
              {filtered.length === 0 ? (
                <li className="px-2.5 py-1.5 text-[13px] text-slate-500">No matches</li>
              ) : (
                filtered.map((o) => (
                  <li key={o.value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={o.value === value}
                      disabled={o.disabled}
                      onClick={() => {
                        onChange(o.value);
                        setOpen(false);
                        setQuery("");
                      }}
                      className={cn(
                        "w-full px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-slate-50",
                        o.value === value && "bg-brand-navy/5 font-medium text-brand-navy",
                        o.disabled && "cursor-not-allowed opacity-50",
                      )}
                    >
                      {o.label}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </>
      ) : null}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
