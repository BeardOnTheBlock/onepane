// ============================================================================
// Generic IMAP/SMTP mail provider.
//
// SERVER-ONLY. Never import this from a client component.
//
// Generic ("imap") accounts authenticate with a username + (app) password
// rather than OAuth. Their connection details live in an encrypted JSON blob in
// the account token field — read them with parseImapCredentials(account).
//
// Reading + searching mail, downloading attachments, triage (read/star/trash/
// archive), folder management and SMTP sending are implemented properly. Saved
// (server-side) drafts are intentionally out of scope: those methods throw a
// clear error so the MailProvider interface is still honestly satisfied.
//
// Connection hygiene: every method opens its own ImapFlow client (via the
// withClient helper) and ALWAYS closes it in a finally block, so connections
// are never leaked even when a fetch/search throws.
// ============================================================================

import { ImapFlow } from "imapflow";
import type { ListResponse, MessageAddressObject, MessageStructureObject } from "imapflow";
import { simpleParser } from "mailparser";
import type { AddressObject, Attachment, EmailAddress } from "mailparser";
import nodemailer from "nodemailer";

import { parseImapCredentials } from "@/lib/imap-credentials";
import type {
  AccountWithTokens,
  AttachmentMeta,
  DownloadedAttachment,
  DraftContent,
  DraftSummary,
  MailAddress,
  MailActionType,
  MailDraft,
  MailLabel,
  MailProvider,
  ReplyContext,
  UnifiedMessage,
  UnifiedMessageFull,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Default mailbox when no label/folder is specified. */
const INBOX = "INBOX";

/** Hard caps so a misbehaving server can never hang a request indefinitely. */
const CONNECTION_TIMEOUT_MS = 20_000;
const GREETING_TIMEOUT_MS = 16_000;
const SOCKET_TIMEOUT_MS = 60_000;

/** Wait this long for a mailbox lock before giving up (server could be busy). */
const LOCK_ACQUIRE_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Message id encoding
//
// IMAP UIDs are unique only WITHIN a mailbox, so a stable cross-folder message
// id must carry the mailbox too. We encode it as `{mailbox}:{uid}`. Mailbox
// paths can themselves contain ":" (rare, but legal), so we split on the LAST
// colon to recover the uid and treat everything before it as the mailbox.
// ---------------------------------------------------------------------------

/** Encodes a (mailbox, uid) pair into a single opaque message id. */
function encodeId(mailbox: string, uid: number): string {
  return `${mailbox}:${uid}`;
}

/** Decodes a message id back into its mailbox + uid. */
function decodeId(id: string): { mailbox: string; uid: number } {
  const idx = id.lastIndexOf(":");
  if (idx === -1) {
    throw new Error(`Malformed IMAP message id: ${id}`);
  }
  const mailbox = id.slice(0, idx);
  const uid = Number.parseInt(id.slice(idx + 1), 10);
  if (!mailbox || !Number.isFinite(uid)) {
    throw new Error(`Malformed IMAP message id: ${id}`);
  }
  return { mailbox, uid };
}

// ---------------------------------------------------------------------------
// Connection helper
// ---------------------------------------------------------------------------

/**
 * Opens an ImapFlow client from the account's credentials, connects, runs `fn`,
 * and ALWAYS closes the connection afterwards (graceful logout, falling back to
 * a hard close if logout fails). Logging is disabled to keep server logs clean.
 */
async function withClient<T>(
  account: AccountWithTokens,
  fn: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const creds = parseImapCredentials(account);
  const client = new ImapFlow({
    host: creds.imapHost,
    port: creds.imapPort,
    secure: creds.imapSecure,
    auth: { user: creds.username, pass: creds.password },
    logger: false,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  });

  // If the connection drops mid-flight ImapFlow emits 'error'; without a
  // listener Node would treat it as an unhandled exception and crash. We log
  // and swallow — the awaited operation will reject on its own.
  client.on("error", () => {
    /* connection-level errors surface through the awaited op */
  });

  await client.connect();
  try {
    return await fn(client);
  } finally {
    try {
      await client.logout();
    } catch {
      // Best-effort graceful logout; force the socket closed regardless.
      try {
        client.close();
      } catch {
        /* already closed */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

/** Converts an ImapFlow envelope address into our MailAddress shape. */
function toMailAddress(addr: MessageAddressObject): MailAddress | null {
  if (!addr.address) return null;
  const out: MailAddress = { email: addr.address };
  if (addr.name) out.name = addr.name;
  return out;
}

/** Converts an array of envelope addresses into MailAddress[], dropping blanks. */
function toMailAddresses(
  addrs: MessageAddressObject[] | undefined,
): MailAddress[] {
  if (!addrs) return [];
  return addrs
    .map(toMailAddress)
    .filter((a): a is MailAddress => a !== null);
}

/** Flattens a mailparser AddressObject (or array of them) into MailAddress[]. */
function fromParsedAddress(
  addr: AddressObject | AddressObject[] | undefined,
): MailAddress[] {
  if (!addr) return [];
  const objects = Array.isArray(addr) ? addr : [addr];
  const out: MailAddress[] = [];
  for (const obj of objects) {
    collectEmailAddresses(obj.value, out);
  }
  return out;
}

/** Recursively collects EmailAddress entries (groups can nest) into MailAddress[]. */
function collectEmailAddresses(
  values: EmailAddress[] | undefined,
  out: MailAddress[],
): void {
  if (!values) return;
  for (const v of values) {
    if (v.group && v.group.length > 0) {
      collectEmailAddresses(v.group, out);
      continue;
    }
    if (!v.address) continue;
    const entry: MailAddress = { email: v.address };
    if (v.name) entry.name = v.name;
    out.push(entry);
  }
}

/**
 * Walks a parsed BODYSTRUCTURE tree and reports whether the message carries at
 * least one real (non-inline) attachment. A part counts as a downloadable
 * attachment when its Content-Disposition is "attachment", or when it has a
 * filename and is not an inline (cid-referenced) part.
 */
function structureHasAttachment(node: MessageStructureObject | undefined): boolean {
  if (!node) return false;
  if (node.childNodes && node.childNodes.length > 0) {
    return node.childNodes.some(structureHasAttachment);
  }
  const disposition = node.disposition?.toLowerCase();
  if (disposition === "attachment") return true;
  const filename =
    node.dispositionParameters?.filename ?? node.parameters?.name;
  if (filename && disposition !== "inline") return true;
  return false;
}

/** Reads a Buffer fully from a Readable stream. */
async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

/** Formats a MailAddress for an RFC 5322 header value (e.g. `"Name" <a@b>`). */
function formatAddress(addr: MailAddress): string {
  if (addr.name) {
    return `"${addr.name.replace(/"/g, '\\"')}" <${addr.email}>`;
  }
  return addr.email;
}

// ---------------------------------------------------------------------------
// Special-use folder resolution (Trash / Archive)
// ---------------------------------------------------------------------------

/** Picks the folder whose special-use flag matches, else the first name match. */
function pickSpecialFolder(
  folders: ListResponse[],
  specialUse: string,
  nameFallbacks: string[],
): string | null {
  const bySpecialUse = folders.find((f) => f.specialUse === specialUse);
  if (bySpecialUse) return bySpecialUse.path;

  const lowered = nameFallbacks.map((n) => n.toLowerCase());
  const byName = folders.find(
    (f) =>
      lowered.includes(f.name.toLowerCase()) ||
      lowered.includes(f.path.toLowerCase()),
  );
  return byName ? byName.path : null;
}

/** Resolves the account's Trash folder path (with sensible name fallbacks). */
async function resolveTrashFolder(client: ImapFlow): Promise<string> {
  const folders = await client.list();
  const path = pickSpecialFolder(folders, "\\Trash", [
    "Trash",
    "Deleted Messages",
    "Deleted Items",
    "Bin",
  ]);
  if (!path) {
    throw new Error("Could not find a Trash folder on this account.");
  }
  return path;
}

/** Resolves the account's Archive folder path (with sensible name fallbacks). */
async function resolveArchiveFolder(client: ImapFlow): Promise<string> {
  const folders = await client.list();
  const path = pickSpecialFolder(folders, "\\Archive", [
    "Archive",
    "Archives",
    "All Mail",
  ]);
  if (!path) {
    throw new Error("Could not find an Archive folder on this account.");
  }
  return path;
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

const DRAFTS_UNSUPPORTED = "Drafts aren't supported for IMAP accounts yet.";

export const imapMailProvider: MailProvider = {
  async listMessages(
    account: AccountWithTokens,
    limit: number,
    query?: string,
    labelId?: string,
  ): Promise<UnifiedMessage[]> {
    const mailbox = labelId || INBOX;

    return withClient(account, async (client) => {
      const lock = await client.getMailboxLock(mailbox, {
        acquireTimeout: LOCK_ACQUIRE_TIMEOUT_MS,
      });
      try {
        // Decide which UIDs to fetch.
        let uids: number[];
        if (query) {
          // Prefer a structured OR search across subject/body/from; if the
          // server rejects it, fall back to a broad TEXT search.
          let result = await client.search(
            {
              or: [{ subject: query }, { body: query }, { from: query }],
            },
            { uid: true },
          );
          if (!result || (Array.isArray(result) && result.length === 0)) {
            result = await client.search({ text: query }, { uid: true });
          }
          uids = Array.isArray(result) ? result : [];
        } else {
          // No query: take the newest `limit` messages. UIDs are monotonically
          // increasing, so the highest UIDs are the most recent.
          const mailboxObj = client.mailbox;
          const exists = mailboxObj ? mailboxObj.exists : 0;
          if (exists === 0) return [];
          // Search for everything, then slice the newest by UID below. (A
          // sequence range "1:*" would also work, but search keeps uid-mode
          // consistent across both branches.)
          const all = await client.search({ all: true }, { uid: true });
          uids = Array.isArray(all) ? all : [];
        }

        if (uids.length === 0) return [];

        // Newest first, then cap to `limit`.
        uids.sort((a, b) => b - a);
        const selected = uids.slice(0, Math.max(0, limit));
        if (selected.length === 0) return [];

        const messages: UnifiedMessage[] = [];
        for await (const msg of client.fetch(
          selected,
          {
            uid: true,
            envelope: true,
            flags: true,
            bodyStructure: true,
            internalDate: true,
          },
          { uid: true },
        )) {
          const env = msg.envelope;
          const from = env?.from && env.from.length > 0
            ? toMailAddress(env.from[0])
            : null;
          const internalDate =
            msg.internalDate instanceof Date
              ? msg.internalDate
              : msg.internalDate
                ? new Date(msg.internalDate)
                : (env?.date ?? new Date(0));

          messages.push({
            id: encodeId(mailbox, msg.uid),
            accountId: account.id,
            provider: "imap",
            threadId: null,
            from: from ?? { email: "" },
            to: toMailAddresses(env?.to),
            subject: env?.subject ?? "",
            snippet: "",
            date: internalDate.toISOString(),
            unread: !(msg.flags?.has("\\Seen") ?? false),
            hasAttachments: structureHasAttachment(msg.bodyStructure),
          });
        }

        // fetch() may not preserve our requested order; re-sort newest first.
        messages.sort((a, b) => b.date.localeCompare(a.date));
        return messages;
      } finally {
        lock.release();
      }
    });
  },

  async listLabels(account: AccountWithTokens): Promise<MailLabel[]> {
    return withClient(account, async (client) => {
      const folders = await client.list();
      return folders.map((f) => ({
        id: f.path,
        name: f.name,
        type: f.specialUse ? ("system" as const) : ("user" as const),
      }));
    });
  },

  async createLabel(
    account: AccountWithTokens,
    name: string,
  ): Promise<MailLabel> {
    return withClient(account, async (client) => {
      const result = await client.mailboxCreate(name);
      return {
        id: result.path,
        name,
        type: "user" as const,
      };
    });
  },

  async moveToLabel(
    account: AccountWithTokens,
    messageIds: string[],
    labelId: string,
  ): Promise<void> {
    const byMailbox = groupByMailbox(messageIds);
    await withClient(account, async (client) => {
      for (const [mailbox, uids] of byMailbox) {
        if (mailbox === labelId) continue; // already there
        const lock = await client.getMailboxLock(mailbox, {
          acquireTimeout: LOCK_ACQUIRE_TIMEOUT_MS,
        });
        try {
          await client.messageMove(uids, labelId, { uid: true });
        } finally {
          lock.release();
        }
      }
    });
  },

  async getMessage(
    account: AccountWithTokens,
    messageId: string,
  ): Promise<UnifiedMessageFull> {
    const { mailbox, uid } = decodeId(messageId);

    return withClient(account, async (client) => {
      const lock = await client.getMailboxLock(mailbox, {
        acquireTimeout: LOCK_ACQUIRE_TIMEOUT_MS,
      });
      try {
        // Pull flags/internalDate alongside the raw source so the full view
        // matches the list view (unread state, date, etc).
        const meta = await client.fetchOne(
          String(uid),
          { uid: true, flags: true, internalDate: true, envelope: true },
          { uid: true },
        );

        const dl = await client.download(String(uid), undefined, {
          uid: true,
        });
        const source = await streamToBuffer(dl.content);
        const parsed = await simpleParser(source);

        const from = fromParsedAddress(parsed.from);
        const internalDate =
          meta && meta.internalDate
            ? meta.internalDate instanceof Date
              ? meta.internalDate
              : new Date(meta.internalDate)
            : (parsed.date ?? new Date(0));

        const references =
          parsed.references == null
            ? null
            : Array.isArray(parsed.references)
              ? parsed.references.join(" ")
              : parsed.references;

        const attachments: AttachmentMeta[] = parsed.attachments.map(
          (a: Attachment, i: number) => ({
            id: a.contentId || String(i),
            filename: a.filename || "attachment",
            mimeType: a.contentType,
            size: a.size ?? 0,
            inline: !!a.related,
          }),
        );

        const full: UnifiedMessageFull = {
          id: messageId,
          accountId: account.id,
          provider: "imap",
          threadId: null,
          from: from[0] ?? { email: "" },
          to: fromParsedAddress(parsed.to),
          cc: fromParsedAddress(parsed.cc),
          subject: parsed.subject ?? "",
          snippet: "",
          date: internalDate.toISOString(),
          unread: meta ? !(meta.flags?.has("\\Seen") ?? false) : false,
          hasAttachments: attachments.some((a) => !a.inline),
          bodyHtml: parsed.html === false ? null : (parsed.html ?? null),
          bodyText: parsed.text ?? null,
          messageIdHeader: parsed.messageId ?? null,
          references,
          attachments,
        };
        return full;
      } finally {
        lock.release();
      }
    });
  },

  async getThread(
    account: AccountWithTokens,
    threadId: string,
  ): Promise<UnifiedMessageFull[]> {
    // IMAP has no portable server-side threading in scope; treat the threadId
    // as a single message id and return just that message.
    return [await this.getMessage(account, threadId)];
  },

  async getAttachment(
    account: AccountWithTokens,
    messageId: string,
    attachmentId: string,
  ): Promise<DownloadedAttachment> {
    const { mailbox, uid } = decodeId(messageId);

    return withClient(account, async (client) => {
      const lock = await client.getMailboxLock(mailbox, {
        acquireTimeout: LOCK_ACQUIRE_TIMEOUT_MS,
      });
      try {
        const dl = await client.download(String(uid), undefined, {
          uid: true,
        });
        const source = await streamToBuffer(dl.content);
        const parsed = await simpleParser(source);

        // Match by Content-ID first (stable), else fall back to index.
        let found: Attachment | undefined = parsed.attachments.find(
          (a) => a.contentId && a.contentId === attachmentId,
        );
        if (!found) {
          const idx = Number.parseInt(attachmentId, 10);
          if (Number.isInteger(idx) && idx >= 0 && idx < parsed.attachments.length) {
            found = parsed.attachments[idx];
          }
        }
        if (!found) {
          throw new Error(`Attachment ${attachmentId} not found on message.`);
        }

        return {
          filename: found.filename || "attachment",
          mimeType: found.contentType,
          contentBase64: found.content.toString("base64"),
        };
      } finally {
        lock.release();
      }
    });
  },

  async applyAction(
    account: AccountWithTokens,
    messageIds: string[],
    action: MailActionType,
  ): Promise<void> {
    const byMailbox = groupByMailbox(messageIds);

    await withClient(account, async (client) => {
      // Resolve destination folders once (only when needed) to avoid repeated
      // LIST round-trips inside the per-mailbox loop.
      let trashFolder: string | null = null;
      let archiveFolder: string | null = null;
      if (action === "trash") trashFolder = await resolveTrashFolder(client);
      if (action === "archive") archiveFolder = await resolveArchiveFolder(client);

      for (const [mailbox, uids] of byMailbox) {
        const lock = await client.getMailboxLock(mailbox, {
          acquireTimeout: LOCK_ACQUIRE_TIMEOUT_MS,
        });
        try {
          switch (action) {
            case "markRead":
              await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
              break;
            case "markUnread":
              await client.messageFlagsRemove(uids, ["\\Seen"], { uid: true });
              break;
            case "star":
              await client.messageFlagsAdd(uids, ["\\Flagged"], { uid: true });
              break;
            case "unstar":
              await client.messageFlagsRemove(uids, ["\\Flagged"], {
                uid: true,
              });
              break;
            case "trash":
              if (trashFolder && trashFolder !== mailbox) {
                await client.messageMove(uids, trashFolder, { uid: true });
              }
              break;
            case "untrash":
              if (mailbox !== INBOX) {
                await client.messageMove(uids, INBOX, { uid: true });
              }
              break;
            case "archive":
              if (archiveFolder && archiveFolder !== mailbox) {
                await client.messageMove(uids, archiveFolder, { uid: true });
              }
              break;
            default: {
              // Exhaustiveness guard — if MailActionType grows, TS flags this.
              const _exhaustive: never = action;
              throw new Error(`Unsupported action: ${String(_exhaustive)}`);
            }
          }
        } finally {
          lock.release();
        }
      }
    });
  },

  async listDrafts(): Promise<DraftSummary[]> {
    throw new Error(DRAFTS_UNSUPPORTED);
  },

  async getDraft(): Promise<DraftContent> {
    throw new Error(DRAFTS_UNSUPPORTED);
  },

  async createDraft(): Promise<string> {
    throw new Error(DRAFTS_UNSUPPORTED);
  },

  async updateDraft(): Promise<void> {
    throw new Error(DRAFTS_UNSUPPORTED);
  },

  async sendDraft(): Promise<void> {
    throw new Error(DRAFTS_UNSUPPORTED);
  },

  async deleteDraft(): Promise<void> {
    throw new Error(DRAFTS_UNSUPPORTED);
  },

  async sendMessage(
    account: AccountWithTokens,
    draft: MailDraft,
    reply?: ReplyContext,
  ): Promise<void> {
    const creds = parseImapCredentials(account);

    const transporter = nodemailer.createTransport({
      host: creds.smtpHost,
      port: creds.smtpPort,
      secure: creds.smtpSecure,
      auth: { user: creds.username, pass: creds.password },
      connectionTimeout: CONNECTION_TIMEOUT_MS,
      greetingTimeout: GREETING_TIMEOUT_MS,
      socketTimeout: SOCKET_TIMEOUT_MS,
    });

    try {
      await transporter.sendMail({
        from: account.email,
        to: draft.to.map(formatAddress),
        cc: draft.cc && draft.cc.length > 0 ? draft.cc.map(formatAddress) : undefined,
        subject: draft.subject,
        text: draft.bodyText,
        html: draft.bodyHtml,
        attachments: draft.attachments?.map((a) => ({
          filename: a.filename,
          content: a.contentBase64,
          encoding: "base64" as const,
          contentType: a.mimeType,
        })),
        inReplyTo: reply?.messageIdHeader ?? undefined,
        references: reply?.references ?? undefined,
      });
    } finally {
      transporter.close();
    }
  },
};

// ---------------------------------------------------------------------------
// Internal: group message ids by mailbox for batched per-folder operations.
// ---------------------------------------------------------------------------

/** Groups encoded message ids by their mailbox into mailbox -> uid[] entries. */
function groupByMailbox(messageIds: string[]): Map<string, number[]> {
  const byMailbox = new Map<string, number[]>();
  for (const id of messageIds) {
    const { mailbox, uid } = decodeId(id);
    const existing = byMailbox.get(mailbox);
    if (existing) {
      existing.push(uid);
    } else {
      byMailbox.set(mailbox, [uid]);
    }
  }
  return byMailbox;
}
