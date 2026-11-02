/**
 * Run: npx --yes tsx src/lib/authRouting.test.ts
 *
 * ERR_TOO_MANY_REDIRECTS: a stale cookie made the middleware send /auth/login -> /dashboard while the dashboard sent
 * an invalid session back to /auth/login. This test browses like a browser: real middleware, real session checker
 * (backend /auth/me stubbed), the real login-page and guard decisions, and the real clear-cookies route.
 */
import { NextRequest } from "next/server";
import { middleware } from "../middleware";
import { GET as sessionExpired } from "../app/api/auth/session-expired/route";
import { COOKIE_NAME, TOKEN_COOKIE_NAME, createSessionCookie } from "./auth";
import { checkSession, type SessionCheck } from "./sessionCheck";
import { SESSION_EXPIRED_PATH, decideGuard, decideLoginPage, loggedOutTarget } from "./authRouting";
import { clearLegacyAuthStorage } from "./clientAuthStorage";

function assertEq(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const ORIGIN = "http://localhost:3000";
const user = { id: "a3088fdb-bb19-41b6-8051-db65e4672cde", email: "admin@cirt", name: "Admin User", role: "admin" as const, sv: 0 };

/** What the backend does for /auth/me in each scenario. */
type Backend = "valid" | "expired-401" | "forbidden-403" | "deleted-user-404" | "other-user" | "down-throw" | "down-503" | "bad-json" | "limited-429" | "timeout";
let backend: Backend = "valid";
globalThis.fetch = (async (input: RequestInfo | URL) => {
  if (!String(input).endsWith("/auth/me")) return new Response("{}", { status: 200 });
  switch (backend) {
    case "valid": return new Response(JSON.stringify({ user }), { status: 200 });
    case "other-user": return new Response(JSON.stringify({ user: { ...user, id: "someone-else" } }), { status: 200 });
    case "expired-401": return new Response(JSON.stringify({ message: "Unauthenticated." }), { status: 401 });
    case "forbidden-403": return new Response("{}", { status: 403 });
    case "deleted-user-404": return new Response("{}", { status: 404 });
    case "down-503": return new Response("bad gateway", { status: 503 });
    case "limited-429": return new Response("{}", { status: 429 });
    case "bad-json": return new Response("<html>tunnel error</html>", { status: 200 });
    case "down-throw": throw new TypeError("fetch failed");
    case "timeout": throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  }
}) as typeof fetch;

type Jar = Record<string, string>;
type Page = { path: string; hops: string[]; jar: Jar; shown: "login" | "app" | "error-page"; loginNotice: boolean };

/**
 * Follows redirects like a browser. `canClear=false` simulates a browser that ignores Set-Cookie deletions
 * (the worst case for a loop). Returns the page finally shown.
 */
async function browse(startPath: string, jar: Jar, opts: { canClear?: boolean; maxHops?: number } = {}): Promise<Page> {
  const canClear = opts.canClear ?? true;
  let path = startPath;
  const hops: string[] = [];
  for (let i = 0; i < (opts.maxHops ?? 12); i++) {
    hops.push(path);
    const url = new URL(path, ORIGIN);
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
    const req = new NextRequest(url, { headers: cookie ? { cookie } : {} });

    if (url.pathname === SESSION_EXPIRED_PATH) {
      const res = await sessionExpired(req);
      if (canClear) for (const c of res.cookies.getAll()) if (c.value === "") delete jar[c.name];
      path = res.headers.get("location")!.replace(ORIGIN, "");
      continue;
    }

    const mw = middleware(req);
    const loc = mw.headers.get("location");
    if (loc) { path = loc.replace(ORIGIN, ""); continue; }
    const capped = mw.headers.get("x-middleware-request-x-auth-cap") === "1";

    const check = await checkSession(jar[COOKIE_NAME], jar[TOKEN_COOKIE_NAME]);
    if (url.pathname.startsWith("/auth/login")) {
      const d = decideLoginPage(check, capped);
      if (d === "redirect-dashboard") { path = "/dashboard"; continue; }
      if (d === "show-login-and-clear" && canClear) { delete jar[COOKIE_NAME]; delete jar[TOKEN_COOKIE_NAME]; } // ClearStaleSession
      return { path, hops, jar, shown: "login", loginNotice: d === "show-login-backend-down" };
    }
    if (url.pathname === "/") {
      if (check.state === "unreachable") return { path, hops, jar, shown: "error-page", loginNotice: false };
      path = check.state === "valid" ? "/dashboard" : loggedOutTarget(check);
      continue;
    }
    const g = decideGuard(check);
    if (g === "unavailable") return { path, hops, jar, shown: "error-page", loginNotice: false };
    if (g === "redirect-expired") { path = loggedOutTarget(check); continue; }
    if (url.pathname === "/dashboard") { path = "/payroll/master"; continue; }
    return { path, hops, jar, shown: "app", loginNotice: false };
  }
  throw new Error(`REDIRECT LOOP (${opts.maxHops ?? 12} hops): ${hops.join(" -> ")}`);
}

// ---- cookies as created by the CURRENTLY DEPLOYED (old) version: frozen from commit d71e753's auth.ts ----
const OLD_DEPLOYED_SESSION =
  "eyJpZCI6ImEzMDg4ZmRiLWJiMTktNDFiNi04MDUxLWRiNjVlNDY3MmNkZSIsImVtYWlsIjoiYWRtaW5AY2lydCIsIm5hbWUiOiJBZG1pbiBVc2VyIiwicm9sZSI6ImFkbWluIiwic3YiOjB9.acefbf431304d589bb4cde8367c97b108771b657d6ac005e85affd7dde7dc29e";
const OLD_ROLE_HR_NO_SV = "eyJpZCI6InUtb2xkIiwiZW1haWwiOiJvbGRAY2lydCIsIm5hbWUiOm51bGwsInJvbGUiOiJociJ9.b2e6e479b61b4cb1dd531415c07cf15267c2197037d9b0c7fed3ff53d6067e10";

(async () => {
  // 0. The cookie format has not changed: today's code produces the same bytes the deployed version did.
  assertEq(createSessionCookie(user), OLD_DEPLOYED_SESSION, "session cookie format is unchanged since the deployed version");

  const validSession = createSessionCookie(user);
  const mk = (session?: string, token?: string): Jar => ({ ...(session ? { [COOKIE_NAME]: session } : {}), ...(token ? { [TOKEN_COOKIE_NAME]: token } : {}) });

  // 1. Every scenario x every entry URL: ends on the right page, short, no stale cookies, never a loop.
  type Case = { name: string; jar: () => Jar; backend: Backend; expect: "login" | "app" };
  const cases: Case[] = [
    { name: "no cookie", jar: () => ({}), backend: "valid", expect: "login" },
    { name: "valid cookie", jar: () => mk(validSession, "1|tok"), backend: "valid", expect: "app" },
    { name: "valid cookie created by the deployed (old) version", jar: () => mk(OLD_DEPLOYED_SESSION, "1|tok"), backend: "valid", expect: "app" },
    { name: "expired token (backend 401)", jar: () => mk(validSession, "1|tok"), backend: "expired-401", expect: "login" },
    { name: "token rejected (backend 403)", jar: () => mk(validSession, "1|tok"), backend: "forbidden-403", expect: "login" },
    { name: "token for a deleted user (backend 404)", jar: () => mk(validSession, "1|tok"), backend: "deleted-user-404", expect: "login" },
    { name: "token belongs to another user (cookies out of sync)", jar: () => mk(validSession, "1|tok"), backend: "other-user", expect: "login" },
    { name: "malformed session cookie", jar: () => mk("not-a-valid-cookie", "1|tok"), backend: "valid", expect: "login" },
    { name: "garbage in both cookies", jar: () => mk("a.b", "???"), backend: "expired-401", expect: "login" },
    { name: "tampered signature", jar: () => mk(validSession.replace(/.$/, (c) => (c === "0" ? "1" : "0")), "1|tok"), backend: "valid", expect: "login" },
    { name: "old session cookie with no API token (from before the token cookie existed)", jar: () => mk(OLD_DEPLOYED_SESSION), backend: "valid", expect: "login" },
    { name: "API token without a session cookie", jar: () => mk(undefined, "1|tok"), backend: "valid", expect: "login" },
    { name: "role value from an older release, no sv", jar: () => mk(OLD_ROLE_HR_NO_SV, "1|tok"), backend: "expired-401", expect: "login" },
  ];
  for (const c of cases) {
    backend = c.backend;
    for (const start of ["/auth/login", "/dashboard", "/payroll/master", "/"]) {
      const r = await browse(start, c.jar());
      assertEq(r.shown, c.expect, `${c.name}: ${start} -> ${r.hops.join(" -> ")}`);
      if (r.hops.length > 5) throw new Error(`${c.name}: ${start} took too many hops: ${r.hops.join(" -> ")}`);
      if (c.expect === "login") assertEq(Object.keys(r.jar), [], `${c.name}: ${start} leaves no stale cookie`);
    }
  }

  // 2. Backend unreachable: an error page (or the login form with a notice), NEVER a redirect, and the session is kept.
  for (const be of ["down-throw", "down-503", "timeout", "bad-json", "limited-429"] as Backend[]) {
    backend = be;
    for (const start of ["/dashboard", "/payroll/master", "/"]) {
      const jar = mk(validSession, "1|tok");
      const r = await browse(start, jar);
      assertEq(r.shown, "error-page", `backend ${be}: ${start}`);
      assertEq(r.hops, [start], `backend ${be}: ${start} is not redirected anywhere`);
      assertEq(Object.keys(jar).sort(), [COOKIE_NAME, TOKEN_COOKIE_NAME].sort(), `backend ${be}: session is not cleared`);
    }
    const login = await browse("/auth/login", mk(validSession, "1|tok"));
    assertEq([login.shown, login.loginNotice, login.hops], ["login", true, ["/auth/login"]], `backend ${be}: login page shows a notice, no redirect`);
    assertEq(Object.keys(login.jar).length, 2, `backend ${be}: login page keeps the cookies`);
  }

  // 3. Valid session on the login page: exactly one redirect to the dashboard, and the guard never sends it back.
  backend = "valid";
  const once = await browse("/auth/login", mk(validSession, "1|tok"));
  assertEq(once.hops, ["/auth/login", "/dashboard", "/payroll/master"], "valid session: one redirect, no ping-pong");

  // 4. Redirect cap: even when the browser refuses to delete cookies, it ends on the login page and does not loop.
  for (const be of ["expired-401", "deleted-user-404"] as Backend[]) {
    backend = be;
    for (const start of ["/auth/login", "/dashboard", "/payroll/master", "/"]) {
      const r = await browse(start, mk(validSession, "1|tok"), { canClear: false });
      assertEq(r.shown, "login", `cookies undeletable (${be}): ${start} -> ${r.hops.join(" -> ")}`);
      if (r.hops.length > 5) throw new Error(`cap failed: ${r.hops.join(" -> ")}`);
    }
  }
  // ...and a flagged login visit never redirects, even if the session looks valid at that instant (backend flapped).
  backend = "valid";
  const flagged = await browse("/auth/login?expired=1", mk(validSession, "1|tok"));
  assertEq([flagged.shown, flagged.hops], ["login", ["/auth/login?expired=1"]], "?expired=1 is the cap: the login page does not redirect");
  const flagged2 = await browse("/auth/login?loop=1", mk(validSession, "1|tok"));
  assertEq([flagged2.shown, flagged2.hops], ["login", ["/auth/login?loop=1"]], "?loop=1 is the cap");

  // 5. The session checker's verdicts.
  const verdict = async (s: string | undefined, t: string | undefined, be: Backend): Promise<string> => {
    backend = be;
    const c: SessionCheck = await checkSession(s, t);
    return c.state === "logged-out" ? `logged-out:${c.reason}` : c.state;
  };
  assertEq(await verdict(undefined, undefined, "valid"), "logged-out:missing", "no cookies");
  assertEq(await verdict(validSession, undefined, "valid"), "logged-out:incomplete", "session only");
  assertEq(await verdict(undefined, "t", "valid"), "logged-out:incomplete", "token only");
  assertEq(await verdict("zzz.zzz", "t", "valid"), "logged-out:malformed", "malformed");
  assertEq(await verdict(validSession, "t", "expired-401"), "logged-out:rejected", "expired");
  assertEq(await verdict(validSession, "t", "deleted-user-404"), "logged-out:rejected", "deleted user");
  assertEq(await verdict(validSession, "t", "other-user"), "logged-out:mismatch", "token of another user");
  assertEq(await verdict(validSession, "t", "valid"), "valid", "valid");
  assertEq(await verdict(OLD_DEPLOYED_SESSION, "t", "valid"), "valid", "valid cookie from the deployed version");
  assertEq(await verdict(validSession, "t", "down-503"), "unreachable", "503");
  assertEq(await verdict(validSession, "t", "timeout"), "unreachable", "timeout");

  // 6. The middleware itself never decides about /auth/login from cookie presence.
  for (const cookie of ["", `${TOKEN_COOKIE_NAME}=tok`, `${TOKEN_COOKIE_NAME}=tok; ${COOKIE_NAME}=junk`]) {
    const res = middleware(new NextRequest(`${ORIGIN}/auth/login`, { headers: cookie ? { cookie } : {} }));
    assertEq(res.headers.get("location"), null, `middleware must not redirect /auth/login (cookie "${cookie}")`);
  }

  // 7. The clear route empties both cookies and lands on a login page that does not redirect.
  const cleared = await sessionExpired(new NextRequest(`${ORIGIN}${SESSION_EXPIRED_PATH}`));
  assertEq(cleared.headers.get("location"), `${ORIGIN}/auth/login?expired=1`, "clear route target");
  assertEq(cleared.cookies.getAll().map((c) => `${c.name}=${c.value}`).sort(), [`${COOKIE_NAME}=`, `${TOKEN_COOKIE_NAME}=`].sort(), "both cookies cleared");

  // 8. Browser storage out of sync with the cookies: the legacy token key is dropped, unrelated keys stay.
  const store = new Map<string, string>([["hrms_token", "old-token"], ["hrms.sidebarCollapsed", "1"]]);
  const fake = { removeItem: (k: string) => void store.delete(k) };
  clearLegacyAuthStorage(fake, fake);
  assertEq([...store.keys()], ["hrms.sidebarCollapsed"], "legacy hrms_token removed, preferences kept");
  clearLegacyAuthStorage({ removeItem() { throw new Error("blocked"); } }, fake); // blocked storage must not throw

  console.log("authRouting.test.ts passed");
})().catch((e) => { console.error(e); process.exit(1); });
