// GET /api/connect/[provider]/callback?code&state
// Completes the OAuth flow: verifies the anti-CSRF state cookie, exchanges the
// authorization code for tokens, loads the account profile, persists the
// account, clears the state cookie, and redirects to
// /settings?connected=EMAIL (or ?error=MSG on any failure).

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { upsertAccount } from "@/lib/accounts";
import { ALL_PROVIDERS } from "@/lib/config";
import { exchangeCodeForTokens, fetchProfile } from "@/lib/oauth";
import type { ProviderId } from "@/lib/types";

import { OAUTH_STATE_COOKIE } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isProviderId(value: string): value is ProviderId {
  return (ALL_PROVIDERS as string[]).includes(value);
}

function settingsRedirect(
  req: Request,
  params: Record<string, string>,
): NextResponse {
  const url = new URL("/settings", req.url);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  const { provider } = await params;
  const cookieStore = await cookies();

  // Always clear the one-time state cookie, whatever the outcome.
  const clearState = () => cookieStore.delete(OAUTH_STATE_COOKIE);

  if (!isProviderId(provider)) {
    clearState();
    return settingsRedirect(req, { error: `Unknown provider: ${provider}` });
  }

  const { searchParams } = new URL(req.url);

  // The provider may report its own error (e.g. user denied consent).
  const providerError = searchParams.get("error");
  if (providerError) {
    clearState();
    const description =
      searchParams.get("error_description") ?? providerError;
    return settingsRedirect(req, { error: description });
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const expectedState = cookieStore.get(OAUTH_STATE_COOKIE)?.value;

  if (!code) {
    clearState();
    return settingsRedirect(req, { error: "Missing authorization code." });
  }

  if (!state || !expectedState || state !== expectedState) {
    clearState();
    return settingsRedirect(req, { error: "Invalid state" });
  }

  try {
    const tokens = await exchangeCodeForTokens(provider, code);
    const profile = await fetchProfile(provider, tokens.accessToken);

    await upsertAccount({
      provider,
      email: profile.email,
      displayName: profile.displayName,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiry: tokens.expiry,
      scopes: tokens.scope,
      canTeams: profile.canTeams,
      canMeet: profile.canMeet,
    });

    clearState();
    return settingsRedirect(req, { connected: profile.email });
  } catch (err) {
    clearState();
    const message =
      err instanceof Error ? err.message : "Failed to connect account.";
    // settingsRedirect uses URLSearchParams.set, which percent-encodes the
    // value for us — passing the raw message avoids double-encoding.
    return settingsRedirect(req, { error: message });
  }
}
