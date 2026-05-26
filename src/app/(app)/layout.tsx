import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { COOKIE_NAME, TOKEN_COOKIE_NAME } from "@/lib/auth";
import { getValidatedSession } from "@/lib/authValidate";
import { AuthProvider } from "@/contexts/AuthContext";
import { AppShell } from "@/components/AppShell";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const session = await getValidatedSession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) redirect("/auth/login");

  if (session.role === "super_admin" || session.role === "admin") {
    const token = cookieStore.get(TOKEN_COOKIE_NAME)?.value;
    if (!token) {
      redirect("/auth/login");
    }
    try {
      const res = await fetch(`${API_BASE}/company/me`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        if (!data.company) {
          redirect("/setup/company");
        }
      } else if (res.status === 401) {
        redirect("/auth/login");
      }
    } catch {
      // If API is unreachable, let them through rather than blocking
    }
  }

  return (
    <AuthProvider user={session}>
      <AppShell user={session} companyBranding={null}>
        {children}
      </AppShell>
    </AuthProvider>
  );
}
