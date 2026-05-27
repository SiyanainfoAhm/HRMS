import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { COOKIE_NAME, TOKEN_COOKIE_NAME } from "@/lib/auth";
import { getValidatedSession } from "@/lib/authValidate";
import { AuthProvider } from "@/contexts/AuthContext";
import { AppShell, type CompanyBranding } from "@/components/AppShell";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

function brandingFromCompany(company: Record<string, unknown> | null | undefined): CompanyBranding | null {
  if (!company) return null;
  const name = String(company.name ?? "").trim();
  const logoUrl =
    (company.logo_url != null && String(company.logo_url)) ||
    (company.logoUrl != null && String(company.logoUrl)) ||
    null;
  if (!name && !logoUrl) return null;
  return { name: name || "Company", logoUrl };
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const session = await getValidatedSession(cookieStore.get(COOKIE_NAME)?.value);
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
        if ((session.role === "super_admin" || session.role === "admin") && !data.company) {
          redirect("/setup/company");
        }
        companyBranding = brandingFromCompany(data.company);
      } else if (res.status === 401) {
        redirect("/auth/login");
      }
    } catch {
      // If API is unreachable, let them through rather than blocking
    }
  } else if (session.role === "super_admin" || session.role === "admin") {
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
