import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { COOKIE_NAME, TOKEN_COOKIE_NAME } from "@/lib/auth";
import { getValidatedSession } from "@/lib/authValidate";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const session = await getValidatedSession(
    cookieStore.get(COOKIE_NAME)?.value,
    cookieStore.get(TOKEN_COOKIE_NAME)?.value,
  );

  if (!session) {
    redirect("/auth/login");
  }

  const isPayrollAdmin =
    session.role === "super_admin" || session.role === "admin" || session.role === "hr";

  if (session.role === "super_admin" || session.role === "admin") {
    redirect("/payroll?tab=master");
  }

  if (isPayrollAdmin) {
    redirect("/payroll?tab=run");
  }

  redirect("/profile?tab=pay");
}
