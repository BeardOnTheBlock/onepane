// POST /api/mail/send
// Body: { accountId, draft: MailDraft, reply?: ReplyContext }
// Sends (or replies to) a message from the given account.

import { getAccountWithTokens } from "@/lib/accounts";
import { getValidAccessToken } from "@/lib/oauth";
import { getMailProvider } from "@/lib/providers";
import type { MailAddress, MailDraft, ReplyContext } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

/** Loose RFC-5322-ish address check — good enough to reject obvious garbage. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isMailAddress(value: unknown): value is MailAddress {
  if (typeof value !== "object" || value === null) return false;
  const { email, name } = value as { email?: unknown; name?: unknown };
  if (typeof email !== "string" || !EMAIL_RE.test(email)) return false;
  if (name !== undefined && typeof name !== "string") return false;
  return true;
}

function isMailAddressArray(value: unknown): value is MailAddress[] {
  return Array.isArray(value) && value.every(isMailAddress);
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const { accountId, draft, reply } = (body ?? {}) as {
    accountId?: unknown;
    draft?: unknown;
    reply?: unknown;
  };

  if (typeof accountId !== "string" || accountId.length === 0) {
    return badRequest("A non-empty 'accountId' is required.");
  }

  if (typeof draft !== "object" || draft === null) {
    return badRequest("A 'draft' object is required.");
  }

  const d = draft as Record<string, unknown>;

  if (!isMailAddressArray(d.to) || d.to.length === 0) {
    return badRequest("'draft.to' must be a non-empty array of recipients.");
  }
  if (d.cc !== undefined && !isMailAddressArray(d.cc)) {
    return badRequest("'draft.cc' must be an array of recipients.");
  }
  if (typeof d.subject !== "string") {
    return badRequest("'draft.subject' is required.");
  }
  if (typeof d.bodyText !== "string") {
    return badRequest("'draft.bodyText' is required.");
  }
  if (d.bodyHtml !== undefined && typeof d.bodyHtml !== "string") {
    return badRequest("'draft.bodyHtml' must be a string.");
  }

  const validDraft: MailDraft = {
    to: d.to,
    subject: d.subject,
    bodyText: d.bodyText,
    ...(d.cc !== undefined ? { cc: d.cc } : {}),
    ...(typeof d.bodyHtml === "string" ? { bodyHtml: d.bodyHtml } : {}),
  };

  let replyContext: ReplyContext | undefined;
  if (reply !== undefined && reply !== null) {
    if (typeof reply !== "object") {
      return badRequest("'reply' must be an object when provided.");
    }
    const r = reply as Record<string, unknown>;
    if (typeof r.inReplyToMessageId !== "string" || r.inReplyToMessageId.length === 0) {
      return badRequest("'reply.inReplyToMessageId' is required.");
    }
    replyContext = {
      inReplyToMessageId: r.inReplyToMessageId,
      threadId: typeof r.threadId === "string" ? r.threadId : null,
      messageIdHeader:
        typeof r.messageIdHeader === "string" ? r.messageIdHeader : null,
      references: typeof r.references === "string" ? r.references : null,
    };
  }

  try {
    const account = await getAccountWithTokens(accountId);
    if (!account) {
      return Response.json({ error: "Account not found." }, { status: 404 });
    }

    await getValidAccessToken(account);
    await getMailProvider(account.provider).sendMessage(
      account,
      validDraft,
      replyContext,
    );

    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send message.";
    return Response.json({ error: message }, { status: 502 });
  }
}
