import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { COOKIE_NAME, TOKEN_COOKIE_NAME } from "@/lib/auth";
import { getValidatedSession } from "@/lib/authValidate";
import { isAdminRole } from "@/lib/roles";
import { AuthProvider } from "@/contexts/AuthContext";
import { AppShell, type CompanyBranding } from "@/components/AppShell";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

function brandingFromCompany(company: Record<string, unknown> | null | undefined): CompanyBranding | null {
  if (!company) return null;
  const name = String(company.name ?? "").trim();
  if (!name) return null;
  return { name };
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const session = await getValidatedSession(
    cookieStore.get(COOKIE_NAME)?.value,
    cookieStore.get(TOKEN_COOKIE_NAME)?.value,
  );
  if (!session) redirect("/auth/login");

  const token = cookieStore.get(TOKEN_COOKIE_NAME)?.value;
  let companyBranding: CompanyBranding | null = null;

  if (token) {
    try {
      const res = await fetch(`${API_BASE}/company/me`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        if (isAdminRole(session.role) && !data.company) {
          redirect("/setup/company");
        }
        companyBranding = brandingFromCompany(data.company);
      } else if (res.status === 401) {
        redirect("/auth/login");
      }
    } catch {
      // If API is unreachable, let them through rather than blocking
    }
  } else if (isAdminRole(session.role)) {
    redirect("/auth/login");
  }

  return (
    <AuthProvider user={session}>
      <AppShell user={session} companyBranding={companyBranding}>
        {children}
      </AppShell>
    </AuthProvider>
  );
}
