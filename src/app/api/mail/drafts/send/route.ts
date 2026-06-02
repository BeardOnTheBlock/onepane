// POST /api/mail/drafts/send
// Body: { accountId, draftId }
// Sends a previously-saved draft -> { ok: true }.

import { getAccountWithTokens } from "@/lib/accounts";
import { getValidAccessToken } from "@/lib/oauth";
import { getMailProvider } from "@/lib/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const { accountId, draftId } = (body ?? {}) as {
    accountId?: unknown;
    draftId?: unknown;
  };

  if (typeof accountId !== "string" || accountId.length === 0) {
    return badRequest("A non-empty 'accountId' is required.");
  }
  if (typeof draftId !== "string" || draftId.length === 0) {
    return badRequest("A non-empty 'draftId' is required.");
  }

  try {
    const account = await getAccountWithTokens(accountId);
    if (!account) {
      return Response.json({ error: "Account not found." }, { status: 404 });
    }

    await getValidAccessToken(account);
    await getMailProvider(account.provider).sendDraft(account, draftId);

    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send draft.";
    return Response.json({ error: message }, { status: 502 });
  }
}
