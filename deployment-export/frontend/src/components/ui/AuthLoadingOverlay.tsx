"use client";

import { AppPageLoader } from "@/components/ui/AppPageLoader";

export function AuthLoadingOverlay({ message }: { message: string }) {
  return <AppPageLoader message={message} submessage="Please wait…" variant="overlay" />;
}
