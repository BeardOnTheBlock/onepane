// GET /api/calendar?start=ISO&end=ISO&accountId=all|ID
// Aggregated unified calendar over a date range. Queries one account or all
// connected accounts in parallel; a per-account failure is collected into
// `errors` rather than failing the whole request.

import {
  getAccountWithTokens,
  listAccountsWithTokens,
} from "@/lib/accounts";
import { getValidAccessToken } from "@/lib/oauth";
import { getCalendarProvider } from "@/lib/providers";
import type {
  AccountError,
  AccountWithTokens,
  UnifiedEvent,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidIso(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  const accountId = searchParams.get("accountId") ?? "all";

  if (!start || !end) {
    return Response.json(
      { error: "Both 'start' and 'end' query parameters are required." },
      { status: 400 },
    );
  }
  if (!isValidIso(start) || !isValidIso(end)) {
    return Response.json(
      { error: "'start' and 'end' must be valid ISO date-times." },
      { status: 400 },
    );
  }

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
    accounts.map(async (account): Promise<UnifiedEvent[]> => {
      try {
        await getValidAccessToken(account);
        return await getCalendarProvider(account.provider).listEvents(account, {
          start,
          end,
        });
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

  const events = results
    .flat()
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  return Response.json({ events, errors });
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "Unexpected error.";
}
