import { Suspense } from "react";
import { ApprovalsContent } from "./role-approvals";

export default function ApprovalsPage() {
  return (
    <Suspense>
      <ApprovalsContent />
    </Suspense>
  );
}
