// ============================================================================
// Environment + OAuth provider configuration.
// All server-side. Reads from process.env; fails loudly when misconfigured.
// ============================================================================

import {
  getStoredCredential,
  hasStoredCredential,
  maskClientId,
} from "@/lib/provider-credentials";
import type { OAuthProviderId } from "@/lib/types";

export const APP_URL = process.env.APP_URL ?? "http://localhost:6969";

/** OAuth scopes requested per provider. */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  // gmail.modify covers read, send, trash/archive, labels, and drafts —
  // everything a mail client does except permanent (bypass-Trash) deletion.
  "https://www.googleapis.com/auth/gmail.modify",
  // Full calendar: read/write across all of the account's calendars + events.
  "https://www.googleapis.com/auth/calendar",
];

export const MICROSOFT_SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
  "User.Read",
  // Mail.ReadWrite = read/write/move/delete/draft; Mail.Send = send.
  "Mail.ReadWrite",
  "Mail.Send",
  "Calendars.ReadWrite",
  "OnlineMeetings.ReadWrite",
];

export interface ProviderConfig {
  id: OAuthProviderId;
  label: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  authUrl: string;
  tokenUrl: string;
  redirectUri: string;
}

const MICROSOFT_TENANT = process.env.MICROSOFT_TENANT ?? "common";

export function redirectUriFor(provider: OAuthProviderId): string {
  return `${APP_URL}/api/connect/${provider}/callback`;
}

/** The env var names that hold a provider's client credentials, if used. */
function envVarsFor(provider: OAuthProviderId): { id: string; secret: string } {
  return provider === "google"
    ? { id: "GOOGLE_CLIENT_ID", secret: "GOOGLE_CLIENT_SECRET" }
    : { id: "MICROSOFT_CLIENT_ID", secret: "MICROSOFT_CLIENT_SECRET" };
}

/** Static (non-secret) parts of a provider's OAuth config. */
function providerShape(provider: OAuthProviderId) {
  if (provider === "google") {
    return {
      id: "google" as const,
      label: "Google",
      scopes: GOOGLE_SCOPES,
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      redirectUri: redirectUriFor("google"),
    };
  }
  return {
    id: "microsoft" as const,
    label: "Microsoft",
    scopes: MICROSOFT_SCOPES,
    authUrl: `https://login.microsoftonline.com/${MICROSOFT_TENANT}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${MICROSOFT_TENANT}/oauth2/v2.0/token`,
    redirectUri: redirectUriFor("microsoft"),
  };
}

/**
 * Resolves a provider's full OAuth config, preferring credentials stored in the
 * local database (set via Settings) and falling back to environment variables.
 * Throws if neither source has credentials.
 */
export async function getProviderConfig(
  provider: OAuthProviderId,
): Promise<ProviderConfig> {
  const stored = await getStoredCredential(provider);
  const env = envVarsFor(provider);
  const clientId = stored?.clientId ?? process.env[env.id];
  const clientSecret = stored?.clientSecret ?? process.env[env.secret];

  if (!clientId || !clientSecret) {
    throw new Error(
      `${provider} is not configured. Add its Client ID and Secret in ` +
        `Settings, or set ${env.id} / ${env.secret} in .env. See docs/OAUTH_SETUP.md.`,
    );
  }

  return { ...providerShape(provider), clientId, clientSecret };
}

/** True when a provider has client credentials available (DB or env). */
export async function isProviderConfigured(
  provider: OAuthProviderId,
): Promise<boolean> {
  if (await hasStoredCredential(provider)) return true;
  const env = envVarsFor(provider);
  return Boolean(process.env[env.id] && process.env[env.secret]);
}

export type CredentialSource = "db" | "env" | null;

export interface ProviderCredentialStatus {
  configured: boolean;
  source: CredentialSource;
  /** Masked Client ID hint when stored in the DB; null otherwise. */
  clientIdHint: string | null;
  /** The exact redirect URI to register with the provider. */
  redirectUri: string;
  /** Whether this provider's credentials are editable in the UI (DB-backed). */
  editable: boolean;
}

/** Reports a provider's credential status for the Settings UI (never leaks the secret). */
export async function getProviderCredentialStatus(
  provider: OAuthProviderId,
): Promise<ProviderCredentialStatus> {
  const redirectUri = redirectUriFor(provider);
  const stored = await getStoredCredential(provider);
  if (stored) {
    return {
      configured: true,
      source: "db",
      clientIdHint: maskClientId(stored.clientId),
      redirectUri,
      editable: true,
    };
  }
  const env = envVarsFor(provider);
  if (process.env[env.id] && process.env[env.secret]) {
    return {
      configured: true,
      source: "env",
      clientIdHint: null,
      redirectUri,
      editable: false,
    };
  }
  return { configured: false, source: null, clientIdHint: null, redirectUri, editable: true };
}

export const ALL_PROVIDERS: OAuthProviderId[] = ["google", "microsoft"];

/** Name of the httpOnly cookie holding the anti-CSRF OAuth state. */
export const OAUTH_STATE_COOKIE = "onepane_oauth_state";

/** A palette of pleasant, distinct colours assigned to new accounts. */
export const ACCOUNT_COLOR_PALETTE = [
  "#6366f1", // indigo
  "#ec4899", // pink
  "#10b981", // emerald
  "#f59e0b", // amber
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ef4444", // red
  "#14b8a6", // teal
];
