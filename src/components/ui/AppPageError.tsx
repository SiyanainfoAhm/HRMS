"use client";

import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";

type Props = {
  message: string;
  onRetry?: () => void;
};

export function AppPageError({ message, onRetry }: Props) {
  return (
    <div className="flex min-h-[min(320px,50vh)] flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50/50 px-6 py-12 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
        <AlertCircle className="h-6 w-6" aria-hidden />
      </div>
      <p className="text-sm font-medium text-red-800">{message}</p>
      {onRetry ? (
        <Button size="sm" variant="outline" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
