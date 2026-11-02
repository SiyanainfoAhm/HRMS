import { redirect } from "next/navigation";
import { decideGuard, loggedOutTarget } from "@/lib/authRouting";
import { checkSession } from "@/lib/sessionCheck";
import { BackendUnavailable } from "@/components/BackendUnavailable";
import { cookies } from "next/headers";
import { COOKIE_NAME, TOKEN_COOKIE_NAME } from "@/lib/auth";
import { AuthProvider } from "@/contexts/AuthContext";
import { AppShell } from "@/components/AppShell";
import { FIXED_ORG_BRANDING } from "@/lib/appBranding";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const check = await checkSession(cookieStore.get(COOKIE_NAME)?.value, cookieStore.get(TOKEN_COOKIE_NAME)?.value);
  const decision = decideGuard(check);
  if (decision === "unavailable") return <BackendUnavailable />;
  if (decision === "redirect-expired") redirect(loggedOutTarget(check));
  if (check.state !== "valid") return <BackendUnavailable />;
  const session = check.session;

  const companyBranding = {
    name: FIXED_ORG_BRANDING.organization,
    application: FIXED_ORG_BRANDING.application,
  };

  return (
    <AuthProvider user={session}>
      <AppShell user={session} companyBranding={companyBranding}>
        {children}
      </AppShell>
    </AuthProvider>
  );
}
