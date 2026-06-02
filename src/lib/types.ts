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

/** Metadata for an attachment on a received message. */
export interface AttachmentMeta {
  /** Provider attachment id, used to download the bytes. */
  id: string;
  filename: string;
  mimeType: string;
  /** Size in bytes (0 when the provider doesn't report it). */
  size: number;
  /** True for attachments referenced inline in the HTML body (cid:), which we
   *  hide from the attachment list since they render inside the message. */
  inline: boolean;
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
  /** Downloadable (non-inline) attachments on this message. */
  attachments: AttachmentMeta[];
}

/** A file to attach to an outgoing message. */
export interface OutgoingAttachment {
  filename: string;
  mimeType: string;
  /** Standard base64 (not base64url) of the raw file bytes. */
  contentBase64: string;
}

/** A downloaded attachment's bytes, returned by the provider for streaming. */
export interface DownloadedAttachment {
  filename: string;
  mimeType: string;
  /** Standard base64 of the raw file bytes. */
  contentBase64: string;
}

/** A mailbox action that can be applied to one or more messages. */
export type MailActionType =
  | "trash" // move to Trash / Deleted Items (recoverable)
  | "untrash" // restore from Trash back to the inbox
  | "archive" // remove from the inbox (kept in All Mail / Archive)
  | "markRead"
  | "markUnread"
  | "star" // star (Gmail) / flag (Outlook)
  | "unstar";

/** True for actions that remove a message from the current inbox view. */
export const REMOVES_FROM_INBOX: ReadonlySet<MailActionType> = new Set([
  "trash",
  "archive",
]);

/** The inverse action used to power "Undo" on a destructive action. */
export const INVERSE_ACTION: Partial<Record<MailActionType, MailActionType>> = {
  trash: "untrash",
  untrash: "trash",
  markRead: "markUnread",
  markUnread: "markRead",
  star: "unstar",
  unstar: "star",
  // archive has no clean one-call inverse across providers; handled in the UI.
};

/** A new outgoing message. */
export interface MailDraft {
  to: MailAddress[];
  cc?: MailAddress[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  attachments?: OutgoingAttachment[];
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
  /** Lists inbox messages. When `query` is provided, performs a full-text
   *  search across the mailbox instead of listing the inbox. */
  listMessages(
    account: AccountWithTokens,
    limit: number,
    query?: string,
  ): Promise<UnifiedMessage[]>;
  getMessage(
    account: AccountWithTokens,
    messageId: string,
  ): Promise<UnifiedMessageFull>;
  /** Returns every message in a conversation/thread, oldest first. */
  getThread(
    account: AccountWithTokens,
    threadId: string,
  ): Promise<UnifiedMessageFull[]>;
  /** Downloads the bytes of a single attachment. */
  getAttachment(
    account: AccountWithTokens,
    messageId: string,
    attachmentId: string,
  ): Promise<DownloadedAttachment>;
  /** Applies a triage action (trash/archive/read/star) to one or more messages. */
  applyAction(
    account: AccountWithTokens,
    messageIds: string[],
    action: MailActionType,
  ): Promise<void>;
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

export interface MailThreadResponse {
  /** Every message in the conversation, oldest first. */
  messages: UnifiedMessageFull[];
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
