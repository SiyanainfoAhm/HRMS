"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/cn";

export type OrgLookupOption = { id: string; label: string };

type Props = {
  label: string;
  /** Selected option id (empty if none). */
  value: string;
  /** Text shown in the input (usually the selected label or typed query). */
  inputValue: string;
  options: OrgLookupOption[];
  onInputChange: (text: string) => void;
  onSelect: (id: string, label: string) => void;
  entityName: string;
  onAddNew?: (name: string) => void | Promise<void>;
  disabled?: boolean;
  loading?: boolean;
  required?: boolean;
  error?: string | null;
  placeholder?: string;
  addDisabled?: boolean;
  addDisabledHint?: string;
  className?: string;
};

export function getUnresolvedOrgInput(
  inputValue: string,
  value: string,
  options: OrgLookupOption[],
): string | null {
  const q = inputValue.trim();
  if (!q) return null;
  const exact = options.find((o) => o.label.toLowerCase() === q.toLowerCase());
  if (exact) return null;
  if (value) {
    const selected = options.find((o) => o.id === value);
    if (selected && selected.label.toLowerCase() === q.toLowerCase()) return null;
  }
  return q;
}

export function OrgLookupCombobox({
  label,
  value,
  inputValue,
  options,
  onInputChange,
  onSelect,
  entityName,
  onAddNew,
  disabled,
  loading,
  required,
  error,
  placeholder,
  addDisabled,
  addDisabledHint,
  className,
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = inputValue.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [inputValue, options]);

  const unresolved = getUnresolvedOrgInput(inputValue, value, options);
  const showAddRow = Boolean(unresolved && onAddNew);

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  function pickOption(id: string, optionLabel: string) {
    onSelect(id, optionLabel);
    setOpen(false);
  }

  function handleBlur() {
    window.setTimeout(() => {
      setOpen(false);
      const q = inputValue.trim();
      if (!q) return;
      const match = options.find((o) => o.label.toLowerCase() === q.toLowerCase());
      if (match) pickOption(match.id, match.label);
    }, 120);
  }

  return (
    <div ref={rootRef} className={cn("relative min-w-0", className)}>
      <label className="label-field">
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </label>
      <div className="relative">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          disabled={disabled || loading}
          value={inputValue}
          placeholder={loading ? "Loading…" : placeholder ?? `Search ${entityName}…`}
          onChange={(e) => {
            onInputChange(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => !disabled && !loading && setOpen(true)}
          onBlur={handleBlur}
          className={cn(
            "input-field pr-9",
            (disabled || loading) && "cursor-not-allowed bg-slate-50 text-slate-500",
            error && "border-red-400 focus:border-red-500 focus:ring-red-500/20",
          )}
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled || loading}
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-slate-500"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => !disabled && !loading && setOpen((v) => !v)}
          aria-label={`Show ${entityName} list`}
        >
          <span className="text-sm">▾</span>
        </button>
      </div>

      {open && !disabled && !loading ? (
        <div
          id={listId}
          role="listbox"
          className="absolute z-[90] mt-1 w-full overflow-hidden rounded-xl border border-brand-border bg-white shadow-xl"
        >
          {showAddRow ? (
            <button
              type="button"
              disabled={addDisabled}
              title={addDisabled ? addDisabledHint : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (!unresolved || addDisabled) return;
                void onAddNew?.(unresolved);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2.5 text-left text-[13px] font-medium text-brand-navy hover:bg-brand-navy/5",
                addDisabled && "cursor-not-allowed opacity-50",
              )}
            >
              <Plus className="h-4 w-4 shrink-0" aria-hidden />
              <span>
                Add &quot;{unresolved}&quot; as new {entityName}
              </span>
            </button>
          ) : null}

          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-[13px] text-slate-500">
              {inputValue.trim()
                ? `No matches. Type to add a new ${entityName}.`
                : `No ${entityName}s yet. Type to add one.`}
            </p>
          ) : (
            <ul className="max-h-56 overflow-y-auto py-1">
              {filtered.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={o.id === value}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickOption(o.id, o.label)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] hover:bg-slate-50",
                      o.id === value && "bg-brand-navy/5 font-medium text-brand-navy",
                    )}
                  >
                    <span className="truncate">{o.label}</span>
                    {o.id === value ? <span className="text-emerald-700">✓</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
