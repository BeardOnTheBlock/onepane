"use client";

import * as React from "react";
import { format, isSameDay } from "date-fns";
import {
  Check,
  CalendarClock,
  CheckCircle2,
  CircleHelp,
  ExternalLink,
  Loader2,
  MapPin,
  Pencil,
  Trash2,
  Users,
  Video,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { AccountDot } from "@/components/account-dot";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { del, FetchError, postJson } from "@/lib/fetcher";
import type {
  AccountPublic,
  AttendeeResponse,
  EventAttendee,
  OkResponse,
  UnifiedEvent,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface EventDetailDialogProps {
  event: UnifiedEvent | null;
  account: AccountPublic | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Open the composer in edit mode for this event. */
  onEdit?: (event: UnifiedEvent) => void;
  /** Called after the event is deleted (re-fetch + close happen here). */
  onDeleted?: () => void;
  /** Called after an RSVP succeeds (re-fetch the calendar). */
  onResponded?: () => void;
}

/** Human label for the provider's web UI deep link. */
function providerCalendarLabel(provider: UnifiedEvent["provider"]): string {
  return provider === "google" ? "Google Calendar" : "Outlook";
}

/** Human label for the conferencing platform. */
function conferenceLabel(event: UnifiedEvent): string {
  if (event.conferenceType === "google_meet") return "Google Meet";
  if (event.conferenceType === "ms_teams") return "Microsoft Teams";
  return "online meeting";
}

/** Formats the date/time range, collapsing to one date when same-day. */
function formatRange(event: UnifiedEvent): string {
  const start = new Date(event.start);
  const end = new Date(event.end);
  if (event.allDay) {
    if (isSameDay(start, end) || end.getTime() - start.getTime() <= 86_400_000) {
      return `${format(start, "EEEE, d MMMM yyyy")} · All day`;
    }
    return `${format(start, "EEE, d MMM")} – ${format(end, "EEE, d MMM yyyy")} · All day`;
  }
  if (isSameDay(start, end)) {
    return `${format(start, "EEEE, d MMMM")} · ${format(start, "HH:mm")} – ${format(end, "HH:mm")}`;
  }
  return `${format(start, "EEE, d MMM HH:mm")} – ${format(end, "EEE, d MMM HH:mm")}`;
}

const RESPONSE_META: Record<
  AttendeeResponse,
  { label: string; icon: React.ElementType; className: string }
> = {
  accepted: { label: "Accepted", icon: CheckCircle2, className: "text-emerald-600" },
  declined: { label: "Declined", icon: XCircle, className: "text-destructive" },
  tentative: { label: "Maybe", icon: CircleHelp, className: "text-amber-600" },
  needsAction: { label: "No reply", icon: CircleHelp, className: "text-muted-foreground" },
};

/** The three actionable RSVP choices, in display order. */
const RSVP_CHOICES: Array<{
  response: Exclude<AttendeeResponse, "needsAction">;
  label: string;
  icon: React.ElementType;
}> = [
  { response: "accepted", label: "Yes", icon: Check },
  { response: "tentative", label: "Maybe", icon: CircleHelp },
  { response: "declined", label: "No", icon: X },
];

/**
 * The current account's own attendance, when it's a guest on the event and not
 * the organiser. Returns null when RSVP isn't applicable (organiser, or the
 * account isn't on the guest list).
 */
function selfAttendance(
  event: UnifiedEvent,
  account: AccountPublic | undefined,
): EventAttendee | null {
  if (!account) return null;
  const me = account.email.toLowerCase();
  if (event.organizer && event.organizer.email.toLowerCase() === me) {
    return null;
  }
  return (
    event.attendees.find((a) => a.email.toLowerCase() === me) ?? null
  );
}

/** True when the current account organises the event (can edit/delete it). */
function isOrganiser(
  event: UnifiedEvent,
  account: AccountPublic | undefined,
): boolean {
  if (!account) return false;
  // No organizer recorded → treat the owning account as the organiser.
  if (!event.organizer) return true;
  return event.organizer.email.toLowerCase() === account.email.toLowerCase();
}

function AttendeeRow({ attendee }: { attendee: EventAttendee }) {
  const meta = RESPONSE_META[attendee.responseStatus ?? "needsAction"];
  const Icon = meta.icon;
  const display = attendee.name || attendee.email;
  return (
    <li className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p className="truncate text-sm" title={attendee.email}>
          {display}
        </p>
        {attendee.name && (
          <p className="truncate text-xs text-muted-foreground" title={attendee.email}>
            {attendee.email}
          </p>
        )}
      </div>
      <span
        className={cn("flex shrink-0 items-center gap-1 text-xs", meta.className)}
        title={meta.label}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">{meta.label}</span>
      </span>
    </li>
  );
}

export function EventDetailDialog({
  event,
  account,
  open,
  onOpenChange,
  onEdit,
  onDeleted,
  onResponded,
}: EventDetailDialogProps) {
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [responding, setResponding] = React.useState<AttendeeResponse | null>(
    null,
  );

  // Reset the inline confirm + busy state whenever the dialog (re)opens or the
  // event changes, so a stale "Confirm delete" never carries over.
  const eventId = event?.id ?? null;
  React.useEffect(() => {
    setConfirmingDelete(false);
    setDeleting(false);
    setResponding(null);
  }, [eventId, open]);

  if (!event) {
    // Keep the Dialog mounted so close animations still play out.
    return <Dialog open={open} onOpenChange={onOpenChange} />;
  }

  const color = account?.color ?? "hsl(var(--muted-foreground))";
  const accountLabel = account?.email ?? "Unknown account";
  const isConference = event.conferenceType !== "none" && Boolean(event.conferenceUrl);
  const isPhysical = Boolean(event.location);

  const me = selfAttendance(event, account);
  const canRsvp = me !== null;
  const canManage = isOrganiser(event, account);
  const busy = deleting || responding !== null;

  async function handleDelete() {
    if (!event || !account) return;
    setDeleting(true);
    try {
      const params = new URLSearchParams({
        accountId: event.accountId,
        eventId: event.id,
        calendarId: event.calendarId,
      });
      await del<OkResponse>(`/api/calendar/events?${params.toString()}`);
      toast.success("Event deleted", {
        description: event.title || "(no title)",
      });
      onDeleted?.();
      onOpenChange(false);
    } catch (err) {
      const message =
        err instanceof FetchError ? err.message : "Could not delete the event.";
      toast.error("Failed to delete event", { description: message });
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  async function handleRsvp(response: AttendeeResponse) {
    if (!event) return;
    setResponding(response);
    try {
      await postJson<OkResponse>("/api/calendar/events/respond", {
        accountId: event.accountId,
        eventId: event.id,
        calendarId: event.calendarId,
        response,
      });
      toast.success(`You responded “${RESPONSE_META[response].label}”`, {
        description: event.title || "(no title)",
      });
      onResponded?.();
    } catch (err) {
      const message =
        err instanceof FetchError ? err.message : "Could not send your reply.";
      toast.error("Failed to RSVP", { description: message });
    } finally {
      setResponding(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 p-0">
        {/* Coloured account stripe */}
        <div
          className="h-1.5 w-full rounded-t-lg"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />

        <div className="flex flex-col gap-4 p-6">
          <DialogHeader className="space-y-1.5">
            <DialogTitle className="pr-6 text-balance leading-snug">
              {event.title || "(no title)"}
            </DialogTitle>
            <DialogDescription className="flex items-center gap-2 text-foreground">
              <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>{formatRange(event)}</span>
            </DialogDescription>
          </DialogHeader>

          {/* Account badge */}
          <div className="flex items-center gap-2 text-sm">
            <AccountDot color={color} size="md" aria-label={`Account ${accountLabel}`} />
            <span className="min-w-0 truncate text-muted-foreground" title={accountLabel}>
              {accountLabel}
            </span>
          </div>

          {/* RSVP — only when this account is a guest (not the organiser) */}
          {canRsvp && (
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Going?
              </p>
              <div
                role="group"
                aria-label="RSVP to this event"
                className="grid grid-cols-3 gap-2"
              >
                {RSVP_CHOICES.map((choice) => {
                  const Icon = choice.icon;
                  const active = me?.responseStatus === choice.response;
                  const isBusy = responding === choice.response;
                  return (
                    <Button
                      key={choice.response}
                      type="button"
                      size="sm"
                      variant={active ? "default" : "outline"}
                      disabled={busy}
                      aria-pressed={active}
                      onClick={() => handleRsvp(choice.response)}
                      className="h-9"
                    >
                      {isBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      )}
                      <span className="truncate">{choice.label}</span>
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Location / conference */}
          {(isConference || isPhysical) && (
            <div className="rounded-md border border-border bg-muted/30 p-3">
              {isConference ? (
                <div className="flex items-center gap-2">
                  <Video className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <Button
                    asChild
                    size="sm"
                    className="h-8"
                  >
                    <a href={event.conferenceUrl!} target="_blank" rel="noreferrer">
                      Join {conferenceLabel(event)}
                    </a>
                  </Button>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="break-words text-sm">{event.location}</p>
                    {event.locationMapsUrl && (
                      <a
                        href={event.locationMapsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
                      >
                        View on Google Maps
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Description */}
          {event.description && (
            <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-sm text-muted-foreground scrollbar-thin">
              {event.description}
            </p>
          )}

          {/* Attendees */}
          {event.attendees.length > 0 && (
            <div>
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {event.attendees.length} guest{event.attendees.length === 1 ? "" : "s"}
                </span>
              </div>
              <ul className="mt-1 max-h-48 divide-y divide-border overflow-y-auto scrollbar-thin">
                {event.attendees.map((a) => (
                  <AttendeeRow key={a.email} attendee={a} />
                ))}
              </ul>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
            {event.htmlLink && (
              <Button asChild variant="outline" size="sm">
                <a href={event.htmlLink} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">
                    Open in {providerCalendarLabel(event.provider)}
                  </span>
                  <span className="sm:hidden">Open</span>
                </a>
              </Button>
            )}

            {canManage && (
              <div className="ml-auto flex items-center gap-2">
                {confirmingDelete ? (
                  <>
                    <span className="text-xs text-muted-foreground">
                      Delete this event?
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={deleting}
                      onClick={() => setConfirmingDelete(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={deleting}
                      onClick={handleDelete}
                    >
                      {deleting && (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      )}
                      Delete
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => onEdit?.(event)}
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => setConfirmingDelete(true)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      Delete
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
