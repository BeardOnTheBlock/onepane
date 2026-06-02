// POST /api/mail/send
// Body: { accountId, draft: MailDraft, reply?: ReplyContext }
// Sends (or replies to) a message from the given account.

import { getAccountWithTokens } from "@/lib/accounts";
import { getValidAccessToken } from "@/lib/oauth";
import { getMailProvider } from "@/lib/providers";
import { requireUserId } from "@/lib/session";
import type {
  MailAddress,
  MailDraft,
  OutgoingAttachment,
  ReplyContext,
} from "@/lib/types";

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

/** At most 10 files per message. */
const MAX_ATTACHMENTS = 10;
/** Provider hard limit for the total decoded payload (matches Gmail/Graph). */
const MAX_ATTACHMENTS_BYTES = 25 * 1024 * 1024;

function isOutgoingAttachment(value: unknown): value is OutgoingAttachment {
  if (typeof value !== "object" || value === null) return false;
  const { filename, mimeType, contentBase64 } = value as {
    filename?: unknown;
    mimeType?: unknown;
    contentBase64?: unknown;
  };
  return (
    typeof filename === "string" &&
    typeof mimeType === "string" &&
    typeof contentBase64 === "string"
  );
}

export async function POST(req: Request): Promise<Response> {
  const userId = await requireUserId();
  if (!userId) return Response.json({ error: "Not signed in." }, { status: 401 });

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

  let attachments: OutgoingAttachment[] | undefined;
  if (d.attachments !== undefined) {
    if (!Array.isArray(d.attachments)) {
      return badRequest("'draft.attachments' must be an array.");
    }
    if (!d.attachments.every(isOutgoingAttachment)) {
      return badRequest(
        "Each attachment needs string 'filename', 'mimeType', and 'contentBase64'.",
      );
    }
    if (d.attachments.length > MAX_ATTACHMENTS) {
      return badRequest(
        `A message can have at most ${MAX_ATTACHMENTS} attachments.`,
      );
    }
    // Estimate the decoded byte size from the base64 length (4 chars => 3 bytes).
    const estimatedBytes = d.attachments.reduce(
      (sum, a) => sum + a.contentBase64.length * 0.75,
      0,
    );
    if (estimatedBytes > MAX_ATTACHMENTS_BYTES) {
      return badRequest("Attachments exceed the 25 MB limit.");
    }
    attachments = d.attachments;
  }

  const validDraft: MailDraft = {
    to: d.to,
    subject: d.subject,
    bodyText: d.bodyText,
    ...(d.cc !== undefined ? { cc: d.cc } : {}),
    ...(typeof d.bodyHtml === "string" ? { bodyHtml: d.bodyHtml } : {}),
    ...(attachments && attachments.length ? { attachments } : {}),
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
    const account = await getAccountWithTokens(userId, accountId);
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
