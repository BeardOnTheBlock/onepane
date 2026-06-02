// /api/calendar/events
//   POST   Body: { accountId, draft: EventDraft }
//          Creates a calendar event/invite and returns the created UnifiedEvent.
//   PATCH  Body: { accountId, eventId, draft: EventDraft, calendarId? }
//          Updates an existing event and returns the updated UnifiedEvent.
//   DELETE ?accountId=ID&eventId=EID&calendarId=CID(optional)
//          Deletes (cancels + notifies attendees) an event.

import { getAccountWithTokens } from "@/lib/accounts";
import { getValidAccessToken } from "@/lib/oauth";
import { getCalendarProvider } from "@/lib/providers";
import type {
  ConferenceType,
  EventAttendee,
  EventDraft,
  EventLocationType,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOCATION_TYPES: ReadonlyArray<EventLocationType> = [
  "none",
  "physical",
  "conference",
];
const CONFERENCE_TYPES: ReadonlyArray<ConferenceType> = [
  "none",
  "google_meet",
  "ms_teams",
];

function isAttendee(value: unknown): value is EventAttendee {
  if (typeof value !== "object" || value === null) return false;
  const { email, name } = value as { email?: unknown; name?: unknown };
  if (typeof email !== "string" || !EMAIL_RE.test(email)) return false;
  if (name !== undefined && typeof name !== "string") return false;
  return true;
}

function isValidIso(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

/** Validates an EventDraft. Returns the normalised draft, or an error message. */
function parseEventDraft(
  draft: unknown,
): { draft: EventDraft } | { error: string } {
  if (typeof draft !== "object" || draft === null) {
    return { error: "A 'draft' object is required." };
  }

  const d = draft as Record<string, unknown>;

  if (typeof d.title !== "string" || d.title.trim().length === 0) {
    return { error: "'draft.title' is required." };
  }
  if (!isValidIso(d.start)) {
    return { error: "'draft.start' must be a valid ISO date-time." };
  }
  if (!isValidIso(d.end)) {
    return { error: "'draft.end' must be a valid ISO date-time." };
  }
  if (new Date(d.end).getTime() < new Date(d.start).getTime()) {
    return { error: "'draft.end' must not be before 'draft.start'." };
  }
  if (!Array.isArray(d.attendees) || !d.attendees.every(isAttendee)) {
    return { error: "'draft.attendees' must be an array of valid attendees." };
  }
  if (
    typeof d.locationType !== "string" ||
    !LOCATION_TYPES.includes(d.locationType as EventLocationType)
  ) {
    return {
      error: "'draft.locationType' must be 'none', 'physical', or 'conference'.",
    };
  }

  const locationType = d.locationType as EventLocationType;

  if (locationType === "physical") {
    if (
      typeof d.physicalLocation !== "string" ||
      d.physicalLocation.trim().length === 0
    ) {
      return {
        error:
          "'draft.physicalLocation' is required when locationType is 'physical'.",
      };
    }
  }
  if (locationType === "conference") {
    if (
      typeof d.conferenceType !== "string" ||
      !CONFERENCE_TYPES.includes(d.conferenceType as ConferenceType) ||
      d.conferenceType === "none"
    ) {
      return {
        error:
          "'draft.conferenceType' must be 'google_meet' or 'ms_teams' when locationType is 'conference'.",
      };
    }
  }
  if (d.description !== undefined && typeof d.description !== "string") {
    return { error: "'draft.description' must be a string." };
  }
  if (d.allDay !== undefined && typeof d.allDay !== "boolean") {
    return { error: "'draft.allDay' must be a boolean." };
  }
  if (d.calendarId !== undefined && typeof d.calendarId !== "string") {
    return { error: "'draft.calendarId' must be a string." };
  }

  const validDraft: EventDraft = {
    title: d.title,
    start: d.start,
    end: d.end,
    attendees: d.attendees as EventAttendee[],
    locationType,
    ...(typeof d.description === "string" ? { description: d.description } : {}),
    ...(typeof d.allDay === "boolean" ? { allDay: d.allDay } : {}),
    ...(locationType === "physical"
      ? { physicalLocation: d.physicalLocation as string }
      : {}),
    ...(locationType === "conference"
      ? { conferenceType: d.conferenceType as ConferenceType }
      : {}),
    ...(typeof d.calendarId === "string" ? { calendarId: d.calendarId } : {}),
  };

  return { draft: validDraft };
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const { accountId, draft } = (body ?? {}) as {
    accountId?: unknown;
    draft?: unknown;
  };

  if (typeof accountId !== "string" || accountId.length === 0) {
    return badRequest("A non-empty 'accountId' is required.");
  }

  const parsed = parseEventDraft(draft);
  if ("error" in parsed) {
    return badRequest(parsed.error);
  }

  try {
    const account = await getAccountWithTokens(accountId);
    if (!account) {
      return Response.json({ error: "Account not found." }, { status: 404 });
    }

    await getValidAccessToken(account);
    const event = await getCalendarProvider(account.provider).createEvent(
      account,
      parsed.draft,
    );

    return Response.json({ event });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create event.";
    return Response.json({ error: message }, { status: 502 });
  }
}

export async function PATCH(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const { accountId, eventId, draft, calendarId } = (body ?? {}) as {
    accountId?: unknown;
    eventId?: unknown;
    draft?: unknown;
    calendarId?: unknown;
  };

  if (typeof accountId !== "string" || accountId.length === 0) {
    return badRequest("A non-empty 'accountId' is required.");
  }
  if (typeof eventId !== "string" || eventId.length === 0) {
    return badRequest("A non-empty 'eventId' is required.");
  }
  if (calendarId !== undefined && typeof calendarId !== "string") {
    return badRequest("'calendarId' must be a string.");
  }

  const parsed = parseEventDraft(draft);
  if ("error" in parsed) {
    return badRequest(parsed.error);
  }

  try {
    const account = await getAccountWithTokens(accountId);
    if (!account) {
      return Response.json({ error: "Account not found." }, { status: 404 });
    }

    await getValidAccessToken(account);
    const event = await getCalendarProvider(account.provider).updateEvent(
      account,
      eventId,
      parsed.draft,
      typeof calendarId === "string" ? calendarId : undefined,
    );

    return Response.json({ event });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to update event.";
    return Response.json({ error: message }, { status: 502 });
  }
}

export async function DELETE(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("accountId");
  const eventId = searchParams.get("eventId");
  const calendarId = searchParams.get("calendarId");

  if (!accountId) {
    return badRequest("A non-empty 'accountId' is required.");
  }
  if (!eventId) {
    return badRequest("A non-empty 'eventId' is required.");
  }

  try {
    const account = await getAccountWithTokens(accountId);
    if (!account) {
      return Response.json({ error: "Account not found." }, { status: 404 });
    }

    await getValidAccessToken(account);
    await getCalendarProvider(account.provider).deleteEvent(
      account,
      eventId,
      calendarId ?? undefined,
    );

    return Response.json({ ok: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to delete event.";
    return Response.json({ error: message }, { status: 502 });
  }
}
