"use client";

import { useCallback, useRef, useState } from "react";
import { FileSpreadsheet, Upload, X } from "lucide-react";
import { cn } from "@/lib/cn";

type Props = {
  accept?: string;
  file: File | null;
  onFileChange: (file: File | null) => void;
  hint?: string;
  disabled?: boolean;
  className?: string;
};

export function FileUpload({
  accept = ".xlsx,.xls,.csv",
  file,
  onFileChange,
  hint = "Excel (.xlsx, .xls) or CSV",
  disabled,
  className,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (disabled) return;
      const f = e.dataTransfer.files?.[0];
      if (f) onFileChange(f);
    },
    [disabled, onFileChange],
  );

  return (
    <div className={className}>
      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors",
          dragOver ? "border-brand-blue bg-blue-50/50" : "border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-slate-50",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <Upload className="mb-2 h-8 w-8 text-slate-400" />
        <p className="text-sm font-medium text-slate-800">Drop file here or click to browse</p>
        <p className="mt-1 text-xs text-brand-muted">{hint}</p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          disabled={disabled}
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
        />
      </div>
      {file ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
          <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-600" />
          <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{file.name}</span>
          <button
            type="button"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            onClick={() => onFileChange(null)}
            aria-label="Remove file"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
