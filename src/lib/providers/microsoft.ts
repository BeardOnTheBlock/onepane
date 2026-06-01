// ============================================================================
// Microsoft Graph (v1.0) provider implementation.
//
// SERVER-ONLY. Never import this module into a client component.
//
// Implements the MailProvider and CalendarProvider contracts from
// "@/lib/types" against the Microsoft Graph REST API. The account's
// accessToken is assumed to already be valid and is used as a Bearer token;
// token refresh is handled upstream by the data layer.
// ============================================================================

import { googleMapsUrl } from "@/lib/utils";
import type {
  AccountWithTokens,
  AttendeeResponse,
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

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

/**
 * Fetch a Graph endpoint with the account's bearer token. Sets the
 * Authorization and Content-Type headers and throws a descriptive error
 * (status + body) on any non-2xx response.
 */
async function gfetch(
  url: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
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
      // ignore body read failure; status is still informative
    }
    throw new Error(
      `Microsoft Graph request failed: ${res.status} ${res.statusText}` +
        (body ? ` — ${body}` : ""),
    );
  }
  return res;
}

// ---------------------------------------------------------------------------
// Graph response shapes (only the fields we read; everything optional/defensive)
// ---------------------------------------------------------------------------

interface GraphEmailAddress {
  name?: string | null;
  address?: string | null;
}

interface GraphRecipient {
  emailAddress?: GraphEmailAddress | null;
}

interface GraphItemBody {
  contentType?: string | null;
  content?: string | null;
}

interface GraphMessage {
  id: string;
  conversationId?: string | null;
  subject?: string | null;
  from?: GraphRecipient | null;
  toRecipients?: GraphRecipient[] | null;
  ccRecipients?: GraphRecipient[] | null;
  receivedDateTime?: string | null;
  isRead?: boolean | null;
  hasAttachments?: boolean | null;
  bodyPreview?: string | null;
  body?: GraphItemBody | null;
  internetMessageId?: string | null;
}

interface GraphDateTimeTimeZone {
  dateTime?: string | null;
  timeZone?: string | null;
}

interface GraphLocation {
  displayName?: string | null;
}

interface GraphAttendeeStatus {
  response?: string | null;
}

interface GraphAttendee {
  emailAddress?: GraphEmailAddress | null;
  status?: GraphAttendeeStatus | null;
}

interface GraphOnlineMeeting {
  joinUrl?: string | null;
}

interface GraphEvent {
  id: string;
  subject?: string | null;
  bodyPreview?: string | null;
  body?: GraphItemBody | null;
  start?: GraphDateTimeTimeZone | null;
  end?: GraphDateTimeTimeZone | null;
  isAllDay?: boolean | null;
  location?: GraphLocation | null;
  attendees?: GraphAttendee[] | null;
  organizer?: GraphRecipient | null;
  onlineMeeting?: GraphOnlineMeeting | null;
  isOnlineMeeting?: boolean | null;
  webLink?: string | null;
}

