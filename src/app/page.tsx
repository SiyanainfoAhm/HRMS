import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, TOKEN_COOKIE_NAME } from "@/lib/auth";
import { loggedOutTarget } from "@/lib/authRouting";
import { checkSession } from "@/lib/sessionCheck";
import { BackendUnavailable } from "@/components/BackendUnavailable";

/** Root URL: dashboard when signed in, otherwise login (no public landing page). */
export default async function HomePage() {
  const cookieStore = await cookies();
  const check = await checkSession(cookieStore.get(COOKIE_NAME)?.value, cookieStore.get(TOKEN_COOKIE_NAME)?.value);
  if (check.state === "unreachable") return <BackendUnavailable />;
  redirect(check.state === "valid" ? "/dashboard" : loggedOutTarget(check));
}
