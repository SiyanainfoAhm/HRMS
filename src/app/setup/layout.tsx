import { redirect } from "next/navigation";
import { SESSION_EXPIRED_PATH } from "@/lib/authRouting";
import { cookies } from "next/headers";
import { COOKIE_NAME, TOKEN_COOKIE_NAME } from "@/lib/auth";
import { getValidatedSession } from "@/lib/authValidate";

export default async function SetupLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const session = await getValidatedSession(
    cookieStore.get(COOKIE_NAME)?.value,
    cookieStore.get(TOKEN_COOKIE_NAME)?.value,
  );
  if (!session) redirect(SESSION_EXPIRED_PATH);
  return <>{children}</>;
}

