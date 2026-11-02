/**
 * Run: npx --yes tsx src/lib/authRouting.test.ts
 *
 * ERR_TOO_MANY_REDIRECTS: a stale session cookie made the middleware send /auth/login -> /dashboard while the
 * dashboard sent an invalid session back to /auth/login. Follows real redirects with the real middleware,
 * the real session validator (backend /auth/me stubbed), the login-page decision and the clear-cookies route.
 */
import { NextRequest } from "next/server";
import { middleware } from "../middleware";
import { GET as sessionExpired } from "../app/api/auth/session-expired/route";
import { COOKIE_NAME, TOKEN_COOKIE_NAME, createSessionCookie } from "./auth";
import { getValidatedSession } from "./authValidate";
import { SESSION_EXPIRED_PATH, decideLoginPage } from "./authRouting";

function assertEq(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const ORIGIN = "http://localhost:3000";
const user = { id: "u1", email: "admin@cirt", name: "Admin", role: "admin" as const };
let backend: "valid" | "expired" = "valid";
globalThis.fetch = (async (input: RequestInfo | URL) => {
  if (String(input).endsWith("/auth/me")) {
    return backend === "valid"
      ? new Response(JSON.stringify({ user: { ...user } }), { status: 200 })
      : new Response(JSON.stringify({ message: "Unauthenticated." }), { status: 401 });
  }
  return new Response("{}", { status: 200 });
}) as typeof fetch;

type Jar = Record<string, string>;

/** Follows redirects like a browser: middleware, then the page's server-side check. Returns the visited paths. */
async function browse(startPath: string, jar: Jar, maxHops = 10): Promise<{ path: string; hops: string[]; jar: Jar }> {
  let path = startPath;
  const hops: string[] = [];
  for (let i = 0; i < maxHops; i++) {
    hops.push(path);
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
    const req = new NextRequest(`${ORIGIN}${path}`, { headers: cookie ? { cookie } : {} });

    if (path === SESSION_EXPIRED_PATH) {
      const res = await sessionExpired(req);
      for (const c of res.cookies.getAll()) if (c.value === "") delete jar[c.name];
      path = new URL(res.headers.get("location")!).pathname;
      continue;
    }
    if (path.startsWith("/api/")) return { path, hops, jar };

    const mw = middleware(req);
    const loc = mw.headers.get("location");
    if (loc) { path = new URL(loc).pathname; continue; }

    const session = () => getValidatedSession(jar[COOKIE_NAME], jar[TOKEN_COOKIE_NAME]);
    if (path.startsWith("/auth/login")) {
      const d = await decideLoginPage(jar[COOKIE_NAME], jar[TOKEN_COOKIE_NAME]);
      if (d === "redirect-dashboard") { path = "/dashboard"; continue; }
      if (d === "show-login-and-clear") { delete jar[COOKIE_NAME]; delete jar[TOKEN_COOKIE_NAME]; } // ClearStaleSession
      return { path, hops, jar };
    }
    if (path === "/") { path = (await session()) ? "/dashboard" : "/auth/login"; continue; }
    // authenticated pages: (app)/layout and /dashboard validate and send an invalid session to the clear route
    if (!(await session())) { path = SESSION_EXPIRED_PATH; continue; }
    if (path === "/dashboard") { path = "/payroll/master"; continue; }
    return { path, hops, jar };
  }
  throw new Error(`REDIRECT LOOP: ${hops.join(" -> ")}`);
}

const validSession = createSessionCookie(user);
const states: Array<[string, () => Jar, "valid" | "expired"]> = [
  ["no cookie", () => ({}), "valid"],
  ["valid cookie", () => ({ [COOKIE_NAME]: validSession, [TOKEN_COOKIE_NAME]: "tok" }), "valid"],
  ["expired cookie (backend rejects the token)", () => ({ [COOKIE_NAME]: validSession, [TOKEN_COOKIE_NAME]: "tok" }), "expired"],
  ["malformed session cookie", () => ({ [COOKIE_NAME]: "not-a-valid-cookie", [TOKEN_COOKIE_NAME]: "tok" }), "valid"],
  ["garbage everywhere", () => ({ [COOKIE_NAME]: "a.b", [TOKEN_COOKIE_NAME]: "???" }), "expired"],
  ["tampered signature", () => ({ [COOKIE_NAME]: validSession.replace(/.$/, (c) => (c === "0" ? "1" : "0")), [TOKEN_COOKIE_NAME]: "tok" }), "valid"],
  ["session cookie without api token", () => ({ [COOKIE_NAME]: validSession }), "valid"],
  ["api token without session cookie", () => ({ [TOKEN_COOKIE_NAME]: "tok" }), "valid"],
];

(async () => {
  for (const [name, makeJar, be] of states) {
    backend = be;
    const loggedIn = name === "valid cookie";
    for (const start of ["/auth/login", "/dashboard", "/payroll/master", "/"]) {
      const r = await browse(start, makeJar());
      const expected = loggedIn ? "/payroll/master" : "/auth/login";
      assertEq(r.path, expected, `${name}: ${start} ends at (${r.hops.join(" -> ")})`);
      if (r.hops.length > 4) throw new Error(`${name}: ${start} took too many hops: ${r.hops.join(" -> ")}`);
      if (!loggedIn) assertEq(Object.keys(r.jar), [], `${name}: ${start} leaves no stale cookie`);
    }
  }

  // A valid session on the login page redirects exactly once to the dashboard, and never back.
  backend = "valid";
  const once = await browse("/auth/login", { [COOKIE_NAME]: validSession, [TOKEN_COOKIE_NAME]: "tok" });
  assertEq(once.hops, ["/auth/login", "/dashboard", "/payroll/master"], "valid session: one redirect, no ping-pong");

  // The middleware itself never redirects the login page, whatever cookies it carries.
  for (const cookie of ["", `${TOKEN_COOKIE_NAME}=tok`, `${TOKEN_COOKIE_NAME}=tok; ${COOKIE_NAME}=junk`]) {
    const res = middleware(new NextRequest(`${ORIGIN}/auth/login`, { headers: cookie ? { cookie } : {} }));
    assertEq(res.headers.get("location"), null, `middleware must not redirect /auth/login (cookie "${cookie}")`);
  }

  // The clear route empties both cookies and lands on the login page.
  const cleared = await sessionExpired(new NextRequest(`${ORIGIN}${SESSION_EXPIRED_PATH}`));
  assertEq(new URL(cleared.headers.get("location")!).pathname, "/auth/login", "clear route target");
  assertEq(cleared.cookies.getAll().map((c) => `${c.name}=${c.value}`).sort(), [`${COOKIE_NAME}=`, `${TOKEN_COOKIE_NAME}=`].sort(), "both cookies cleared");

  console.log("authRouting.test.ts passed");
})().catch((e) => { console.error(e); process.exit(1); });
