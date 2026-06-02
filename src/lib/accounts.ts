// ============================================================================
// Accounts data-access layer.
// The ONLY module that reads/writes the Account table. Transparently encrypts
// tokens on write and decrypts on read, and converts between the DB row, the
// server-side AccountWithTokens, and the browser-safe AccountPublic.
// ============================================================================

import type { Account as AccountRow } from "@prisma/client";

import { ACCOUNT_COLOR_PALETTE } from "@/lib/config";
import { decrypt, encrypt } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import type {
  AccountPublic,
  AccountWithTokens,
  ProviderId,
} from "@/lib/types";

function rowToPublic(row: AccountRow): AccountPublic {
  return {
    id: row.id,
    provider: row.provider as ProviderId,
    email: row.email,
    displayName: row.displayName,
    color: row.color,
    createdAt: row.createdAt.toISOString(),
    canTeams: row.canTeams,
    canMeet: row.canMeet,
  };
}

function rowToWithTokens(row: AccountRow): AccountWithTokens {
  return {
    ...rowToPublic(row),
    userId: row.userId,
    accessToken: decrypt(row.accessToken),
    refreshToken: row.refreshToken ? decrypt(row.refreshToken) : null,
    tokenExpiry: row.tokenExpiry.toISOString(),
    scopes: row.scopes,
  };
}

export async function listAccountsPublic(
  userId: string,
): Promise<AccountPublic[]> {
  const rows = await prisma.account.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(rowToPublic);
}

export async function listAccountsWithTokens(
  userId: string,
): Promise<AccountWithTokens[]> {
  const rows = await prisma.account.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(rowToWithTokens);
}

export async function getAccountWithTokens(
  userId: string,
  id: string,
): Promise<AccountWithTokens | null> {
  const row = await prisma.account.findFirst({ where: { id, userId } });
  return row ? rowToWithTokens(row) : null;
}

export async function getAccountsWithTokens(
  userId: string,
  ids: string[],
): Promise<AccountWithTokens[]> {
  const rows = await prisma.account.findMany({
    where: { id: { in: ids }, userId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(rowToWithTokens);
}

/** Picks the next colour from the palette that is least used by this user. */
async function nextColor(userId: string): Promise<string> {
  const rows = await prisma.account.findMany({
    where: { userId },
    select: { color: true },
  });
  const used = new Map<string, number>();
  for (const c of ACCOUNT_COLOR_PALETTE) used.set(c, 0);
  for (const r of rows) used.set(r.color, (used.get(r.color) ?? 0) + 1);
  let best = ACCOUNT_COLOR_PALETTE[0];
  let bestCount = Number.POSITIVE_INFINITY;
  for (const c of ACCOUNT_COLOR_PALETTE) {
    const count = used.get(c) ?? 0;
    if (count < bestCount) {
      best = c;
      bestCount = count;
    }
  }
  return best;
}

export interface UpsertAccountInput {
  userId: string;
  provider: ProviderId;
  email: string;
  displayName: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiry: Date;
  scopes: string;
  canTeams: boolean;
  canMeet: boolean;
}

/**
 * Creates a new connected account or updates the tokens on an existing one
 * (matched by provider+email). Preserves the existing colour on update and
 * preserves an existing refresh token if the provider didn't return a new one.
 */
export async function upsertAccount(
  input: UpsertAccountInput,
): Promise<AccountPublic> {
  const existing = await prisma.account.findUnique({
    where: {
      userId_provider_email: {
        userId: input.userId,
        provider: input.provider,
        email: input.email,
      },
    },
  });

  const encryptedAccess = encrypt(input.accessToken);
  const encryptedRefresh = input.refreshToken
    ? encrypt(input.refreshToken)
    : existing?.refreshToken ?? null;

  const row = await prisma.account.upsert({
    where: {
      userId_provider_email: {
        userId: input.userId,
        provider: input.provider,
        email: input.email,
      },
    },
    create: {
      userId: input.userId,
      provider: input.provider,
      email: input.email,
      displayName: input.displayName,
      color: await nextColor(input.userId),
      canTeams: input.canTeams,
      canMeet: input.canMeet,
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      tokenExpiry: input.tokenExpiry,
      scopes: input.scopes,
    },
    update: {
      displayName: input.displayName,
      canTeams: input.canTeams,
      canMeet: input.canMeet,
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      tokenExpiry: input.tokenExpiry,
      scopes: input.scopes,
    },
  });

  return rowToPublic(row);
}

/** Persists refreshed tokens for an account (used by the OAuth refresh flow).
 *  Scoped by userId so a refresh can never touch another user's row. */
export async function updateAccountTokens(
  userId: string,
  id: string,
  tokens: {
    accessToken: string;
    refreshToken?: string | null;
    tokenExpiry: Date;
  },
): Promise<void> {
  await prisma.account.updateMany({
    where: { id, userId },
    data: {
      accessToken: encrypt(tokens.accessToken),
      ...(tokens.refreshToken
        ? { refreshToken: encrypt(tokens.refreshToken) }
        : {}),
      tokenExpiry: tokens.tokenExpiry,
    },
  });
}

export async function updateAccountColor(
  userId: string,
  id: string,
  color: string,
): Promise<AccountPublic | null> {
  const result = await prisma.account.updateMany({
    where: { id, userId },
    data: { color },
  });
  if (result.count === 0) return null;
  const row = await prisma.account.findFirst({ where: { id, userId } });
  return row ? rowToPublic(row) : null;
}

export async function deleteAccount(userId: string, id: string): Promise<void> {
  await prisma.account.deleteMany({ where: { id, userId } });
}
