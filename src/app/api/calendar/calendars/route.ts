// GET /api/calendar/calendars?accountId=all|ID
// Lists the calendars for one account or all connected accounts in parallel.
// A per-account failure is collected into `errors` rather than failing the
// whole request (mirrors GET /api/calendar).

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
  CalendarInfo,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const userId = await requireUserId();
  if (!userId) return Response.json({ error: "Not signed in." }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("accountId") ?? "all";

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

  const results = await Promise.all(
    accounts.map(async (account): Promise<CalendarInfo[]> => {
      try {
        await getValidAccessToken(account);
        return await getCalendarProvider(account.provider).listCalendars(
          account,
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

  const calendars = results.flat();

  return Response.json({ calendars, errors });
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "Unexpected error.";
}
