import { redirect } from "next/navigation";
import { decideGuard, loggedOutTarget } from "@/lib/authRouting";
import { checkSession } from "@/lib/sessionCheck";
import { BackendUnavailable } from "@/components/BackendUnavailable";
import { cookies } from "next/headers";
import { COOKIE_NAME, TOKEN_COOKIE_NAME } from "@/lib/auth";
import { isAdminRole } from "@/lib/roles";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const check = await checkSession(cookieStore.get(COOKIE_NAME)?.value, cookieStore.get(TOKEN_COOKIE_NAME)?.value);
  const decision = decideGuard(check);
  if (decision === "redirect-expired") redirect(loggedOutTarget(check));
  if (check.state !== "valid") return <BackendUnavailable />;
  const session = check.session;

  if (isAdminRole(session.role)) {
    redirect("/payroll/master");
  }

  redirect("/employee/dashboard");
}
