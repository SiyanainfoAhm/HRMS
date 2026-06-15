import { redirect } from "next/navigation";

/** Public self-signup is disabled — CIRT accounts are provisioned by administrators. */
export default function SignupPage() {
  redirect("/auth/login");
}
