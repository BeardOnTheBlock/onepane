// GET /api/mail/message?accountId=ID&id=MSGID
// Loads a single fully-rendered message (body + threading headers).

import { getAccountWithTokens } from "@/lib/accounts";
import { getValidAccessToken } from "@/lib/oauth";
import { getMailProvider } from "@/lib/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("accountId");
  const id = searchParams.get("id");

  if (!accountId) {
    return Response.json(
      { error: "An 'accountId' query parameter is required." },
      { status: 400 },
    );
  }
  if (!id) {
    return Response.json(
      { error: "An 'id' query parameter is required." },
      { status: 400 },
    );
  }

  try {
    const account = await getAccountWithTokens(accountId);
    if (!account) {
      return Response.json({ error: "Account not found." }, { status: 404 });
    }

    await getValidAccessToken(account);
    const message = await getMailProvider(account.provider).getMessage(
      account,
      id,
    );

    return Response.json({ message });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load message.";
    return Response.json({ error: message }, { status: 502 });
  }
}
