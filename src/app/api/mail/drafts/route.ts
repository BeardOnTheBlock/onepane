// GET    /api/mail/drafts?accountId=ID&limit=25   — lists saved (unsent) drafts.
// POST   /api/mail/drafts                          — body { accountId, draft, reply? };
//                                                     creates a draft, returns { draftId }.
// PATCH  /api/mail/drafts                           — body { accountId, draftId, draft };
//                                                     replaces a draft's content.
// DELETE /api/mail/drafts?accountId=ID&draftId=DID  — deletes a saved draft.

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

const DEFAULT_LIMIT = 25;
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;

function clampLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, parsed));
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

/**
 * Validates and normalises an untrusted `draft` payload into a MailDraft.
 * Unlike the send route, a draft may have an empty `to` and an empty
 * `subject` — it just has to be the right *shape*. Returns the validated
 * draft, or an error string describing the first problem found.
 */
function parseDraft(draft: unknown): MailDraft | { error: string } {
  if (typeof draft !== "object" || draft === null) {
    return { error: "A 'draft' object is required." };
  }

  const d = draft as Record<string, unknown>;

  // `to` may be empty for a draft, but must be a (possibly empty) address array.
  if (!isMailAddressArray(d.to)) {
    return { error: "'draft.to' must be an array of recipients." };
  }
  if (d.cc !== undefined && !isMailAddressArray(d.cc)) {
    return { error: "'draft.cc' must be an array of recipients." };
  }
  if (typeof d.subject !== "string") {
    return { error: "'draft.subject' must be a string." };
  }
  if (typeof d.bodyText !== "string") {
    return { error: "'draft.bodyText' must be a string." };
  }
  if (d.bodyHtml !== undefined && typeof d.bodyHtml !== "string") {
    return { error: "'draft.bodyHtml' must be a string." };
  }

  let attachments: OutgoingAttachment[] | undefined;
  if (d.attachments !== undefined) {
    if (!Array.isArray(d.attachments)) {
      return { error: "'draft.attachments' must be an array." };
    }
    if (!d.attachments.every(isOutgoingAttachment)) {
      return {
        error:
          "Each attachment needs string 'filename', 'mimeType', and 'contentBase64'.",
      };
    }
    if (d.attachments.length > MAX_ATTACHMENTS) {
      return {
        error: `A message can have at most ${MAX_ATTACHMENTS} attachments.`,
      };
    }
    // Estimate the decoded byte size from the base64 length (4 chars => 3 bytes).
    const estimatedBytes = d.attachments.reduce(
      (sum, a) => sum + a.contentBase64.length * 0.75,
      0,
    );
    if (estimatedBytes > MAX_ATTACHMENTS_BYTES) {
      return { error: "Attachments exceed the 25 MB limit." };
    }
    attachments = d.attachments;
  }

  return {
    to: d.to,
    subject: d.subject,
    bodyText: d.bodyText,
    ...(d.cc !== undefined ? { cc: d.cc } : {}),
    ...(typeof d.bodyHtml === "string" ? { bodyHtml: d.bodyHtml } : {}),
    ...(attachments && attachments.length ? { attachments } : {}),
  };
}

export async function GET(req: Request): Promise<Response> {
  const userId = await requireUserId();
  if (!userId) return Response.json({ error: "Not signed in." }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("accountId")?.trim();
  const limit = clampLimit(searchParams.get("limit"));

  if (!accountId) {
    return badRequest("A non-empty 'accountId' is required.");
  }

  try {
    const account = await getAccountWithTokens(userId, accountId);
    if (!account) {
      return Response.json({ error: "Account not found." }, { status: 404 });
    }

    await getValidAccessToken(account);
    const drafts = await getMailProvider(account.provider).listDrafts(
      account,
      limit,
    );

    return Response.json({ drafts });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list drafts.";
    return Response.json({ error: message }, { status: 502 });
  }
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

  const parsed = parseDraft(draft);
  if ("error" in parsed) {
    return badRequest(parsed.error);
  }

  let replyContext: ReplyContext | undefined;
  if (reply !== undefined && reply !== null) {
    if (typeof reply !== "object") {
      return badRequest("'reply' must be an object when provided.");
    }
    const r = reply as Record<string, unknown>;
    if (
      typeof r.inReplyToMessageId !== "string" ||
      r.inReplyToMessageId.length === 0
    ) {
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
    const draftId = await getMailProvider(account.provider).createDraft(
      account,
      parsed,
      replyContext,
    );

    return Response.json({ draftId });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create draft.";
    return Response.json({ error: message }, { status: 502 });
  }
}

export async function PATCH(req: Request): Promise<Response> {
  const userId = await requireUserId();
  if (!userId) return Response.json({ error: "Not signed in." }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const { accountId, draftId, draft } = (body ?? {}) as {
    accountId?: unknown;
    draftId?: unknown;
    draft?: unknown;
  };

  if (typeof accountId !== "string" || accountId.length === 0) {
    return badRequest("A non-empty 'accountId' is required.");
  }
  if (typeof draftId !== "string" || draftId.length === 0) {
    return badRequest("A non-empty 'draftId' is required.");
  }

  const parsed = parseDraft(draft);
  if ("error" in parsed) {
    return badRequest(parsed.error);
  }

  try {
    const account = await getAccountWithTokens(userId, accountId);
    if (!account) {
      return Response.json({ error: "Account not found." }, { status: 404 });
    }

    await getValidAccessToken(account);
    await getMailProvider(account.provider).updateDraft(
      account,
      draftId,
      parsed,
    );

    return Response.json({ ok: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to update draft.";
    return Response.json({ error: message }, { status: 502 });
  }
}

export async function DELETE(req: Request): Promise<Response> {
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
    await getMailProvider(account.provider).deleteDraft(account, draftId);

    return Response.json({ ok: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to delete draft.";
    return Response.json({ error: message }, { status: 502 });
  }
}
