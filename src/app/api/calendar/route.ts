// GET /api/calendar?start=ISO&end=ISO&accountId=all|ID&calendars=...
// Aggregated unified calendar over a date range. Queries one account or all
// connected accounts in parallel; a per-account failure is collected into
// `errors` rather than failing the whole request.
//
// When the optional `calendars` param is present it is a comma-separated list
// of `accountId:encodeURIComponent(calendarId)` pairs. We then fetch events for
// exactly those (account, calendarId) pairs (grouped by account, one
// listEvents call per pair) instead of each account's primary calendar.
// `accountId` still scopes which accounts are eligible.

import {
  getAccountWithTokens,
  listAccountsWithTokens,
} from "@/lib/accounts";
import { getValidAccessToken } from "@/lib/oauth";
import { getCalendarProvider } from "@/lib/providers";
import { requireUserId } from "@/lib/session";
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
  const userId = await requireUserId();
  if (!userId) return Response.json({ error: "Not signed in." }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  const accountId = searchParams.get("accountId") ?? "all";
  const calendarsParam = searchParams.get("calendars");

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
      accounts = await listAccountsWithTokens(userId);
    } else {
      const account = await getAccountWithTokens(userId, accountId);
      if (!account) {
        return Response.json({ error: "Account not found." }, { status: 404 });
      }
      accounts = [account];
    }
  } catch (err) {
    return Response.json({ error: messageOf(err) }, { status: 500 });
  }

  const errors: AccountError[] = [];
  const range = { start, end };

  // Map calendarId lists to the eligible accounts when an explicit selection
  // was provided. Each entry is one (account, calendarId) pair to fetch.
  const calendarIdsByAccount = calendarsParam
    ? parseCalendarPairs(calendarsParam)
    : null;

  const results = await Promise.all(
    accounts.map(async (account): Promise<UnifiedEvent[]> => {
      try {
        await getValidAccessToken(account);
        const provider = getCalendarProvider(account.provider);

        if (calendarIdsByAccount) {
          const calendarIds = calendarIdsByAccount.get(account.id);
          // Account is eligible but not selected → contributes no events.
          if (!calendarIds || calendarIds.length === 0) return [];
          const perCalendar = await Promise.all(
            calendarIds.map((calendarId) =>
              provider.listEvents(account, range, calendarId),
            ),
          );
          return perCalendar.flat();
        }

        return await provider.listEvents(account, range);
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

/** Parses `accountId:encodeURIComponent(calendarId)` pairs into a map of
 *  accountId → decoded calendarIds. Malformed pairs are skipped. */
function parseCalendarPairs(raw: string): Map<string, string[]> {
  const byAccount = new Map<string, string[]>();
  for (const pair of raw.split(",")) {
    const sep = pair.indexOf(":");
    if (sep <= 0 || sep === pair.length - 1) continue;
    const acctId = pair.slice(0, sep);
    let calendarId: string;
    try {
      calendarId = decodeURIComponent(pair.slice(sep + 1));
    } catch {
      continue;
    }
    if (calendarId.length === 0) continue;
    const existing = byAccount.get(acctId);
    if (existing) existing.push(calendarId);
    else byAccount.set(acctId, [calendarId]);
  }
  return byAccount;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "Unexpected error.";
}
