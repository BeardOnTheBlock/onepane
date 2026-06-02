// GET /api/mail/drafts/content?accountId=ID&draftId=DID
// Loads a single draft's editable content -> { draft } (DraftResponse).

import { getAccountWithTokens } from "@/lib/accounts";
import { getValidAccessToken } from "@/lib/oauth";
import { getMailProvider } from "@/lib/providers";
import { requireUserId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

export async function GET(req: Request): Promise<Response> {
  const userId = await requireUserId();
  if (!userId) return Response.json({ error: "Not signed in." }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("accountId")?.trim();
  const draftId = searchParams.get("draftId")?.trim();

  if (!accountId) {
    return badRequest("A non-empty 'accountId' is required.");
  }
  if (!draftId) {
    return badRequest("A non-empty 'draftId' is required.");
  }

  try {
    const account = await getAccountWithTokens(userId, accountId);
    if (!account) {
      return Response.json({ error: "Account not found." }, { status: 404 });
    }

    await getValidAccessToken(account);
    const draft = await getMailProvider(account.provider).getDraft(
      account,
      draftId,
    );

    return Response.json({ draft });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load draft.";
    return Response.json({ error: message }, { status: 502 });
  }
}
