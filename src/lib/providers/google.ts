// ============================================================================
// Google provider (Gmail + Google Calendar).
//
// SERVER-ONLY. Never import this from a client component.
//
// Assumes `account.accessToken` is already valid — the API layer refreshes it
// before calling these methods, so we simply use it as a Bearer token.
// ============================================================================

import { randomBytes } from "node:crypto";

import { googleMapsUrl } from "@/lib/utils";
import type {
  AccountWithTokens,
  AttachmentMeta,
  AttendeeResponse,
  CalendarInfo,
  CalendarProvider,
  ConferenceType,
  DateRange,
  DownloadedAttachment,
  DraftContent,
  DraftSummary,
  EventAttendee,
  EventDraft,
  MailActionType,
  MailAddress,
  MailDraft,
  MailLabel,
  MailProvider,
  ReplyContext,
  UnifiedEvent,
  UnifiedMessage,
  UnifiedMessageFull,
} from "@/lib/types";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

// Gmail rejects too many simultaneous per-user requests with HTTP 429
// ("Too many concurrent requests for user"), so fan-out fetches are pooled.
const GMAIL_FETCH_CONCURRENCY = 4;

/**
 * Maps items through `fn` with a bounded number of in-flight calls, preserving
 * input order. Keeps Gmail's per-user concurrency limit happy on list fan-outs.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    for (let i = cursor++; i < items.length; i = cursor++) {
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Low-level fetch helper
// ---------------------------------------------------------------------------

/**
 * Authenticated fetch against a Google API. Sets the Bearer token and a JSON
 * Content-Type (unless overridden), and throws a descriptive Error including
 * the HTTP status and response body on any non-2xx response.
 */
async function gfetch(
  url: string,
  accessToken: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(url, { ...init, headers });

  if (!res.ok) {
    let body = "";
    try {
      body = await res.text();
    } catch {
      // ignore — body is best-effort context only
    }
    throw new Error(
      `Google API request failed (${res.status} ${res.statusText}) for ${url}` +
        (body ? `: ${body}` : ""),
    );
  }

  return res;
}

async function gfetchJson<T>(
  url: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  const res = await gfetch(url, accessToken, init);
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

/** Decodes a base64url string (as used by the Gmail API for body data). */
function decodeBase64Url(data: string): string {
  if (!data) return "";
  // Gmail uses URL-safe base64; normalise back to standard base64.
  const normalised = data.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Buffer.from(normalised, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

/** Encodes a UTF-8 string as URL-safe base64 with padding stripped. */
function encodeBase64Url(raw: string): string {
  return Buffer.from(raw, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Re-encodes Gmail's URL-safe base64 attachment data as standard base64.
 * Gmail returns attachment bytes as base64url; the rest of the app (the API
 * layer and the OutgoingAttachment/DownloadedAttachment contracts) speaks
 * standard base64, so we round-trip through a Buffer to normalise.
 */
function base64UrlToStandardBase64(data: string): string {
  if (!data) return "";
  const normalised = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalised, "base64").toString("base64");
}

/** Splits a base64 string into 76-character lines (RFC 2045 MIME). */
function wrapBase64(data: string): string {
  return data.replace(/.{1,76}/g, "$&\r\n").replace(/\r\n$/, "");
}

// ---------------------------------------------------------------------------
// Header parsing helpers
// ---------------------------------------------------------------------------

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

/** A Gmail label resource as returned by the /labels endpoints. */
interface GmailLabel {
  id: string;
  name: string;
  /** Gmail already classifies labels as "system" or "user". */
  type?: "system" | "user";
}

/** Case-insensitive header lookup; returns the first matching value or "". */
function header(headers: GmailHeader[] | undefined, name: string): string {
  if (!headers) return "";
  const lower = name.toLowerCase();
  const found = headers.find((h) => h.name.toLowerCase() === lower);
  return found?.value ?? "";
}

/**
 * Parses a single RFC 5322 address ("Display Name <user@host>" or a bare
 * "user@host") into a MailAddress. Strips surrounding quotes from the name.
 */
function parseAddress(raw: string): MailAddress | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const angle = trimmed.match(/^(.*)<([^>]+)>\s*$/);
  if (angle) {
    const name = angle[1].trim().replace(/^"(.*)"$/, "$1").trim();
    const email = angle[2].trim();
    if (!email) return null;
    return name ? { name, email } : { email };
  }

  // Bare address (no display name / angle brackets).
  return { email: trimmed.replace(/^"(.*)"$/, "$1") };
}

/**
 * Splits an address-list header into individual MailAddresses. Commas inside
 * quoted display names are respected so `"Doe, John" <j@x>` stays intact.
 */
function parseAddressList(raw: string): MailAddress[] {
  if (!raw) return [];

  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of raw) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === "," && !inQuotes) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);

  return parts
    .map((p) => parseAddress(p))
    .filter((a): a is MailAddress => a !== null);
}

