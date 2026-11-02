import { redirect } from "next/navigation";

/**
 * Post Payroll Downloads moved into Run Payroll (Downloads > Post-payroll reports).
 * This route only exists so old bookmarks and links keep working.
 */
export default function PostPayrollDownloadsRedirect() {
  redirect("/payroll?tab=run");
}
