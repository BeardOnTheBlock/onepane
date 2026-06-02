// POST /api/mail/move
// Body: { accountId, messageIds: string[], labelId: string }
// Moves one or more messages into a label/folder (Gmail: applies the label and
// removes them from the inbox; Outlook: moves them to the folder).

import { getAccountWithTokens } from "@/lib/accounts";
import { getValidAccessToken } from "@/lib/oauth";
import { getMailProvider } from "@/lib/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => typeof v === "string")
  );
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const { accountId, messageIds, labelId } = (body ?? {}) as {
    accountId?: unknown;
    messageIds?: unknown;
    labelId?: unknown;
  };

  if (typeof accountId !== "string" || accountId.length === 0) {
    return badRequest("A non-empty 'accountId' is required.");
  }
  if (!isNonEmptyStringArray(messageIds)) {
    return badRequest("'messageIds' must be a non-empty array of strings.");
  }
  if (typeof labelId !== "string" || labelId.length === 0) {
    return badRequest("A non-empty 'labelId' is required.");
  }

  try {
    const account = await getAccountWithTokens(accountId);
    if (!account) {
      return Response.json({ error: "Account not found." }, { status: 404 });
    }

    await getValidAccessToken(account);
    await getMailProvider(account.provider).moveToLabel(
      account,
      messageIds,
      labelId,
    );

    return Response.json({ ok: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to move messages.";
    return Response.json({ error: message }, { status: 502 });
  }
}
