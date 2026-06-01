// POST /api/calendar/events
// Body: { accountId, draft: EventDraft }
// Creates a calendar event/invite on the given account and returns the created
// UnifiedEvent.

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
  if (typeof draft !== "object" || draft === null) {
    return badRequest("A 'draft' object is required.");
  }

  const d = draft as Record<string, unknown>;

  if (typeof d.title !== "string" || d.title.trim().length === 0) {
    return badRequest("'draft.title' is required.");
  }
  if (!isValidIso(d.start)) {
    return badRequest("'draft.start' must be a valid ISO date-time.");
  }
  if (!isValidIso(d.end)) {
    return badRequest("'draft.end' must be a valid ISO date-time.");
  }
  if (new Date(d.end).getTime() < new Date(d.start).getTime()) {
    return badRequest("'draft.end' must not be before 'draft.start'.");
  }
  if (!Array.isArray(d.attendees) || !d.attendees.every(isAttendee)) {
    return badRequest("'draft.attendees' must be an array of valid attendees.");
  }
  if (
    typeof d.locationType !== "string" ||
    !LOCATION_TYPES.includes(d.locationType as EventLocationType)
  ) {
    return badRequest(
      "'draft.locationType' must be 'none', 'physical', or 'conference'.",
    );
  }

  const locationType = d.locationType as EventLocationType;

  if (locationType === "physical") {
    if (typeof d.physicalLocation !== "string" || d.physicalLocation.trim().length === 0) {
      return badRequest(
        "'draft.physicalLocation' is required when locationType is 'physical'.",
      );
    }
  }
  if (locationType === "conference") {
    if (
      typeof d.conferenceType !== "string" ||
      !CONFERENCE_TYPES.includes(d.conferenceType as ConferenceType) ||
      d.conferenceType === "none"
    ) {
      return badRequest(
        "'draft.conferenceType' must be 'google_meet' or 'ms_teams' when locationType is 'conference'.",
      );
    }
  }
  if (d.description !== undefined && typeof d.description !== "string") {
    return badRequest("'draft.description' must be a string.");
  }
  if (d.allDay !== undefined && typeof d.allDay !== "boolean") {
    return badRequest("'draft.allDay' must be a boolean.");
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
  };

  try {
    const account = await getAccountWithTokens(accountId);
    if (!account) {
      return Response.json({ error: "Account not found." }, { status: 404 });
    }

    await getValidAccessToken(account);
    const event = await getCalendarProvider(account.provider).createEvent(
      account,
      validDraft,
    );

    return Response.json({ event });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create event.";
    return Response.json({ error: message }, { status: 502 });
  }
}
