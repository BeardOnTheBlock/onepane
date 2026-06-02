// /api/providers/credentials
// Manage the in-app OAuth *client* credentials (Client ID + Secret) for each
// provider. Stored encrypted in the local database — never returned to the client.
//   GET    -> per-provider status (configured, source, masked Client ID hint, redirect URI)
//   POST   -> { provider, clientId, clientSecret } save (encrypted)
//   DELETE -> ?provider=ID clear stored credentials

import { ALL_PROVIDERS, getProviderCredentialStatus } from "@/lib/config";
import {
  deleteStoredCredential,
  setStoredCredential,
} from "@/lib/provider-credentials";
import type { OAuthProviderId } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isProviderId(value: unknown): value is OAuthProviderId {
  return typeof value === "string" && (ALL_PROVIDERS as string[]).includes(value);
}

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

export async function GET(): Promise<Response> {
  const entries = await Promise.all(
    ALL_PROVIDERS.map(async (p) => [p, await getProviderCredentialStatus(p)] as const),
  );
  return Response.json({ providers: Object.fromEntries(entries) });
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const { provider, clientId, clientSecret } = (body ?? {}) as {
    provider?: unknown;
    clientId?: unknown;
    clientSecret?: unknown;
  };

  if (!isProviderId(provider)) return badRequest("Unknown or missing 'provider'.");
  if (typeof clientId !== "string" || clientId.trim().length === 0) {
    return badRequest("A non-empty 'clientId' is required.");
  }
  if (typeof clientSecret !== "string" || clientSecret.trim().length === 0) {
    return badRequest("A non-empty 'clientSecret' is required.");
  }

  try {
    await setStoredCredential(provider, clientId.trim(), clientSecret.trim());
    const status = await getProviderCredentialStatus(provider);
    return Response.json({ ok: true, status });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to save credentials.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const provider = searchParams.get("provider");
  if (!isProviderId(provider)) return badRequest("Unknown or missing 'provider'.");

  try {
    await deleteStoredCredential(provider);
    return Response.json({ ok: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to remove credentials.";
    return Response.json({ error: message }, { status: 500 });
  }
}
