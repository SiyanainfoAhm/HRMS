import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { COOKIE_NAME, TOKEN_COOKIE_NAME } from "@/lib/auth";
import { getValidatedSession } from "@/lib/authValidate";
import { AuthProvider } from "@/contexts/AuthContext";
import { AppShell } from "@/components/AppShell";
import { FIXED_ORG_BRANDING } from "@/lib/appBranding";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const session = await getValidatedSession(
    cookieStore.get(COOKIE_NAME)?.value,
    cookieStore.get(TOKEN_COOKIE_NAME)?.value,
  );
  if (!session) redirect("/auth/login");

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
