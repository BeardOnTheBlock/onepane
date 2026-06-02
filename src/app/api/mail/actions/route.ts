// POST /api/mail/actions
// Body: { accountId, messageIds: string[], action: MailActionType }
// Applies a triage action (trash/archive/read/star/…) to one or more messages.

import { getAccountWithTokens } from "@/lib/accounts";
import { getValidAccessToken } from "@/lib/oauth";
import { getMailProvider } from "@/lib/providers";
import type { MailActionType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

/** The seven valid actions, used to validate untrusted input at runtime. */
const VALID_ACTIONS: readonly MailActionType[] = [
  "trash",
  "untrash",
  "archive",
  "markRead",
  "markUnread",
  "star",
  "unstar",
];

function isMailActionType(value: unknown): value is MailActionType {
  return (
    typeof value === "string" &&
    (VALID_ACTIONS as readonly string[]).includes(value)
  );
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

  const { accountId, messageIds, action } = (body ?? {}) as {
    accountId?: unknown;
    messageIds?: unknown;
    action?: unknown;
  };

  if (typeof accountId !== "string" || accountId.length === 0) {
    return badRequest("A non-empty 'accountId' is required.");
  }
  if (!isNonEmptyStringArray(messageIds)) {
    return badRequest("'messageIds' must be a non-empty array of strings.");
  }
  if (!isMailActionType(action)) {
    return badRequest(
      `'action' must be one of: ${VALID_ACTIONS.join(", ")}.`,
    );
  }

  try {
    const account = await getAccountWithTokens(accountId);
    if (!account) {
      return Response.json({ error: "Account not found." }, { status: 404 });
    }

    await getValidAccessToken(account);
    await getMailProvider(account.provider).applyAction(
      account,
      messageIds,
      action,
    );

    return Response.json({ ok: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to apply action.";
    return Response.json({ error: message }, { status: 502 });
  }
}
