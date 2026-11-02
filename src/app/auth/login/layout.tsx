import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { COOKIE_NAME, TOKEN_COOKIE_NAME } from "@/lib/auth";
import { decideLoginPage } from "@/lib/authRouting";
import { ClearStaleSession } from "@/components/ClearStaleSession";

/** Validates the session on the server: valid -> one redirect to the dashboard; stale -> login form, cookies cleared. */
export default async function LoginLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const decision = await decideLoginPage(
    cookieStore.get(COOKIE_NAME)?.value,
    cookieStore.get(TOKEN_COOKIE_NAME)?.value,
  );
  if (decision === "redirect-dashboard") redirect("/dashboard");
  return (
    <>
      {decision === "show-login-and-clear" ? <ClearStaleSession /> : null}
      {children}
    </>
  );
}
