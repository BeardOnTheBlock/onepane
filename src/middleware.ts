// ============================================================================
// Route protection (multi-user hosted app).
//
// This is a self-contained, Edge-safe middleware: it checks for the presence of
// NextAuth's session cookie rather than importing `@/lib/auth` (whose `jwt`
// callback pulls in Prisma, which cannot run in the Edge middleware runtime).
// The cookie is httpOnly and signed/encrypted by NextAuth, so an unauthenticated
// request simply won't have it. Routes that mutate or read user data still do a
// real session lookup server-side (see lib/session.ts) — this layer is the
// coarse "are you logged in at all?" gate.
//
//   - No session + page request    -> redirect to /login (with ?callbackUrl).
//   - No session + /api/* request   -> 401 JSON (never an HTML redirect).
//
// Public (no auth required): /login, /api/auth/* (the NextAuth endpoints), and
// Next internals / static assets (handled both here and by the matcher, which
// already excludes _next/static, _next/image, favicon).
// ============================================================================

import { NextResponse, type NextRequest } from "next/server";

/**
 * NextAuth v5 session cookie name. It is host-prefixed with `__Secure-` when the
 * app is served over HTTPS (production), and unprefixed in local dev (http).
 */
const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
];

/** Paths that must be reachable without a session. */
function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  );
}

/** True when the request carries a (non-empty) NextAuth session cookie. */
function hasSessionCookie(req: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some((name) => {
    const value = req.cookies.get(name)?.value;
    return typeof value === "string" && value.length > 0;
  });
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl;

  // Public routes pass straight through.
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Authenticated requests pass through.
  if (hasSessionCookie(req)) {
    return NextResponse.next();
  }

  // Unauthenticated: API calls get a clean 401; page loads go to /login.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", req.nextUrl.origin);
  // Preserve where the user was headed so we can bounce them back post-login.
  loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Run on everything except Next's static output and the favicon. The function
  // above still allow-lists /login and /api/auth/* explicitly.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
