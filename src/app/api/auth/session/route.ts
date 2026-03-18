import { cookies } from "next/headers";
import { getSessionFromCookie, COOKIE_NAME } from "@/lib/auth";

export async function GET() {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME)?.value;
  const session = getSessionFromCookie(cookie);
  if (!session) {
    return Response.json({ user: null });
  }
  return Response.json({ user: session });
}
