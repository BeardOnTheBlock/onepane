// ============================================================================
// Environment + OAuth provider configuration.
// All server-side. Reads from process.env; fails loudly when misconfigured.
// ============================================================================

import type { ProviderId } from "@/lib/types";

export const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

/** OAuth scopes requested per provider. */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

export const MICROSOFT_SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
  "User.Read",
  "Mail.Read",
  "Mail.Send",
  "Calendars.ReadWrite",
  "OnlineMeetings.ReadWrite",
];

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  authUrl: string;
  tokenUrl: string;
  redirectUri: string;
}

const MICROSOFT_TENANT = process.env.MICROSOFT_TENANT ?? "common";

export function redirectUriFor(provider: ProviderId): string {
  return `${APP_URL}/api/connect/${provider}/callback`;
}

/** Returns the resolved config for a provider, or throws if env vars are missing. */
export function getProviderConfig(provider: ProviderId): ProviderConfig {
  if (provider === "google") {
    return {
      id: "google",
      label: "Google",
      clientId: requireEnv("GOOGLE_CLIENT_ID"),
      clientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
      scopes: GOOGLE_SCOPES,
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      redirectUri: redirectUriFor("google"),
    };
  }
  return {
    id: "microsoft",
    label: "Microsoft",
    clientId: requireEnv("MICROSOFT_CLIENT_ID"),
    clientSecret: requireEnv("MICROSOFT_CLIENT_SECRET"),
    scopes: MICROSOFT_SCOPES,
    authUrl: `https://login.microsoftonline.com/${MICROSOFT_TENANT}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${MICROSOFT_TENANT}/oauth2/v2.0/token`,
    redirectUri: redirectUriFor("microsoft"),
  };
}

/** True when the env vars for a provider are present (used to show/hide the
 *  "Connect" buttons in the UI without throwing). */
export function isProviderConfigured(provider: ProviderId): boolean {
  if (provider === "google") {
    return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  }
  return Boolean(
    process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET,
  );
}

export const ALL_PROVIDERS: ProviderId[] = ["google", "microsoft"];

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

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy .env.example to .env and see docs/OAUTH_SETUP.md.`,
    );
  }
  return value;
}
