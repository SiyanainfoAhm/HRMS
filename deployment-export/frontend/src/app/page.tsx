import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, TOKEN_COOKIE_NAME } from "@/lib/auth";
import { getValidatedSession } from "@/lib/authValidate";

/** Root URL: dashboard when signed in, otherwise login (no public landing page). */
export default async function HomePage() {
  const cookieStore = await cookies();
  const session = await getValidatedSession(
    cookieStore.get(COOKIE_NAME)?.value,
    cookieStore.get(TOKEN_COOKIE_NAME)?.value,
  );

  redirect(session ? "/dashboard" : "/auth/login");
}
