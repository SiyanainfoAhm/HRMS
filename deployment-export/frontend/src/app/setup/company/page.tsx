import { redirect } from "next/navigation";

/** Company creation wizard removed — CIRT is the fixed organization for this deployment. */
export default function CompanySetupPage() {
  redirect("/settings");
}
