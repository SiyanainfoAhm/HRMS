import { Suspense } from "react";
import { ProfileContent } from "./role-profile";

export default function ProfilePage() {
  return (
    <Suspense>
      <ProfileContent />
    </Suspense>
  );
}
