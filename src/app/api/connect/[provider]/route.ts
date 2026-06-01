// GET /api/connect/[provider]
// Kicks off the OAuth authorization-code flow: generates an anti-CSRF state,
// stores it in an httpOnly cookie, and redirects the user to the provider's
// consent screen. Redirects back to /settings?error=... if the provider isn't
// configured or anything goes wrong before the consent screen.

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { ALL_PROVIDERS, isProviderConfigured } from "@/lib/config";
import { buildAuthUrl } from "@/lib/oauth";
import type { ProviderId } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OAUTH_STATE_COOKIE = "onepane_oauth_state";

function isProviderId(value: string): value is ProviderId {
  return (ALL_PROVIDERS as string[]).includes(value);
}

function settingsRedirect(req: Request, params: Record<string, string>): NextResponse {
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

  if (!isProviderId(provider)) {
    return settingsRedirect(req, { error: `Unknown provider: ${provider}` });
  }

  if (!isProviderConfigured(provider)) {
    return settingsRedirect(req, {
      error: `${provider} is not configured. See docs/OAUTH_SETUP.md.`,
    });
  }

  try {
    const state = randomBytes(32).toString("hex");

    const cookieStore = await cookies();
    cookieStore.set(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
      secure: process.env.NODE_ENV === "production",
    });

    return NextResponse.redirect(buildAuthUrl(provider, state));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start sign-in.";
    return settingsRedirect(req, { error: message });
  }
}
