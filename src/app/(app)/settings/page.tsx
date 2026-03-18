import { Suspense } from "react";
import { SettingsContent } from "./role-settings";

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  );
}
