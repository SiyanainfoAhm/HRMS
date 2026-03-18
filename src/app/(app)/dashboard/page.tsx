import { Suspense } from "react";
import { DashboardContent } from "./role-dashboard";

export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardContent />
    </Suspense>
  );
}
