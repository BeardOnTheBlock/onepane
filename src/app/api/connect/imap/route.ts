// POST /api/connect/imap
// Connects a generic IMAP/SMTP (+ optional CalDAV) account using a username +
// (app) password rather than OAuth. The request body carries the full server
// configuration; we VERIFY the IMAP login by actually opening a connection
// against the user's server before persisting anything, so a typo'd host or a
// bad password fails fast with an actionable 400 (rather than being discovered
// later on the first inbox load).
//
// On success the credentials are serialised into a JSON blob and stored in the
// account's token field (upsertAccount encrypts it for us). The token never
// "expires" the way an OAuth token does, so we record a far-future expiry to
// keep getValidAccessToken's freshness check happy.
//
// SERVER-ONLY (nodejs runtime — imapflow opens raw TCP/TLS sockets).

import { ImapFlow } from "imapflow";
import { NextResponse } from "next/server";

import { upsertAccount } from "@/lib/accounts";
import { serializeImapCredentials } from "@/lib/imap-credentials";
import { requireUserId } from "@/lib/session";
import type { ImapCredentials } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sensible defaults so a user only has to supply what differs from the norm.
const DEFAULT_IMAP_PORT = 993;
const DEFAULT_IMAP_SECURE = true; // implicit TLS on 993
const DEFAULT_SMTP_PORT = 587;
const DEFAULT_SMTP_SECURE = false; // STARTTLS on 587 (true = implicit TLS, e.g. 465)

// Mirror the hard caps the provider uses so a misbehaving/unreachable server
// can never hang this request indefinitely while we verify the login.
const CONNECTION_TIMEOUT_MS = 20_000;
const GREETING_TIMEOUT_MS = 16_000;
const SOCKET_TIMEOUT_MS = 60_000;

/** A non-empty trimmed string, or null when the value isn't a usable string. */
function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Coerces an incoming port to a finite integer in the valid TCP range, falling
 * back to `fallback` when the value is missing/blank, and returning null when a
 * value was supplied but is not a valid port (so the caller can 400).
 */
function coercePort(value: unknown, fallback: number): number | null {
  if (value === undefined || value === null || value === "") return fallback;
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
  return n;
}

/**
 * Coerces an incoming "secure" flag to a boolean. Accepts real booleans and the
 * common string forms ("true"/"false"); falls back to `fallback` when omitted.
 * Returns null for anything else so an obviously-wrong value 400s.
 */
function coerceSecure(value: unknown, fallback: boolean): boolean | null {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true") return true;
    if (v === "false") return false;
  }
  return null;
}

function badRequest(error: string): NextResponse {
  return NextResponse.json({ error }, { status: 400 });
}

/** Verifies the IMAP credentials by connecting and logging straight back out. */
async function verifyImapLogin(creds: ImapCredentials): Promise<void> {
  const client = new ImapFlow({
    host: creds.imapHost,
    port: creds.imapPort,
    secure: creds.imapSecure,
    auth: { user: creds.username, pass: creds.password },
    logger: false,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  });

  // Without an 'error' listener a mid-flight socket error would bubble up as an
  // unhandled exception and could crash the dev server; swallow it (the awaited
  // connect/logout below rejects on its own).
  client.on("error", () => {
    /* surfaced through the awaited connect()/logout() */
  });

  await client.connect();
  try {
    // connect() already authenticated; nothing else to do — just hang up.
  } finally {
    try {
      await client.logout();
    } catch {
      try {
        client.close();
      } catch {
        /* already closed */
      }
    }
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  // ---- Require a signed-in user -----------------------------------------
  // The verified mailbox is attached to the session user; no session => 401.
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // ---- Parse body --------------------------------------------------------
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid request body.");
  }
  if (typeof body !== "object" || body === null) {
    return badRequest("Invalid request body.");
  }
  const input = body as Record<string, unknown>;

  // ---- Validate required strings ----------------------------------------
  const email = asNonEmptyString(input.email);
  const imapHost = asNonEmptyString(input.imapHost);
  const smtpHost = asNonEmptyString(input.smtpHost);
  const username = asNonEmptyString(input.username);
  const password =
    typeof input.password === "string" && input.password.length > 0
      ? input.password // never trim a password
      : null;
  const caldavUrl = asNonEmptyString(input.caldavUrl);

  if (!email) return badRequest("Email is required.");
  if (!imapHost) return badRequest("IMAP host is required.");
  if (!smtpHost) return badRequest("SMTP host is required.");
  if (!username) return badRequest("Username is required.");
  if (!password) return badRequest("Password is required.");

  // ---- Coerce ports + secure flags --------------------------------------
  const imapPort = coercePort(input.imapPort, DEFAULT_IMAP_PORT);
  if (imapPort === null) return badRequest("IMAP port is invalid.");
  const smtpPort = coercePort(input.smtpPort, DEFAULT_SMTP_PORT);
  if (smtpPort === null) return badRequest("SMTP port is invalid.");

  const imapSecure = coerceSecure(input.imapSecure, DEFAULT_IMAP_SECURE);
  if (imapSecure === null) return badRequest("IMAP secure flag is invalid.");
  const smtpSecure = coerceSecure(input.smtpSecure, DEFAULT_SMTP_SECURE);
  if (smtpSecure === null) return badRequest("SMTP secure flag is invalid.");

  const creds: ImapCredentials = {
    imapHost,
    imapPort,
    imapSecure,
    smtpHost,
    smtpPort,
    smtpSecure,
    username,
    password,
    ...(caldavUrl ? { caldavUrl } : {}),
  };

  // ---- Verify the login before persisting anything ----------------------
  try {
    await verifyImapLogin(creds);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "could not reach the server.";
    return badRequest(`Couldn't connect: ${message}`);
  }

  // ---- Persist ----------------------------------------------------------
  try {
    // IMAP/app-password "tokens" don't expire like OAuth tokens, so we record a
    // far-future expiry (year 9999) to satisfy the token-freshness check.
    const farFutureExpiry = new Date("9999-12-31T23:59:59.999Z");

    await upsertAccount({
      userId,
      provider: "imap",
      email,
      displayName: email,
      accessToken: serializeImapCredentials(creds),
      refreshToken: null,
      tokenExpiry: farFutureExpiry,
      scopes: "",
      canTeams: false,
      canMeet: false,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    // Persistence (DB/encryption) failure — distinct from a bad-input 400.
    const message =
      err instanceof Error ? err.message : "Failed to save the account.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
