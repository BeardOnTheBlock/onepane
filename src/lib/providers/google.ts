// ============================================================================
// Google provider (Gmail + Google Calendar).
//
// SERVER-ONLY. Never import this from a client component.
//
// Assumes `account.accessToken` is already valid — the API layer refreshes it
// before calling these methods, so we simply use it as a Bearer token.
// ============================================================================

import { googleMapsUrl } from "@/lib/utils";
import type {
  AccountWithTokens,
  CalendarProvider,
  ConferenceType,
  DateRange,
  EventAttendee,
  EventDraft,
  MailAddress,
  MailDraft,
  MailProvider,
  ReplyContext,
  UnifiedEvent,
  UnifiedMessage,
  UnifiedMessageFull,
} from "@/lib/types";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

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
}

/**
 * Recursively walks a Gmail payload, collecting decoded text/plain and
 * text/html bodies and detecting attachments (parts with a non-empty
 * filename).
 */
function walkParts(part: GmailPart | undefined, acc: WalkResult): void {
  if (!part) return;

  const mime = part.mimeType ?? "";

  // Any part with a filename is treated as an attachment.
  if (part.filename && part.filename.length > 0) {
    acc.hasAttachments = true;
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

export const googleMailProvider: MailProvider = {
  async listMessages(
    account: AccountWithTokens,
    limit: number,
  ): Promise<UnifiedMessage[]> {
    const listUrl =
      `${GMAIL_BASE}/messages?maxResults=${encodeURIComponent(String(limit))}` +
      `&q=${encodeURIComponent("in:inbox")}`;

    const list = await gfetchJson<{
      messages?: Array<{ id: string; threadId: string }>;
    }>(listUrl, account.accessToken);

    const refs = list.messages ?? [];
    if (refs.length === 0) return [];

    const messages = await Promise.all(
      refs.map(async (ref) => {
        const detailUrl =
          `${GMAIL_BASE}/messages/${encodeURIComponent(ref.id)}` +
          `?format=metadata&${METADATA_HEADERS}`;
        const msg = await gfetchJson<GmailMessage>(
          detailUrl,
          account.accessToken,
        );
        return toUnifiedMessage(account, msg);
      }),
    );

    return messages;
  },

  async getMessage(
    account: AccountWithTokens,
    messageId: string,
  ): Promise<UnifiedMessageFull> {
    const url = `${GMAIL_BASE}/messages/${encodeURIComponent(messageId)}?format=full`;
    const msg = await gfetchJson<GmailMessage>(url, account.accessToken);

    const headers = msg.payload?.headers;
    const base = toUnifiedMessage(account, msg);

    const acc: WalkResult = {
      textBodies: [],
      htmlBodies: [],
      hasAttachments: false,
    };
    walkParts(msg.payload, acc);

    const bodyText = acc.textBodies.length
      ? acc.textBodies.join("\n")
      : null;
    const bodyHtml = acc.htmlBodies.length
      ? acc.htmlBodies.join("\n")
      : null;

    return {
      ...base,
      // `getMessage` walks the full payload, so prefer its richer detection.
      hasAttachments: acc.hasAttachments || base.hasAttachments,
      cc: parseAddressList(header(headers, "Cc")),
      bodyHtml,
      bodyText,
      messageIdHeader: header(headers, "Message-ID") || null,
      references: header(headers, "References") || null,
    };
  },

  async sendMessage(
    account: AccountWithTokens,
    draft: MailDraft,
    reply?: ReplyContext,
  ): Promise<void> {
    const useHtml = typeof draft.bodyHtml === "string" && draft.bodyHtml.length > 0;
    const contentType = useHtml
      ? 'text/html; charset="utf-8"'
      : 'text/plain; charset="utf-8"';
    const body = useHtml ? (draft.bodyHtml as string) : draft.bodyText;

    const lines: string[] = [];
    lines.push(`From: ${account.email}`);
    lines.push(`To: ${draft.to.map(formatHeaderAddress).join(", ")}`);
    if (draft.cc && draft.cc.length > 0) {
      lines.push(`Cc: ${draft.cc.map(formatHeaderAddress).join(", ")}`);
    }
    lines.push(`Subject: ${draft.subject}`);
    lines.push("MIME-Version: 1.0");
    lines.push(`Content-Type: ${contentType}`);

    if (reply?.messageIdHeader) {
      lines.push(`In-Reply-To: ${reply.messageIdHeader}`);
      const references = reply.references
        ? `${reply.references} ${reply.messageIdHeader}`
        : reply.messageIdHeader;
      lines.push(`References: ${references}`);
    }

    // Blank line separates headers from the body (RFC 2822).
    const rawMessage = `${lines.join("\r\n")}\r\n\r\n${body}`;
    const raw = encodeBase64Url(rawMessage);

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

/** Renders a MailAddress for an RFC 2822 header value. */
function formatHeaderAddress(addr: MailAddress): string {
  return addr.name ? `${addr.name} <${addr.email}>` : addr.email;
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

export const googleCalendarProvider: CalendarProvider = {
  async listEvents(
    account: AccountWithTokens,
    range: DateRange,
  ): Promise<UnifiedEvent[]> {
    const url =
      `${CALENDAR_BASE}/calendars/primary/events` +
      `?timeMin=${encodeURIComponent(range.start)}` +
      `&timeMax=${encodeURIComponent(range.end)}` +
      `&singleEvents=true&orderBy=startTime&maxResults=250`;

    const data = await gfetchJson<{ items?: GoogleEvent[] }>(
      url,
      account.accessToken,
    );

    return (data.items ?? []).map((item) => toUnifiedEvent(account, item));
  },

  async createEvent(
    account: AccountWithTokens,
    draft: EventDraft,
  ): Promise<UnifiedEvent> {
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

    const url =
      `${CALENDAR_BASE}/calendars/primary/events` +
      `?conferenceDataVersion=1&sendUpdates=all`;

    const created = await gfetchJson<GoogleEvent>(url, account.accessToken, {
      method: "POST",
      body: JSON.stringify(body),
    });

    return toUnifiedEvent(account, created);
  },
};