interface GraphList<T> {
  value?: T[] | null;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

/** Convert a Graph recipient/emailAddress into our MailAddress, defaulting safely. */
function toMailAddress(
  ea: GraphEmailAddress | null | undefined,
): MailAddress | null {
  if (!ea || !ea.address) return null;
  const addr: MailAddress = { email: ea.address };
  if (ea.name) addr.name = ea.name;
  return addr;
}

/** Map a list of Graph recipients to MailAddress[], dropping any without an address. */
function toMailAddresses(
  recipients: GraphRecipient[] | null | undefined,
): MailAddress[] {
  if (!recipients) return [];
  const out: MailAddress[] = [];
  for (const r of recipients) {
    const a = toMailAddress(r?.emailAddress);
    if (a) out.push(a);
  }
  return out;
}

/** Build the JSON recipient objects Graph expects from our MailAddress list. */
function toGraphRecipients(addresses: MailAddress[]): Array<{
  emailAddress: { address: string; name?: string };
}> {
  return addresses.map((a) => ({
    emailAddress: a.name
      ? { address: a.email, name: a.name }
      : { address: a.email },
  }));
}

/** Map a Graph message to the unified inbox-list shape. */
function mapMessage(account: AccountWithTokens, m: GraphMessage): UnifiedMessage {
  return {
    id: m.id,
    accountId: account.id,
    provider: "microsoft",
    threadId: m.conversationId ?? null,
    from: toMailAddress(m.from?.emailAddress) ?? { email: "" },
    to: toMailAddresses(m.toRecipients),
    subject: m.subject ?? "",
    snippet: m.bodyPreview ?? "",
    date: m.receivedDateTime ?? "",
    unread: !(m.isRead ?? false),
    hasAttachments: m.hasAttachments ?? false,
  };
}

/**
 * The Graph calendarView dateTime is a local-clock value without a trailing
 * "Z" even when the timezone is UTC (we always request UTC via the Prefer
 * header). Append "Z" to produce a valid ISO-8601 instant. Defaults to "".
 */
function graphUtcToIso(dt: GraphDateTimeTimeZone | null | undefined): string {
  const value = dt?.dateTime;
  if (!value) return "";
  return value.endsWith("Z") ? value : `${value}Z`;
}

/** Map a Graph attendee response string to our AttendeeResponse enum. */
function mapAttendeeResponse(
  response: string | null | undefined,
): AttendeeResponse {
  switch (response) {
    case "accepted":
      return "accepted";
    case "declined":
      return "declined";
    case "tentativelyAccepted":
      return "tentative";
    case "none":
    case "notResponded":
    case "organizer":
    default:
      return "needsAction";
  }
}

/** Map a Graph event to the unified calendar shape. */
function mapEvent(account: AccountWithTokens, e: GraphEvent): UnifiedEvent {
  const locationName = e.location?.displayName || null;

  const isOnline = Boolean(e.isOnlineMeeting) || Boolean(e.onlineMeeting?.joinUrl);
  const conferenceUrl = e.onlineMeeting?.joinUrl ?? null;
  const conferenceType: ConferenceType =
    isOnline && conferenceUrl ? "ms_teams" : "none";

  const attendees: EventAttendee[] = (e.attendees ?? []).flatMap((a) => {
    const address = a?.emailAddress?.address;
    if (!address) return [];
    const attendee: EventAttendee = {
      email: address,
      responseStatus: mapAttendeeResponse(a.status?.response),
    };
    if (a.emailAddress?.name) attendee.name = a.emailAddress.name;
    return [attendee];
  });

  return {
    id: e.id,
    accountId: account.id,
    provider: "microsoft",
    title: e.subject ?? "",
    description: e.bodyPreview || null,
    start: graphUtcToIso(e.start),
    end: graphUtcToIso(e.end),
    allDay: e.isAllDay ?? false,
    location: locationName,
    locationMapsUrl: locationName ? googleMapsUrl(locationName) : null,
    attendees,
    conferenceType,
    conferenceUrl: conferenceType === "ms_teams" ? conferenceUrl : null,
    organizer: toMailAddress(e.organizer?.emailAddress),
    htmlLink: e.webLink ?? null,
  };
}

/**
 * Format an ISO instant as the local-clock UTC string Graph pairs with an
 * explicit timeZone of "UTC": "YYYY-MM-DDTHH:mm:ss" with no trailing "Z".
 * Uses the Date object's getUTC* accessors so the wall-clock matches UTC.
 */
function toGraphLocalUtc(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = d.getUTCFullYear();
  const month = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const hours = pad(d.getUTCHours());
  const minutes = pad(d.getUTCMinutes());
  const seconds = pad(d.getUTCSeconds());
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

// ---------------------------------------------------------------------------
// Mail provider
// ---------------------------------------------------------------------------

export const microsoftMailProvider: MailProvider = {
  async listMessages(
    account: AccountWithTokens,
    limit: number,
  ): Promise<UnifiedMessage[]> {
    const select =
      "id,conversationId,subject,from,toRecipients,receivedDateTime,isRead,hasAttachments,bodyPreview";
    const url =
      `${GRAPH_BASE}/me/mailFolders/inbox/messages` +
      `?$top=${encodeURIComponent(String(limit))}` +
      `&$orderby=${encodeURIComponent("receivedDateTime desc")}` +
      `&$select=${encodeURIComponent(select)}`;

    const res = await gfetch(url, account.accessToken);
    const data = (await res.json()) as GraphList<GraphMessage>;
    return (data.value ?? []).map((m) => mapMessage(account, m));
  },

  async getMessage(
    account: AccountWithTokens,
    messageId: string,
  ): Promise<UnifiedMessageFull> {
    const select =
      "id,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,hasAttachments,bodyPreview,body,internetMessageId";
    const url =
      `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}` +
      `?$select=${encodeURIComponent(select)}`;

    const res = await gfetch(url, account.accessToken);
    const m = (await res.json()) as GraphMessage;

    const base = mapMessage(account, m);

    const contentType = (m.body?.contentType ?? "").toLowerCase();
    const content = m.body?.content ?? null;
    const isHtml = contentType === "html";

    return {
      ...base,
      cc: toMailAddresses(m.ccRecipients),
      bodyHtml: isHtml ? content : null,
      bodyText: isHtml ? null : content,
      messageIdHeader: m.internetMessageId ?? null,
      references: null,
    };
  },

  async sendMessage(
    account: AccountWithTokens,
    draft: MailDraft,
    reply?: ReplyContext,
  ): Promise<void> {
    const useHtml = Boolean(draft.bodyHtml);
    const body = {
      contentType: useHtml ? "HTML" : "Text",
      content: draft.bodyHtml ?? draft.bodyText,
    };

    if (!reply) {
      // New, standalone message.
      const payload = {
        message: {
          subject: draft.subject,
          body,
          toRecipients: toGraphRecipients(draft.to),
          ccRecipients: toGraphRecipients(draft.cc ?? []),
        },
        saveToSentItems: true,
      };
      await gfetch(`${GRAPH_BASE}/me/sendMail`, account.accessToken, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return;
    }

    // Reply: use the createReply pattern so Graph preserves correct threading.
    // 1) Create a reply draft seeded with the original conversation context.
    const createRes = await gfetch(
      `${GRAPH_BASE}/me/messages/${encodeURIComponent(
        reply.inReplyToMessageId,
      )}/createReply`,
      account.accessToken,
      { method: "POST" },
    );
    const draftMessage = (await createRes.json()) as { id: string };
    const draftId = draftMessage.id;

    // 2) Patch the draft with our body and recipients.
    await gfetch(
      `${GRAPH_BASE}/me/messages/${encodeURIComponent(draftId)}`,
      account.accessToken,
      {
        method: "PATCH",
        body: JSON.stringify({
          body,
          toRecipients: toGraphRecipients(draft.to),
        }),
      },
    );

    // 3) Send the draft.
    await gfetch(
      `${GRAPH_BASE}/me/messages/${encodeURIComponent(draftId)}/send`,
      account.accessToken,
      { method: "POST" },
    );
  },
};

// ---------------------------------------------------------------------------
// Calendar provider
// ---------------------------------------------------------------------------

export const microsoftCalendarProvider: CalendarProvider = {
  async listEvents(
    account: AccountWithTokens,
    range: DateRange,
  ): Promise<UnifiedEvent[]> {
    const select =
      "id,subject,bodyPreview,start,end,isAllDay,location,attendees,organizer,onlineMeeting,isOnlineMeeting,webLink";
    const url =
      `${GRAPH_BASE}/me/calendarView` +
      `?startDateTime=${encodeURIComponent(range.start)}` +
      `&endDateTime=${encodeURIComponent(range.end)}` +
      `&$top=250` +
      `&$orderby=${encodeURIComponent("start/dateTime")}` +
      `&$select=${encodeURIComponent(select)}`;

    const res = await gfetch(url, account.accessToken, {
      headers: { Prefer: 'outlook.timezone="UTC"' },
    });
    const data = (await res.json()) as GraphList<GraphEvent>;
    return (data.value ?? []).map((e) => mapEvent(account, e));
  },

  async createEvent(
    account: AccountWithTokens,
    draft: EventDraft,
  ): Promise<UnifiedEvent> {
    const payload: Record<string, unknown> = {
      subject: draft.title,
      body: {
        contentType: "HTML",
        content: draft.description ?? "",
      },
      start: {
        dateTime: toGraphLocalUtc(draft.start),
        timeZone: "UTC",
      },
      end: {
        dateTime: toGraphLocalUtc(draft.end),
        timeZone: "UTC",
      },
      isAllDay: Boolean(draft.allDay),
      attendees: draft.attendees.map((a) => ({
        emailAddress: a.name
          ? { address: a.email, name: a.name }
          : { address: a.email },
        type: "required",
      })),
    };

    if (draft.locationType === "physical" && draft.physicalLocation) {
      payload.location = { displayName: draft.physicalLocation };
    } else if (
      draft.locationType === "conference" &&
      draft.conferenceType === "ms_teams"
    ) {
      payload.isOnlineMeeting = true;
      payload.onlineMeetingProvider = "teamsForBusiness";
    }

    const res = await gfetch(`${GRAPH_BASE}/me/events`, account.accessToken, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const created = (await res.json()) as GraphEvent;
    return mapEvent(account, created);
  },
};
