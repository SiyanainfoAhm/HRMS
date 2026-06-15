import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { COOKIE_NAME, TOKEN_COOKIE_NAME } from "@/lib/auth";
import { getValidatedSession } from "@/lib/authValidate";
import { isAdminRole } from "@/lib/roles";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const session = await getValidatedSession(
    cookieStore.get(COOKIE_NAME)?.value,
    cookieStore.get(TOKEN_COOKIE_NAME)?.value,
  );

  if (!session) {
    redirect("/auth/login");
  }

  if (isAdminRole(session.role)) {
    redirect("/payroll?tab=master");
  }

  redirect("/profile?tab=pay");
}
