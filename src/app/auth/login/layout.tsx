import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { COOKIE_NAME, TOKEN_COOKIE_NAME } from "@/lib/auth";
import { decideLoginPage } from "@/lib/authRouting";
import { checkSession } from "@/lib/sessionCheck";
import { ClearStaleSession } from "@/components/ClearStaleSession";

/**
 * Login page guard. The decision comes from the validated session, never from cookie presence:
 * valid -> one redirect to the dashboard; stale -> the form with the cookies cleared; backend down -> the form + notice.
 */
export default async function LoginLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const capped = (await headers()).get("x-auth-cap") === "1";
  const check = await checkSession(cookieStore.get(COOKIE_NAME)?.value, cookieStore.get(TOKEN_COOKIE_NAME)?.value);
  const decision = decideLoginPage(check, capped);
  if (decision === "redirect-dashboard") redirect("/dashboard");
  return (
    <>
      {decision === "show-login-and-clear" ? <ClearStaleSession /> : null}
      {decision === "show-login-backend-down" ? (
        <p role="alert" className="mx-auto mt-4 max-w-md rounded-lg bg-amber-50 p-3 text-center text-sm text-amber-900">
          The payroll server is not reachable right now. You can sign in again once it is back.
        </p>
      ) : null}
      {children}
    </>
  );
}