/** Converts a Gmail internalDate (ms epoch as string) into an ISO string. */
function internalDateToIso(internalDate: string | undefined): string {
  const ms = Number(internalDate);
  if (!internalDate || Number.isNaN(ms)) return new Date(0).toISOString();
  return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------
// Gmail payload walking
// ---------------------------------------------------------------------------

interface WalkResult {
  textBodies: string[];
  htmlBodies: string[];
  hasAttachments: boolean;
  attachments: AttachmentMeta[];
}

/**
 * Decides whether an attachment part is referenced inline in the body (a
 * cid: image rendered inside the HTML) rather than being a standalone file.
 * Inline parts carry either a Content-Disposition of "inline" or a
 * Content-ID / X-Attachment-Id header.
 */
function isInlinePart(part: GmailPart): boolean {
  const disposition = header(part.headers, "Content-Disposition").toLowerCase();
  if (disposition.includes("inline")) return true;
  if (header(part.headers, "Content-ID")) return true;
  if (header(part.headers, "X-Attachment-Id")) return true;
  return false;
}

/**
 * Recursively walks a Gmail payload, collecting decoded text/plain and
 * text/html bodies and the metadata for every attachment part (any part with
 * a non-empty filename and a body.attachmentId).
 */
function walkParts(part: GmailPart | undefined, acc: WalkResult): void {
  if (!part) return;

  const mime = part.mimeType ?? "";

  // A part with a filename AND an attachmentId is a real attachment (file or
  // inline image). Bodies (text/plain, text/html) have data but no filename.
  if (part.filename && part.filename.length > 0 && part.body?.attachmentId) {
    const inline = isInlinePart(part);
    acc.attachments.push({
      id: part.body.attachmentId,
      filename: part.filename,
      mimeType: part.mimeType || "application/octet-stream",
      size: part.body.size ?? 0,
      inline,
    });
    // hasAttachments reflects only real, downloadable (non-inline) files.
    if (!inline) acc.hasAttachments = true;
  }

  if (mime === "text/plain" && part.body?.data && !part.filename) {
    acc.textBodies.push(decodeBase64Url(part.body.data));
  } else if (mime === "text/html" && part.body?.data && !part.filename) {
    acc.htmlBodies.push(decodeBase64Url(part.body.data));
  }

  if (part.parts) {
    for (const child of part.parts) {
      walkParts(child, acc);
    }
  }
}

// ---------------------------------------------------------------------------
// Mail provider
// ---------------------------------------------------------------------------

const METADATA_HEADERS =
  "metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date";

/**
 * Maps a Gmail label resource into the shared MailLabel contract. Gmail's
 * `type` is already "system" | "user"; anything missing/unexpected is treated
 * as a user label (the safe default — user labels are mutable/movable).
 */
function toMailLabel(label: GmailLabel): MailLabel {
  return {
    id: label.id,
    name: label.name,
    type: label.type === "system" ? "system" : "user",
  };
}

function toUnifiedMessage(
  account: AccountWithTokens,
  msg: GmailMessage,
): UnifiedMessage {
  const headers = msg.payload?.headers;
  const from =
    parseAddress(header(headers, "From")) ?? { email: account.email };
  const to = parseAddressList(header(headers, "To"));
  const labelIds = msg.labelIds ?? [];

  return {
    id: msg.id,
    accountId: account.id,
    provider: "google",
    threadId: msg.threadId ?? null,
    from,
    to,
    subject: header(headers, "Subject"),
    snippet: msg.snippet ?? "",
    date: internalDateToIso(msg.internalDate),
    unread: labelIds.includes("UNREAD"),
    hasAttachments: msg.payload?.mimeType === "multipart/mixed",
  };
}

/**
 * Maps a fully-fetched Gmail message (format=full) into a UnifiedMessageFull.
 * Shared by getMessage and getThread so the two never diverge.
 */
function toFullMessage(
  account: AccountWithTokens,
  msg: GmailMessage,
): UnifiedMessageFull {
  const headers = msg.payload?.headers;
  const base = toUnifiedMessage(account, msg);

  const acc: WalkResult = {
    textBodies: [],
    htmlBodies: [],
    hasAttachments: false,
    attachments: [],
  };
  walkParts(msg.payload, acc);

  const bodyText = acc.textBodies.length ? acc.textBodies.join("\n") : null;
  const bodyHtml = acc.htmlBodies.length ? acc.htmlBodies.join("\n") : null;

  return {
    ...base,
    // `toFullMessage` walks the full payload, so prefer its richer detection.
    hasAttachments: acc.hasAttachments || base.hasAttachments,
    cc: parseAddressList(header(headers, "Cc")),
    bodyHtml,
    bodyText,
    messageIdHeader: header(headers, "Message-ID") || null,
    references: header(headers, "References") || null,
    attachments: acc.attachments,
  };
}

export const googleMailProvider: MailProvider = {
  async listMessages(
    account: AccountWithTokens,
    limit: number,
    query?: string,
    labelId?: string,
  ): Promise<UnifiedMessage[]> {
    // Build the message-list query string. Four cases:
    //   labelId only      -> labelIds={labelId}  (the label/folder listing;
    //                        deliberately NO q=in:inbox so we list that label)
    //   query only        -> q={query}           (full-text Gmail search)
    //   labelId AND query -> labelIds + q         (search scoped to the label)
    //   neither           -> q=in:inbox           (default inbox listing)
    const hasLabel = typeof labelId === "string" && labelId.trim().length > 0;
    const hasQuery = typeof query === "string" && query.trim().length > 0;

    const params: string[] = [
      `maxResults=${encodeURIComponent(String(limit))}`,
    ];
    if (hasLabel) {
      params.push(`labelIds=${encodeURIComponent(labelId as string)}`);
      if (hasQuery) {
        params.push(`q=${encodeURIComponent(query as string)}`);
      }
    } else if (hasQuery) {
      params.push(`q=${encodeURIComponent(query as string)}`);
    } else {
      params.push(`q=${encodeURIComponent("in:inbox")}`);
    }

    const listUrl = `${GMAIL_BASE}/messages?${params.join("&")}`;

    const list = await gfetchJson<{
      messages?: Array<{ id: string; threadId: string }>;
    }>(listUrl, account.accessToken);

    const refs = list.messages ?? [];
    if (refs.length === 0) return [];

    const messages = await mapWithConcurrency(
      refs,
      GMAIL_FETCH_CONCURRENCY,
      async (ref) => {
        const detailUrl =
          `${GMAIL_BASE}/messages/${encodeURIComponent(ref.id)}` +
          `?format=metadata&${METADATA_HEADERS}`;
        const msg = await gfetchJson<GmailMessage>(
          detailUrl,
          account.accessToken,
        );
        return toUnifiedMessage(account, msg);
      },
    );

    return messages;
  },

  async listLabels(account: AccountWithTokens): Promise<MailLabel[]> {
    const data = await gfetchJson<{ labels?: GmailLabel[] }>(
      `${GMAIL_BASE}/labels`,
      account.accessToken,
    );

    const labels = (data.labels ?? [])
      .filter((l): l is GmailLabel => Boolean(l && l.id && l.name))
      .map(toMailLabel);

    // System labels first, then user labels; alphabetical (case-insensitive)
    // within each group for a stable, readable ordering.
    labels.sort((a, b) => {
      if (a.type !== b.type) return a.type === "system" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    return labels;
  },

  async createLabel(
    account: AccountWithTokens,
    name: string,
  ): Promise<MailLabel> {
    const created = await gfetchJson<GmailLabel>(
      `${GMAIL_BASE}/labels`,
      account.accessToken,
      {
        method: "POST",
        body: JSON.stringify({
          name,
          labelListVisibility: "labelShow",
          messageListVisibility: "show",
        }),
      },
    );

    // A freshly created label is always a user label, regardless of what the
    // response echoes back.
    return { id: created.id, name: created.name, type: "user" };
  },

  async moveToLabel(
    account: AccountWithTokens,
    messageIds: string[],
    labelId: string,
  ): Promise<void> {
    if (messageIds.length === 0) return;

    // "Move" in Gmail = apply the destination label and drop it from the
    // inbox, in a single batchModify call.
    await batchModify(account, messageIds, {
      addLabelIds: [labelId],
      removeLabelIds: ["INBOX"],
    });
  },

  async getMessage(
    account: AccountWithTokens,
    messageId: string,
  ): Promise<UnifiedMessageFull> {
    const url = `${GMAIL_BASE}/messages/${encodeURIComponent(messageId)}?format=full`;
    const msg = await gfetchJson<GmailMessage>(url, account.accessToken);
    return toFullMessage(account, msg);
  },

  async getThread(
    account: AccountWithTokens,
    threadId: string,
  ): Promise<UnifiedMessageFull[]> {
    const url = `${GMAIL_BASE}/threads/${encodeURIComponent(threadId)}?format=full`;
    const thread = await gfetchJson<{ messages?: GmailMessage[] }>(
      url,
      account.accessToken,
    );

    const messages = (thread.messages ?? []).map((msg) =>
      toFullMessage(account, msg),
    );

    // Gmail returns thread messages in order, but sort defensively to
    // guarantee oldest-first regardless of API ordering.
    messages.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );

    return messages;
  },

  async getAttachment(
    account: AccountWithTokens,
    messageId: string,
    attachmentId: string,
  ): Promise<DownloadedAttachment> {
    // The attachment endpoint only returns { size, data }, so first fetch the
    // full message to recover the part's filename and mimeType.
    const msgUrl = `${GMAIL_BASE}/messages/${encodeURIComponent(messageId)}?format=full`;
    const msg = await gfetchJson<GmailMessage>(msgUrl, account.accessToken);

    const part = findAttachmentPart(msg.payload, attachmentId);
    const filename = part?.filename || "attachment";
    const mimeType = part?.mimeType || "application/octet-stream";

    const attUrl =
      `${GMAIL_BASE}/messages/${encodeURIComponent(messageId)}` +
      `/attachments/${encodeURIComponent(attachmentId)}`;
    const data = await gfetchJson<{ data?: string; size?: number }>(
      attUrl,
      account.accessToken,
    );

    return {
      filename,
      mimeType,
      contentBase64: base64UrlToStandardBase64(data.data ?? ""),
    };
  },

  async applyAction(
    account: AccountWithTokens,
    messageIds: string[],
    action: MailActionType,
  ): Promise<void> {
    if (messageIds.length === 0) return;

    switch (action) {
      // trash/untrash have no batch endpoint, so fan out one call per id.
      // These return the modified message resource (which we ignore).
      case "trash":
        await Promise.all(
          messageIds.map((id) =>
            gfetch(
              `${GMAIL_BASE}/messages/${encodeURIComponent(id)}/trash`,
              account.accessToken,
              { method: "POST" },
            ),
          ),
        );
        return;
      case "untrash":
        await Promise.all(
          messageIds.map((id) =>
            gfetch(
              `${GMAIL_BASE}/messages/${encodeURIComponent(id)}/untrash`,
              account.accessToken,
              { method: "POST" },
            ),
          ),
        );
        return;
      // Label changes go through batchModify in a single call. It returns 204
      // with no body, so we use gfetch (not gfetchJson) and discard the result.
      case "archive":
        await batchModify(account, messageIds, { removeLabelIds: ["INBOX"] });
        return;
      case "markRead":
        await batchModify(account, messageIds, { removeLabelIds: ["UNREAD"] });
        return;
      case "markUnread":
        await batchModify(account, messageIds, { addLabelIds: ["UNREAD"] });
        return;
      case "star":
        await batchModify(account, messageIds, { addLabelIds: ["STARRED"] });
        return;
      case "unstar":
        await batchModify(account, messageIds, {
          removeLabelIds: ["STARRED"],
        });
        return;
      default: {
        // Exhaustiveness check: a new MailActionType must be handled above.
        const exhaustive: never = action;
        throw new Error(`Unsupported mail action: ${String(exhaustive)}`);
      }
    }
  },

  async listDrafts(
    account: AccountWithTokens,
    limit: number,
  ): Promise<DraftSummary[]> {
    const listUrl = `${GMAIL_BASE}/drafts?maxResults=${encodeURIComponent(String(limit))}`;
    const list = await gfetchJson<{
      drafts?: Array<{ id: string; message?: { id: string } }>;
    }>(listUrl, account.accessToken);

    const refs = list.drafts ?? [];
    if (refs.length === 0) return [];

    const drafts = await mapWithConcurrency(
      refs,
      GMAIL_FETCH_CONCURRENCY,
      async (ref) => {
        const detailUrl =
          `${GMAIL_BASE}/drafts/${encodeURIComponent(ref.id)}` +
          `?format=metadata&metadataHeaders=To&metadataHeaders=Subject`;
        const draft = await gfetchJson<{ id: string; message: GmailMessage }>(
          detailUrl,
          account.accessToken,
        );
        const headers = draft.message.payload?.headers;
        const summary: DraftSummary = {
          id: draft.id,
          accountId: account.id,
          provider: "google",
          to: parseAddressList(header(headers, "To")),
          subject: header(headers, "Subject"),
          snippet: draft.message.snippet ?? "",
          updatedAt: internalDateToIso(draft.message.internalDate),
        };
        return summary;
      },
    );

    return drafts;
  },

  async getDraft(
    account: AccountWithTokens,
    draftId: string,
  ): Promise<DraftContent> {
    const url = `${GMAIL_BASE}/drafts/${encodeURIComponent(draftId)}?format=full`;
    const draft = await gfetchJson<{ id: string; message: GmailMessage }>(
      url,
      account.accessToken,
    );

    const full = toFullMessage(account, draft.message);
    return {
      id: draftId,
      to: full.to,
      cc: full.cc,
      subject: full.subject,
      bodyText: full.bodyText ?? "",
      bodyHtml: full.bodyHtml,
    };
  },

  async createDraft(
    account: AccountWithTokens,
    draft: MailDraft,
    reply?: ReplyContext,
  ): Promise<string> {
    const message: { raw: string; threadId?: string } = {
      raw: buildRawMessage(account, draft, reply),
    };
    if (reply?.threadId) {
      message.threadId = reply.threadId;
    }

    const created = await gfetchJson<{ id: string }>(
      `${GMAIL_BASE}/drafts`,
      account.accessToken,
      {
        method: "POST",
        body: JSON.stringify({ message }),
      },
    );

    return created.id;
  },

  async updateDraft(
    account: AccountWithTokens,
    draftId: string,
    draft: MailDraft,
  ): Promise<void> {
    await gfetch(
      `${GMAIL_BASE}/drafts/${encodeURIComponent(draftId)}`,
      account.accessToken,
      {
        method: "PUT",
        body: JSON.stringify({
          message: { raw: buildRawMessage(account, draft) },
        }),
      },
    );
  },

  async sendDraft(
    account: AccountWithTokens,
    draftId: string,
  ): Promise<void> {
    await gfetch(`${GMAIL_BASE}/drafts/send`, account.accessToken, {
      method: "POST",
      body: JSON.stringify({ id: draftId }),
    });
  },

  async deleteDraft(
    account: AccountWithTokens,
    draftId: string,
  ): Promise<void> {
    // The drafts.delete endpoint returns 204 with no body, so use gfetch
    // rather than gfetchJson and discard the response.
    await gfetch(
      `${GMAIL_BASE}/drafts/${encodeURIComponent(draftId)}`,
      account.accessToken,
      { method: "DELETE" },
    );
  },

  async sendMessage(
    account: AccountWithTokens,
    draft: MailDraft,
    reply?: ReplyContext,
  ): Promise<void> {
    const raw = buildRawMessage(account, draft, reply);

    const payload: { raw: string; threadId?: string } = { raw };
    if (reply?.threadId) {
      payload.threadId = reply.threadId;
    }

    await gfetch(`${GMAIL_BASE}/messages/send`, account.accessToken, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};

/**
 * Builds an RFC 2822 message from a MailDraft and returns it as URL-safe
 * base64 (the `raw` field accepted by Gmail's messages.send and drafts
 * create/update endpoints). Handles both single-part bodies and multipart/
 * mixed messages carrying attachments, and threads replies via In-Reply-To/
 * References headers. Shared by sendMessage, createDraft and updateDraft.
 */
function buildRawMessage(
  account: AccountWithTokens,
  draft: MailDraft,
  reply?: ReplyContext,
): string {
  const useHtml =
    typeof draft.bodyHtml === "string" && draft.bodyHtml.length > 0;
  const bodyContentType = useHtml
    ? 'text/html; charset="utf-8"'
    : 'text/plain; charset="utf-8"';
  const body = useHtml ? (draft.bodyHtml as string) : draft.bodyText;

  const attachments = draft.attachments ?? [];
  const hasAttachments = attachments.length > 0;

  // Top-level headers, shared by both the single-part and multipart paths.
  const topHeaders: string[] = [];
  topHeaders.push(`From: ${account.email}`);
  topHeaders.push(`To: ${draft.to.map(formatHeaderAddress).join(", ")}`);
  if (draft.cc && draft.cc.length > 0) {
    topHeaders.push(`Cc: ${draft.cc.map(formatHeaderAddress).join(", ")}`);
  }
  topHeaders.push(`Subject: ${draft.subject}`);
  topHeaders.push("MIME-Version: 1.0");

  if (reply?.messageIdHeader) {
    topHeaders.push(`In-Reply-To: ${reply.messageIdHeader}`);
    const references = reply.references
      ? `${reply.references} ${reply.messageIdHeader}`
      : reply.messageIdHeader;
    topHeaders.push(`References: ${references}`);
  }

  let rawMessage: string;

  if (hasAttachments) {
    // multipart/mixed: a single body part followed by one part per file.
    const boundary = `==onepane_${randomBytes(16).toString("hex")}==`;
    topHeaders.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

    const segments: string[] = [];

    // Body part.
    segments.push(
      [
        `--${boundary}`,
        `Content-Type: ${bodyContentType}`,
        "Content-Transfer-Encoding: 7bit",
        "",
        body,
      ].join("\r\n"),
    );

    // Attachment parts.
    for (const att of attachments) {
      const filename = att.filename || "attachment";
      const mimeType = att.mimeType || "application/octet-stream";
      segments.push(
        [
          `--${boundary}`,
          `Content-Type: ${mimeType}; name="${filename}"`,
          "Content-Transfer-Encoding: base64",
          `Content-Disposition: attachment; filename="${filename}"`,
          "",
          wrapBase64(att.contentBase64),
        ].join("\r\n"),
      );
    }

    // Closing boundary.
    const bodyBlock = `${segments.join("\r\n")}\r\n--${boundary}--`;
    rawMessage = `${topHeaders.join("\r\n")}\r\n\r\n${bodyBlock}`;
  } else {
    // Single-part path — unchanged from the original implementation.
    topHeaders.push(`Content-Type: ${bodyContentType}`);
    rawMessage = `${topHeaders.join("\r\n")}\r\n\r\n${body}`;
  }

  return encodeBase64Url(rawMessage);
}

/**
 * Recursively searches a Gmail payload for the part whose body.attachmentId
 * matches, so getAttachment can recover its filename and mimeType.
 */
function findAttachmentPart(
  part: GmailPart | undefined,
  attachmentId: string,
): GmailPart | null {
  if (!part) return null;
  if (part.body?.attachmentId === attachmentId) return part;
  if (part.parts) {
    for (const child of part.parts) {
      const found = findAttachmentPart(child, attachmentId);
      if (found) return found;
    }
  }
  return null;
}

/** Renders a MailAddress for an RFC 2822 header value. */
function formatHeaderAddress(addr: MailAddress): string {
  return addr.name ? `${addr.name} <${addr.email}>` : addr.email;
}

/**
 * Adds and/or removes labels on a batch of messages via the Gmail
 * batchModify endpoint (a single request). batchModify responds with 204 and
 * no body, so we use gfetch rather than gfetchJson and discard the response.
 */
async function batchModify(
  account: AccountWithTokens,
  messageIds: string[],
  labels: { addLabelIds?: string[]; removeLabelIds?: string[] },
): Promise<void> {
  await gfetch(`${GMAIL_BASE}/messages/batchModify`, account.accessToken, {
    method: "POST",
    body: JSON.stringify({ ids: messageIds, ...labels }),
  });
}

// ---------------------------------------------------------------------------
// Calendar provider
// ---------------------------------------------------------------------------

interface GoogleEventDateTime {
  date?: string; // YYYY-MM-DD (all-day)
  dateTime?: string; // RFC3339
  timeZone?: string;
}

interface GoogleEventAttendee {
  email?: string;
  displayName?: string;
  responseStatus?: string;
}

interface GoogleEventEntryPoint {
  entryPointType?: string;
  uri?: string;
}

interface GoogleEvent {
  id: string;
  summary?: string;
  description?: string;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
  location?: string;
  hangoutLink?: string;
  htmlLink?: string;
  organizer?: { email?: string; displayName?: string };
  attendees?: GoogleEventAttendee[];
  conferenceData?: { entryPoints?: GoogleEventEntryPoint[] };
}

/** A calendar resource as returned by the calendarList endpoint. */
interface GoogleCalendarListEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  primary?: boolean;
  accessRole?: string;
}

/** Access roles that allow creating/editing events on a calendar. */
const EDITABLE_ACCESS_ROLES: ReadonlyArray<string> = ["owner", "writer"];

const VALID_RESPONSES: ReadonlyArray<string> = [
  "needsAction",
  "accepted",
  "declined",
  "tentative",
];

function mapAttendeeResponse(
  status: string | undefined,
): EventAttendee["responseStatus"] {
  if (status && VALID_RESPONSES.includes(status)) {
    return status as EventAttendee["responseStatus"];
  }
  return undefined;
}

/** Resolves the start/end ISO string from a Google event date/time object. */
function eventDateToIso(dt: GoogleEventDateTime | undefined): string {
  if (!dt) return new Date(0).toISOString();
  if (dt.dateTime) return dt.dateTime;
  if (dt.date) return new Date(`${dt.date}T00:00:00Z`).toISOString();
  return new Date(0).toISOString();
}

/** Extracts a Google Meet join URL from an event, if present. */
function extractMeetUrl(event: GoogleEvent): string | null {
  if (event.hangoutLink) return event.hangoutLink;
  const entry = event.conferenceData?.entryPoints?.find(
    (e) => e.entryPointType === "video" && Boolean(e.uri),
  );
  return entry?.uri ?? null;
}

/** Maps a Google Calendar event resource into a UnifiedEvent. */
function toUnifiedEvent(
  account: AccountWithTokens,
  event: GoogleEvent,
  calendarId: string,
): UnifiedEvent {
  const allDay = Boolean(event.start?.date && !event.start?.dateTime);
  const location = event.location ?? null;

  const meetUrl = extractMeetUrl(event);
  const conferenceType: ConferenceType = meetUrl ? "google_meet" : "none";

  const attendees: EventAttendee[] = (event.attendees ?? [])
    .filter((a) => Boolean(a.email))
    .map((a) => {
      const attendee: EventAttendee = { email: a.email as string };
      if (a.displayName) attendee.name = a.displayName;
      const response = mapAttendeeResponse(a.responseStatus);
      if (response) attendee.responseStatus = response;
      return attendee;
    });

  let organizer: MailAddress | null = null;
  if (event.organizer?.email) {
    organizer = { email: event.organizer.email };
    if (event.organizer.displayName) {
      organizer.name = event.organizer.displayName;
    }
  }

  return {
    id: event.id,
    accountId: account.id,
    calendarId,
    provider: "google",
    title: event.summary ?? "(no title)",
    description: event.description ?? null,
    start: eventDateToIso(event.start),
    end: eventDateToIso(event.end),
    allDay,
    location,
    locationMapsUrl: location ? googleMapsUrl(location) : null,
    attendees,
    conferenceType,
    conferenceUrl: meetUrl,
    organizer,
    htmlLink: event.htmlLink ?? null,
  };
}

/** Formats an ISO datetime into a YYYY-MM-DD date for all-day events. */
function isoToDate(iso: string): string {
  // Take the date portion; fall back to a Date parse if the format is unusual.
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 10);
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * Builds the Google Calendar event request body from an EventDraft. Shared by
 * createEvent and updateEvent so the two never diverge in how they translate a
 * draft (title/description/times/attendees/location/conference) into the API
 * payload. The conferenceData.createRequest is only meaningful on create; on a
 * PATCH it is a no-op when the event already has the same conference, and
 * harmless otherwise, so a single builder is safe for both.
 */
function buildEventBody(
  account: AccountWithTokens,
  draft: EventDraft,
): Record<string, unknown> {
  const start: GoogleEventDateTime = draft.allDay
    ? { date: isoToDate(draft.start) }
    : { dateTime: draft.start, timeZone: "UTC" };
  const end: GoogleEventDateTime = draft.allDay
    ? { date: isoToDate(draft.end) }
    : { dateTime: draft.end, timeZone: "UTC" };

  const body: Record<string, unknown> = {
    summary: draft.title,
    description: draft.description,
    start,
    end,
    attendees: draft.attendees.map((a) => ({ email: a.email })),
  };

  if (draft.locationType === "physical" && draft.physicalLocation) {
    body.location = draft.physicalLocation;
  } else if (
    draft.locationType === "conference" &&
    draft.conferenceType === "google_meet"
  ) {
    body.conferenceData = {
      createRequest: {
        requestId: `${account.id}-${draft.start}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  return body;
}

export const googleCalendarProvider: CalendarProvider = {
  async listCalendars(
    account: AccountWithTokens,
  ): Promise<CalendarInfo[]> {
    const data = await gfetchJson<{ items?: GoogleCalendarListEntry[] }>(
      `${CALENDAR_BASE}/users/me/calendarList`,
      account.accessToken,
    );

    return (data.items ?? [])
      .filter((c): c is GoogleCalendarListEntry => Boolean(c && c.id))
      .map((c) => ({
        id: c.id,
        accountId: account.id,
        provider: "google" as const,
        name: c.summaryOverride ?? c.summary ?? c.id,
        color: c.backgroundColor ?? null,
        primary: Boolean(c.primary),
        canEdit: Boolean(
          c.accessRole && EDITABLE_ACCESS_ROLES.includes(c.accessRole),
        ),
      }));
  },

  async listEvents(
    account: AccountWithTokens,
    range: DateRange,
    calendarId?: string,
  ): Promise<UnifiedEvent[]> {
    const calId = calendarId || "primary";
    const url =
      `${CALENDAR_BASE}/calendars/${encodeURIComponent(calId)}/events` +
      `?timeMin=${encodeURIComponent(range.start)}` +
      `&timeMax=${encodeURIComponent(range.end)}` +
      `&singleEvents=true&orderBy=startTime&maxResults=250`;

    const data = await gfetchJson<{ items?: GoogleEvent[] }>(
      url,
      account.accessToken,
    );

    return (data.items ?? []).map((item) =>
      toUnifiedEvent(account, item, calId),
    );
  },

  async createEvent(
    account: AccountWithTokens,
    draft: EventDraft,
  ): Promise<UnifiedEvent> {
    const calId = draft.calendarId || "primary";
    const body = buildEventBody(account, draft);

    const url =
      `${CALENDAR_BASE}/calendars/${encodeURIComponent(calId)}/events` +
      `?conferenceDataVersion=1&sendUpdates=all`;

    const created = await gfetchJson<GoogleEvent>(url, account.accessToken, {
      method: "POST",
      body: JSON.stringify(body),
    });

    return toUnifiedEvent(account, created, calId);
  },

  async updateEvent(
    account: AccountWithTokens,
    eventId: string,
    draft: EventDraft,
    calendarId?: string,
  ): Promise<UnifiedEvent> {
    const calId = calendarId || draft.calendarId || "primary";
    const body = buildEventBody(account, draft);

    const url =
      `${CALENDAR_BASE}/calendars/${encodeURIComponent(calId)}` +
      `/events/${encodeURIComponent(eventId)}` +
      `?conferenceDataVersion=1&sendUpdates=all`;

    const updated = await gfetchJson<GoogleEvent>(url, account.accessToken, {
      method: "PATCH",
      body: JSON.stringify(body),
    });

    return toUnifiedEvent(account, updated, calId);
  },

  async deleteEvent(
    account: AccountWithTokens,
    eventId: string,
    calendarId?: string,
  ): Promise<void> {
    const calId = calendarId || "primary";
    // events.delete returns 204 with no body, so use gfetch (not gfetchJson).
    await gfetch(
      `${CALENDAR_BASE}/calendars/${encodeURIComponent(calId)}` +
        `/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
      account.accessToken,
      { method: "DELETE" },
    );
  },

  async respondToEvent(
    account: AccountWithTokens,
    eventId: string,
    response: AttendeeResponse,
    calendarId?: string,
  ): Promise<void> {
    const calId = calendarId || "primary";
    const eventUrl =
      `${CALENDAR_BASE}/calendars/${encodeURIComponent(calId)}` +
      `/events/${encodeURIComponent(eventId)}`;

    // Get-modify-patch: fetch the current attendees so other attendees' RSVP
    // statuses are preserved, update (or add) our own, then PATCH the full list.
    const event = await gfetchJson<GoogleEvent>(eventUrl, account.accessToken);

    const attendees = (event.attendees ?? []).map((a) => ({ ...a }));
    const ourEmail = account.email.toLowerCase();
    const existing = attendees.find(
      (a) => (a.email ?? "").toLowerCase() === ourEmail,
    );

    if (existing) {
      existing.responseStatus = response;
    } else {
      attendees.push({ email: account.email, responseStatus: response });
    }

    await gfetch(`${eventUrl}?sendUpdates=all`, account.accessToken, {
      method: "PATCH",
      body: JSON.stringify({ attendees }),
    });
  },
};
