// POST /api/calendar/events/respond
// Body: { accountId, eventId, response: "accepted"|"declined"|"tentative", calendarId? }
// RSVPs to an invitation. Returns { ok: true }.

import { getAccountWithTokens } from "@/lib/accounts";
import { getValidAccessToken } from "@/lib/oauth";
import { getCalendarProvider } from "@/lib/providers";
import type { AttendeeResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

// "needsAction" is the un-responded default and is not a valid RSVP action.
const RSVP_RESPONSES: ReadonlyArray<AttendeeResponse> = [
  "accepted",
  "declined",
  "tentative",
];

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const { accountId, eventId, response, calendarId } = (body ?? {}) as {
    accountId?: unknown;
    eventId?: unknown;
    response?: unknown;
    calendarId?: unknown;
  };

  if (typeof accountId !== "string" || accountId.length === 0) {
    return badRequest("A non-empty 'accountId' is required.");
  }
  if (typeof eventId !== "string" || eventId.length === 0) {
    return badRequest("A non-empty 'eventId' is required.");
  }
  if (
    typeof response !== "string" ||
    !RSVP_RESPONSES.includes(response as AttendeeResponse)
  ) {
    return badRequest(
      "'response' must be 'accepted', 'declined', or 'tentative'.",
    );
  }
  if (calendarId !== undefined && typeof calendarId !== "string") {
    return badRequest("'calendarId' must be a string.");
  }

  try {
    const account = await getAccountWithTokens(accountId);
    if (!account) {
      return Response.json({ error: "Account not found." }, { status: 404 });
    }

    await getValidAccessToken(account);
    await getCalendarProvider(account.provider).respondToEvent(
      account,
      eventId,
      response as AttendeeResponse,
      typeof calendarId === "string" ? calendarId : undefined,
    );

    return Response.json({ ok: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to respond to event.";
    return Response.json({ error: message }, { status: 502 });
  }
}
