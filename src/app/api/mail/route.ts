// GET /api/mail?accountId=all|ID&limit=25&q=search
// Aggregated unified inbox. Fetches the latest messages from one account or all
// connected accounts in parallel. A failure on one account is collected into
// `errors` and never blanks out the rest of the view. When `q` is provided it
// performs a full-text search across each mailbox instead of listing the inbox.

import {
  getAccountWithTokens,
  listAccountsWithTokens,
} from "@/lib/accounts";
import { getValidAccessToken } from "@/lib/oauth";
import { getMailProvider } from "@/lib/providers";
import type {
  AccountError,
  AccountWithTokens,
  UnifiedMessage,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 25;
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;

function clampLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, parsed));
}

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("accountId") ?? "all";
  const limit = clampLimit(searchParams.get("limit"));
  const rawQuery = searchParams.get("q")?.trim();
  const query = rawQuery && rawQuery.length ? rawQuery : undefined;
  const rawLabelId = searchParams.get("labelId")?.trim();
  // Labels are per-account, so only honour labelId for a single account; when
  // aggregating across "all" accounts we ignore it.
  const labelId =
    accountId !== "all" && rawLabelId && rawLabelId.length
      ? rawLabelId
      : undefined;

  // Resolve the set of accounts to query.
  let accounts: AccountWithTokens[];
  try {
    if (accountId === "all") {
      accounts = await listAccountsWithTokens();
    } else {
      const account = await getAccountWithTokens(accountId);
      if (!account) {
        return Response.json({ error: "Account not found." }, { status: 404 });
      }
      accounts = [account];
    }
  } catch (err) {
    return Response.json({ error: messageOf(err) }, { status: 500 });
  }

  const errors: AccountError[] = [];

  const results = await Promise.all(
    accounts.map(async (account): Promise<UnifiedMessage[]> => {
      try {
        await getValidAccessToken(account);
        return await getMailProvider(account.provider).listMessages(
          account,
          limit,
          query,
          labelId,
        );
      } catch (err) {
        errors.push({
          accountId: account.id,
          email: account.email,
          message: messageOf(err),
        });
        return [];
      }
    }),
  );

  const messages = results
    .flat()
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return Response.json({ messages, errors });
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "Unexpected error.";
}
