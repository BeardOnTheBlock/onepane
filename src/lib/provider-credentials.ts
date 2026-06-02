// ============================================================================
// Provider OAuth *client* credentials (Client ID + Secret) data layer.
// These are the credentials you create in Google Cloud / Microsoft Entra to
// identify the app. They are stored encrypted at rest (AES-256-GCM) in the
// local SQLite database — so they never need to live in a .env file or the repo.
// This is the ONLY module that reads/writes the ProviderCredential table.
// ============================================================================

import { decrypt, encrypt } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import type { ProviderId } from "@/lib/types";

export interface ProviderClient {
  clientId: string;
  clientSecret: string;
}

/** Returns the decrypted client credentials stored for a provider, or null. */
export async function getStoredCredential(
  provider: ProviderId,
): Promise<ProviderClient | null> {
  const row = await prisma.providerCredential.findUnique({ where: { provider } });
  if (!row) return null;
  return {
    clientId: decrypt(row.clientId),
    clientSecret: decrypt(row.clientSecret),
  };
}

/** Stores (or replaces) the client credentials for a provider, encrypted. */
export async function setStoredCredential(
  provider: ProviderId,
  clientId: string,
  clientSecret: string,
): Promise<void> {
  const encId = encrypt(clientId);
  const encSecret = encrypt(clientSecret);
  await prisma.providerCredential.upsert({
    where: { provider },
    create: { provider, clientId: encId, clientSecret: encSecret },
    update: { clientId: encId, clientSecret: encSecret },
  });
}

/** Removes any stored credentials for a provider. */
export async function deleteStoredCredential(
  provider: ProviderId,
): Promise<void> {
  await prisma.providerCredential.deleteMany({ where: { provider } });
}

export async function hasStoredCredential(
  provider: ProviderId,
): Promise<boolean> {
  const count = await prisma.providerCredential.count({ where: { provider } });
  return count > 0;
}

/** A short, non-sensitive hint for a stored Client ID (e.g. "1234…apps.googleusercontent.com").
 *  Never returns the secret. */
export function maskClientId(clientId: string): string {
  const trimmed = clientId.trim();
  if (trimmed.length <= 12) return "•••";
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-6)}`;
}
