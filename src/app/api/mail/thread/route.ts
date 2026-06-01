// GET /api/mail/thread?accountId=ID&threadId=TID
// Loads every message in a conversation/thread (oldest first) for one account.

import { getAccountWithTokens } from "@/lib/accounts";
import { getValidAccessToken } from "@/lib/oauth";
import { getMailProvider } from "@/lib/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("accountId");
  const threadId = searchParams.get("threadId");

  if (!accountId) {
    return Response.json(
      { error: "An 'accountId' query parameter is required." },
      { status: 400 },
    );
  }
  if (!threadId) {
    return Response.json(
      { error: "A 'threadId' query parameter is required." },
      { status: 400 },
    );
  }

  try {
    const account = await getAccountWithTokens(accountId);
    if (!account) {
      return Response.json({ error: "Account not found." }, { status: 404 });
    }

    await getValidAccessToken(account);
    const messages = await getMailProvider(account.provider).getThread(
      account,
      threadId,
    );

    return Response.json({ messages });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load thread.";
    return Response.json({ error: message }, { status: 502 });
  }
}
