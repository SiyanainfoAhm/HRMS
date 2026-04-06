import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSessionFromCookie, COOKIE_NAME } from "@/lib/auth";
import { AuthProvider } from "@/contexts/AuthContext";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/lib/supabaseClient";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const session = getSessionFromCookie(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) redirect("/auth/login");

  // Ensure user is associated with a company; if not, go to setup
  const { data: dbUser, error } = await supabase
    .from("HRMS_users")
    .select("id, company_id")
    .eq("id", session.id)
    .maybeSingle();
  if (!error && dbUser && !dbUser.company_id) {
    redirect("/setup/company");
  }

  let companyBranding: { name: string; logoUrl: string | null } | null = null;
  if (dbUser?.company_id) {
    const { data: co } = await supabase
      .from("HRMS_companies")
      .select("name, logo_url")
      .eq("id", dbUser.company_id)
      .maybeSingle();
    if (co) {
      const nm = typeof co.name === "string" ? co.name.trim() : "";
      companyBranding = {
        name: nm || "Company",
        logoUrl: co.logo_url && String(co.logo_url).trim() ? String(co.logo_url).trim() : null,
      };
    }
  }

  return (
    <AuthProvider user={session}>
      <AppShell user={session} companyBranding={companyBranding}>
        {children}
      </AppShell>
    </AuthProvider>
  );
}
