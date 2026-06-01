// ============================================================================
// OAuth 2.0 authorization-code flow + token lifecycle.
// Handles building the consent URL, exchanging the code for tokens, fetching
// the account's profile (email/name/capabilities), and transparently
// refreshing expired access tokens.
// ============================================================================

import { getProviderConfig } from "@/lib/config";
import { updateAccountTokens } from "@/lib/accounts";
import type { AccountWithTokens, ProviderId } from "@/lib/types";

// Refresh a little before the real expiry to avoid edge-of-expiry failures.
const EXPIRY_SKEW_MS = 60_000;

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number; // seconds
  scope?: string;
  token_type: string;
  id_token?: string;
}

export interface ExchangedTokens {
  accessToken: string;
  refreshToken: string | null;
  expiry: Date;
  scope: string;
}

export interface ConnectedProfile {
  email: string;
  displayName: string | null;
  canTeams: boolean;
  canMeet: boolean;
}

/** Builds the provider consent URL the user is redirected to. */
export function buildAuthUrl(provider: ProviderId, state: string): string {
  const cfg = getProviderConfig(provider);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: cfg.scopes.join(" "),
    state,
  });

  if (provider === "google") {
    // Required to receive a refresh token from Google every time.
    params.set("access_type", "offline");
    params.set("prompt", "consent");
    params.set("include_granted_scopes", "true");
  } else {
    // Microsoft returns a refresh token whenever offline_access is requested.
    params.set("response_mode", "query");
    params.set("prompt", "select_account");
  }

  return `${cfg.authUrl}?${params.toString()}`;
}

/** Exchanges an authorization code for access + refresh tokens. */
export async function exchangeCodeForTokens(
  provider: ProviderId,
  code: string,
): Promise<ExchangedTokens> {
  const cfg = getProviderConfig(provider);
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: cfg.redirectUri,
  });

  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(
      `Token exchange failed (${res.status}): ${await safeText(res)}`,
    );
  }
  const json = (await res.json()) as TokenResponse;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiry: new Date(Date.now() + json.expires_in * 1000),
    scope: json.scope ?? cfg.scopes.join(" "),
  };
}

/**
 * Fetches the connected account's profile + capabilities.
 * - email/name identify the account in the UI.
 * - canMeet: every Google account can create Meet links.
 * - canTeams: Microsoft work/school accounts (not personal outlook.com) can
 *   host Teams meetings. We detect this from the Graph organization endpoint.
 */
export async function fetchProfile(
  provider: ProviderId,
  accessToken: string,
): Promise<ConnectedProfile> {
  if (provider === "google") {
    const res = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      throw new Error(`Failed to load Google profile: ${await safeText(res)}`);
    }
    const json = (await res.json()) as { email?: string; name?: string };
    if (!json.email) throw new Error("Google profile did not include an email.");
    return {
      email: json.email,
      displayName: json.name ?? null,
      canTeams: false,
      canMeet: true,
    };
  }

  // Microsoft Graph
  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to load Microsoft profile: ${await safeText(res)}`);
  }
  const json = (await res.json()) as {
    mail?: string;
    userPrincipalName?: string;
    displayName?: string;
  };
  const email = json.mail ?? json.userPrincipalName;
  if (!email) throw new Error("Microsoft profile did not include an email.");

  // Teams meetings require a work/school account. Probing the organization
  // endpoint succeeds for those and 403/404s for personal accounts.
  let canTeams = false;
  try {
    const orgRes = await fetch(
      "https://graph.microsoft.com/v1.0/organization?$select=id",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (orgRes.ok) {
      const org = (await orgRes.json()) as { value?: unknown[] };
      canTeams = Array.isArray(org.value) && org.value.length > 0;
    }
  } catch {
    canTeams = false;
  }

  return {
    email,
    displayName: json.displayName ?? null,
    canTeams,
    canMeet: false,
  };
}

/** Refreshes an access token using the stored refresh token. */
async function refreshAccessToken(
  provider: ProviderId,
  refreshToken: string,
): Promise<ExchangedTokens> {
  const cfg = getProviderConfig(provider);
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  // Microsoft requires the scope on refresh.
  if (provider === "microsoft") body.set("scope", cfg.scopes.join(" "));

  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(
      `Token refresh failed (${res.status}): ${await safeText(res)}. ` +
        `The account may need to be re-connected.`,
    );
  }
  const json = (await res.json()) as TokenResponse;
  return {
    accessToken: json.access_token,
    // Google omits refresh_token on refresh; keep the existing one.
    refreshToken: json.refresh_token ?? null,
    expiry: new Date(Date.now() + json.expires_in * 1000),
    scope: json.scope ?? cfg.scopes.join(" "),
  };
}

/**
 * Returns a currently-valid access token for an account, refreshing and
 * persisting it first if it has expired (or is about to). Mutates `account`
 * in place so callers using the returned object see the fresh token.
 */
export async function getValidAccessToken(
  account: AccountWithTokens,
): Promise<string> {
  const expiresAt = new Date(account.tokenExpiry).getTime();
  if (expiresAt - EXPIRY_SKEW_MS > Date.now()) {
    return account.accessToken;
  }
  if (!account.refreshToken) {
    throw new Error(
      `Access token for ${account.email} has expired and there is no refresh ` +
        `token. Please re-connect this account.`,
    );
  }

  const refreshed = await refreshAccessToken(
    account.provider,
    account.refreshToken,
  );
  await updateAccountTokens(account.id, {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    tokenExpiry: refreshed.expiry,
  });

  account.accessToken = refreshed.accessToken;
  account.tokenExpiry = refreshed.expiry.toISOString();
  if (refreshed.refreshToken) account.refreshToken = refreshed.refreshToken;

  return refreshed.accessToken;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "<no body>";
  }
}
