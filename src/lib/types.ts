// ============================================================================
// OnePane shared contracts.
// These types are the single source of truth shared between the data layer,
// the provider implementations, the API routes, and the UI. Keep them stable.
// ============================================================================

export type ProviderId = "google" | "microsoft";

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/** Account info that is safe to send to the browser (never includes tokens). */
export interface AccountPublic {
  id: string;
  provider: ProviderId;
  email: string;
  displayName: string | null;
  /** Hex colour used to colour-code this account across the UI. */
  color: string;
  createdAt: string; // ISO
  /** True for Microsoft work/school accounts that can host Teams meetings. */
  canTeams: boolean;
  /** True for Google accounts that can create Google Meet links. */
  canMeet: boolean;
}

/** Server-only: an account including its (decrypted) OAuth tokens. */
export interface AccountWithTokens extends AccountPublic {
  accessToken: string;
  refreshToken: string | null;
  tokenExpiry: string; // ISO
  scopes: string;
}

// ---------------------------------------------------------------------------
// Mail
// ---------------------------------------------------------------------------

export interface MailAddress {
  name?: string;
  email: string;
}

/** A message as shown in the unified inbox list. */
export interface UnifiedMessage {
  id: string; // provider message id
  accountId: string;
  provider: ProviderId;
  threadId: string | null;
  from: MailAddress;
  to: MailAddress[];
  subject: string;
  snippet: string; // short plain-text preview
  date: string; // ISO
  unread: boolean;
  hasAttachments: boolean;
}

/** A fully-loaded message (body + headers needed to thread replies). */
export interface UnifiedMessageFull extends UnifiedMessage {
  cc: MailAddress[];
  bodyHtml: string | null;
  bodyText: string | null;
  /** RFC822 Message-ID header of this message, for In-Reply-To/References. */
  messageIdHeader: string | null;
  /** Existing References header, if any. */
  references: string | null;
}

/** A new outgoing message. */
export interface MailDraft {
  to: MailAddress[];
  cc?: MailAddress[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
}

/** Threading context supplied when a draft is a reply to an existing message. */
export interface ReplyContext {
  inReplyToMessageId: string; // provider message id being replied to
  threadId: string | null;
  messageIdHeader: string | null;
  references: string | null;
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export type AttendeeResponse =
  | "needsAction"
  | "accepted"
  | "declined"
  | "tentative";

export interface EventAttendee {
  email: string;
  name?: string;
  responseStatus?: AttendeeResponse;
}

export type ConferenceType = "none" | "google_meet" | "ms_teams";

/** A calendar event as shown in the unified calendar. */
export interface UnifiedEvent {
  id: string;
  accountId: string;
  provider: ProviderId;
  title: string;
  description: string | null;
  start: string; // ISO
  end: string; // ISO
  allDay: boolean;
  /** Physical location text, if the event has one. */
  location: string | null;
  /** Google Maps link generated from `location`, if present. */
  locationMapsUrl: string | null;
  attendees: EventAttendee[];
  conferenceType: ConferenceType;
  /** Join URL for the Meet/Teams meeting, if present. */
  conferenceUrl: string | null;
  organizer: MailAddress | null;
  /** Deep link to open the event in the provider's own web UI. */
  htmlLink: string | null;
}

/** Where an event takes place. Physical and conference are mutually exclusive. */
export type EventLocationType = "none" | "physical" | "conference";

/** A new event/invite to create. */
export interface EventDraft {
  title: string;
  description?: string;
  start: string; // ISO
  end: string; // ISO
  allDay?: boolean;
  attendees: EventAttendee[];
  locationType: EventLocationType;
  /** Required when locationType === "physical". */
  physicalLocation?: string;
  /** Required when locationType === "conference". */
  conferenceType?: ConferenceType;
}

// ---------------------------------------------------------------------------
// Provider interfaces — implemented once per provider (Google, Microsoft).
// ---------------------------------------------------------------------------

export interface DateRange {
  start: string; // ISO
  end: string; // ISO
}

export interface MailProvider {
  listMessages(
    account: AccountWithTokens,
    limit: number,
  ): Promise<UnifiedMessage[]>;
  getMessage(
    account: AccountWithTokens,
    messageId: string,
  ): Promise<UnifiedMessageFull>;
  sendMessage(
    account: AccountWithTokens,
    draft: MailDraft,
    reply?: ReplyContext,
  ): Promise<void>;
}

export interface CalendarProvider {
  listEvents(
    account: AccountWithTokens,
    range: DateRange,
  ): Promise<UnifiedEvent[]>;
  createEvent(
    account: AccountWithTokens,
    draft: EventDraft,
  ): Promise<UnifiedEvent>;
}

// ---------------------------------------------------------------------------
// API response envelopes (shared by route handlers and the client hooks).
// ---------------------------------------------------------------------------

/** Per-account error surfaced in aggregated responses (one account failing
 *  should never blank out the whole unified view). */
export interface AccountError {
  accountId: string;
  email: string;
  message: string;
}

export interface AccountsResponse {
  accounts: AccountPublic[];
}

export interface MailListResponse {
  messages: UnifiedMessage[];
  errors: AccountError[];
}

export interface MailMessageResponse {
  message: UnifiedMessageFull;
}

export interface CalendarListResponse {
  events: UnifiedEvent[];
  errors: AccountError[];
}

export interface CreateEventResponse {
  event: UnifiedEvent;
}

export interface OkResponse {
  ok: true;
}

export interface ErrorResponse {
  error: string;
}
