import { redirect } from "next/navigation";
import { decideGuard, loggedOutTarget } from "@/lib/authRouting";
import { checkSession } from "@/lib/sessionCheck";
import { BackendUnavailable } from "@/components/BackendUnavailable";
import { cookies } from "next/headers";
import { COOKIE_NAME, TOKEN_COOKIE_NAME } from "@/lib/auth";

export default async function SetupLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const check = await checkSession(cookieStore.get(COOKIE_NAME)?.value, cookieStore.get(TOKEN_COOKIE_NAME)?.value);
  const decision = decideGuard(check);
  if (decision === "redirect-expired") redirect(loggedOutTarget(check));
  if (decision === "unavailable") return <BackendUnavailable />;
  return <>{children}</>;
}

