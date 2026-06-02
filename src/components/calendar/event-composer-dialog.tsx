"use client";

import * as React from "react";
import { addMinutes, format } from "date-fns";
import {
  AlertCircle,
  ExternalLink,
  Loader2,
  MapPin,
  Slash,
  Users,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { AccountDot } from "@/components/account-dot";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FetchError, patchJson, postJson } from "@/lib/fetcher";
import { cn, googleMapsUrl } from "@/lib/utils";
import type {
  AccountPublic,
  CalendarInfo,
  ConferenceType,
  CreateEventResponse,
  EventAttendee,
  EventDraft,
  EventLocationType,
  UnifiedEvent,
} from "@/lib/types";

interface EventComposerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: AccountPublic[];
  /** All known calendars; the dialog shows the chosen account's editable ones. */
  calendars?: CalendarInfo[];
  /** Account to pre-select as organiser (defaults to the first account). */
  defaultAccountId?: string;
  /** Day to pre-fill the start time onto (defaults to the next round hour). */
  initialDate?: Date | null;
  /**
   * When supplied, the dialog opens in edit mode: every field is prefilled
   * from the event, the organising account is locked, and submitting PATCHes
   * the event instead of creating a new one.
   */
  editEvent?: UnifiedEvent | null;
  /** Re-fetch the calendar after a successful create. */
  onCreated?: () => void;
  /** Re-fetch the calendar after a successful edit. */
  onSaved?: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Formats a Date into the value a <input type="datetime-local"> expects. */
function toLocalInputValue(date: Date): string {
  return format(date, "yyyy-MM-dd'T'HH:mm");
}

/** A sensible default start: the given day at the next round hour (or now+1h). */
function defaultStart(initialDate?: Date | null): Date {
  const now = new Date();
  if (initialDate) {
    const d = new Date(initialDate);
    // If the chosen day is today, jump to the next hour; else 09:00.
    if (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    ) {
      d.setHours(now.getHours() + 1, 0, 0, 0);
    } else {
      d.setHours(9, 0, 0, 0);
    }
    return d;
  }
  now.setHours(now.getHours() + 1, 0, 0, 0);
  return now;
}

/** Which conference platform (if any) the selected account can host. */
function conferenceCapability(
  account: AccountPublic | undefined,
): { type: ConferenceType; label: string } | null {
  if (!account) return null;
  if (account.provider === "google" && account.canMeet) {
    return { type: "google_meet", label: "Google Meet" };
  }
  if (account.provider === "microsoft" && account.canTeams) {
    return { type: "ms_teams", label: "Microsoft Teams" };
  }
  return null;
}

/** Derives the editor's location segment from an existing event. */
function locationTypeOf(event: UnifiedEvent): EventLocationType {
  if (event.conferenceType !== "none") return "conference";
  if (event.location) return "physical";
  return "none";
}

export function EventComposerDialog({
  open,
  onOpenChange,
  accounts,
  calendars = [],
  defaultAccountId,
  initialDate,
  editEvent,
  onCreated,
  onSaved,
}: EventComposerDialogProps) {
  const isEdit = Boolean(editEvent);

  const [accountId, setAccountId] = React.useState("");
  const [calendarId, setCalendarId] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [start, setStart] = React.useState("");
  const [end, setEnd] = React.useState("");
  const [attendees, setAttendees] = React.useState<EventAttendee[]>([]);
  const [attendeeInput, setAttendeeInput] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [locationType, setLocationType] = React.useState<EventLocationType>("none");
  const [address, setAddress] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [attempted, setAttempted] = React.useState(false);

  // (Re)initialise the form whenever the dialog opens.
  React.useEffect(() => {
    if (!open) return;
    setAttendeeInput("");
    setSubmitting(false);
    setAttempted(false);
    if (editEvent) {
      setAccountId(editEvent.accountId);
      setCalendarId(editEvent.calendarId);
      setTitle(editEvent.title);
      setStart(toLocalInputValue(new Date(editEvent.start)));
      setEnd(toLocalInputValue(new Date(editEvent.end)));
      setAttendees(
        editEvent.attendees.map((a) => ({ email: a.email, name: a.name })),
      );
      setDescription(editEvent.description ?? "");
      setLocationType(locationTypeOf(editEvent));
      setAddress(editEvent.location ?? "");
      return;
    }
    const s = defaultStart(initialDate);
    const e = addMinutes(s, 60);
    setAccountId(defaultAccountId ?? accounts[0]?.id ?? "");
    setCalendarId("");
    setTitle("");
    setStart(toLocalInputValue(s));
    setEnd(toLocalInputValue(e));
    setAttendees([]);
    setDescription("");
    setLocationType("none");
    setAddress("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectedAccount = accounts.find((a) => a.id === accountId);
  const conference = conferenceCapability(selectedAccount);
  const canHostVideo = conference !== null;

  // Editable calendars belonging to the chosen account, primaries first.
  const accountCalendars = React.useMemo(() => {
    return calendars
      .filter((c) => c.accountId === accountId && c.canEdit)
      .sort((a, b) => {
        if (a.primary !== b.primary) return a.primary ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [calendars, accountId]);

  // In edit mode the calendar is locked; show its name (falling back to a
  // generic label when the calendar list hasn't loaded or doesn't include it).
  const editCalendarLabel = React.useMemo(() => {
    if (!editEvent) return "";
    const match = calendars.find(
      (c) => c.accountId === editEvent.accountId && c.id === editEvent.calendarId,
    );
    return match?.name ?? "This calendar";
  }, [calendars, editEvent]);

  // Keep a valid calendar selected: default to the account's primary (or first).
  // In edit mode we honour the event's own calendar even if it isn't listed.
  React.useEffect(() => {
    if (isEdit) return;
    if (accountCalendars.length === 0) {
      setCalendarId("");
      return;
    }
    setCalendarId((prev) => {
      if (prev && accountCalendars.some((c) => c.id === prev)) return prev;
      const primary = accountCalendars.find((c) => c.primary);
      return (primary ?? accountCalendars[0]).id;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, accountCalendars.length, isEdit]);

  // If the organiser switches to an account that can't host video while Video
  // was selected, fall back to "none" so we never submit an invalid draft.
  // In edit mode the account is locked and the event already owns its meeting,
  // so we leave the prefilled conference selection intact.
  React.useEffect(() => {
    if (isEdit) return;
    if (locationType === "conference" && !canHostVideo) {
      setLocationType("none");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  // --- Attendee chip management -------------------------------------------
  function commitAttendees(raw: string) {
    const candidates = raw
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (candidates.length === 0) return;
    setAttendees((prev) => {
      const seen = new Set(prev.map((a) => a.email.toLowerCase()));
      const next = [...prev];
      let rejected = 0;
      for (const c of candidates) {
        const email = c.toLowerCase();
        if (!EMAIL_RE.test(c)) {
          rejected += 1;
          continue;
        }
        if (seen.has(email)) continue;
        seen.add(email);
        next.push({ email: c });
      }
      if (rejected > 0) {
        toast.error(
          rejected === 1
            ? "That doesn't look like a valid email address."
            : `${rejected} entries weren't valid email addresses.`,
        );
      }
      return next;
    });
    setAttendeeInput("");
  }

  function handleAttendeeKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === ";") {
      e.preventDefault();
      commitAttendees(attendeeInput);
    } else if (e.key === "Backspace" && attendeeInput === "" && attendees.length > 0) {
      setAttendees((prev) => prev.slice(0, -1));
    }
  }

  function removeAttendee(email: string) {
    setAttendees((prev) => prev.filter((a) => a.email !== email));
  }

  // --- Validation ----------------------------------------------------------
  const startDate = start ? new Date(start) : null;
  const endDate = end ? new Date(end) : null;
  const titleError = title.trim().length === 0 ? "A title is required." : null;
  const rangeError =
    startDate && endDate && endDate.getTime() <= startDate.getTime()
      ? "End time must be after the start time."
      : null;
  const addressError =
    locationType === "physical" && address.trim().length === 0
      ? "Enter a location address."
      : null;
  const accountError = accountId ? null : "Choose an organising account.";

  const isValid = !titleError && !rangeError && !addressError && !accountError;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAttempted(true);

    // Fold any text still sitting in the attendee input into the chip list.
    const pending = attendeeInput.trim();
    let finalAttendees = attendees;
    if (pending && EMAIL_RE.test(pending) && !attendees.some((a) => a.email.toLowerCase() === pending.toLowerCase())) {
      finalAttendees = [...attendees, { email: pending }];
    }

    if (!isValid || !startDate || !endDate) {
      return;
    }

    const draft: EventDraft = {
      title: title.trim(),
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      attendees: finalAttendees,
      locationType,
      ...(calendarId ? { calendarId } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(locationType === "physical" ? { physicalLocation: address.trim() } : {}),
      ...(locationType === "conference" && conference
        ? { conferenceType: conference.type }
        : {}),
    };

    setSubmitting(true);
    try {
      if (editEvent) {
        await patchJson<CreateEventResponse>("/api/calendar/events", {
          accountId,
          eventId: editEvent.id,
          draft,
          calendarId: calendarId || editEvent.calendarId,
        });
        toast.success("Event updated", { description: draft.title });
        onSaved?.();
      } else {
        await postJson<CreateEventResponse>("/api/calendar/events", {
          accountId,
          draft,
        });
        toast.success("Event created", {
          description:
            finalAttendees.length > 0
              ? `Invites sent to ${finalAttendees.length} guest${finalAttendees.length === 1 ? "" : "s"}.`
              : draft.title,
        });
        onCreated?.();
      }
      onOpenChange(false);
    } catch (err) {
      const fallback = editEvent
        ? "Could not update the event."
        : "Could not create the event.";
      const message = err instanceof FetchError ? err.message : fallback;
      toast.error(editEvent ? "Failed to update event" : "Failed to create event", {
        description: message,
      });
    } finally {
      setSubmitting(false);
    }
  }

  const segments: Array<{
    value: EventLocationType;
    label: string;
    icon: React.ElementType;
    disabled?: boolean;
  }> = [
    { value: "none", label: "None", icon: Slash },
    { value: "conference", label: "Video call", icon: Video, disabled: !canHostVideo },
    { value: "physical", label: "In person", icon: MapPin },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg gap-0 overflow-y-auto p-0 scrollbar-thin">
        <form onSubmit={handleSubmit}>
          <DialogHeader className="space-y-1.5 border-b border-border p-6">
            <DialogTitle>{isEdit ? "Edit event" : "New event"}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Update the details and notify your guests."
                : "Send an invite from any connected account."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-5 p-6">
            {/* Organising account + calendar */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="composer-account">Organising account</Label>
                <Select
                  value={accountId}
                  onValueChange={setAccountId}
                  disabled={isEdit}
                >
                  <SelectTrigger id="composer-account" className="h-10">
                    <SelectValue placeholder="Choose an account" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        <span className="flex items-center gap-2">
                          <AccountDot color={a.color} size="sm" />
                          <span className="truncate">{a.email}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="composer-calendar">Calendar</Label>
                {isEdit ? (
                  <Input
                    id="composer-calendar"
                    value={editCalendarLabel}
                    readOnly
                    disabled
                    className="h-10"
                  />
                ) : (
                  <Select
                    value={calendarId}
                    onValueChange={setCalendarId}
                    disabled={accountCalendars.length === 0}
                  >
                    <SelectTrigger id="composer-calendar" className="h-10">
                      <SelectValue
                        placeholder={
                          accountCalendars.length === 0
                            ? "Default calendar"
                            : "Choose a calendar"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {accountCalendars.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="flex items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/5"
                              style={{
                                backgroundColor:
                                  c.color ?? "hsl(var(--muted-foreground))",
                              }}
                              aria-hidden="true"
                            />
                            <span className="truncate">{c.name}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>

            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="composer-title">Title</Label>
              <Input
                id="composer-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Add a title"
                autoFocus
                aria-invalid={attempted && Boolean(titleError)}
                className={cn(
                  "h-10",
                  attempted && titleError && "border-destructive focus-visible:ring-destructive",
                )}
              />
              {attempted && titleError && (
                <p className="text-xs text-destructive">{titleError}</p>
              )}
            </div>

            {/* Start + End */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="composer-start">Start</Label>
                <Input
                  id="composer-start"
                  type="datetime-local"
                  value={start}
                  onChange={(e) => {
                    const v = e.target.value;
                    setStart(v);
                    // Keep end 60 minutes ahead while it trails the start.
                    if (v && (!end || new Date(end) <= new Date(v))) {
                      setEnd(toLocalInputValue(addMinutes(new Date(v), 60)));
                    }
                  }}
                  className="h-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="composer-end">End</Label>
                <Input
                  id="composer-end"
                  type="datetime-local"
                  value={end}
                  min={start || undefined}
                  onChange={(e) => setEnd(e.target.value)}
                  aria-invalid={attempted && Boolean(rangeError)}
                  className={cn(
                    "h-10",
                    attempted && rangeError && "border-destructive focus-visible:ring-destructive",
                  )}
                />
              </div>
            </div>
            {attempted && rangeError && (
              <p className="-mt-3 text-xs text-destructive">{rangeError}</p>
            )}

            {/* Attendees */}
            <div className="space-y-1.5">
              <Label htmlFor="composer-attendees">Guests</Label>
              <div
                className={cn(
                  "flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm shadow-sm focus-within:ring-1 focus-within:ring-ring",
                )}
                onClick={() =>
                  document.getElementById("composer-attendees")?.focus()
                }
              >
                {attendees.map((a) => (
                  <span
                    key={a.email}
                    className="inline-flex max-w-full items-center gap-1 rounded bg-secondary py-0.5 pl-2 pr-1 text-xs text-secondary-foreground"
                  >
                    <span className="truncate" title={a.email}>
                      {a.email}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${a.email}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeAttendee(a.email);
                      }}
                      className="rounded-sm p-0.5 text-muted-foreground outline-none transition-colors hover:bg-background hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </span>
                ))}
                <input
                  id="composer-attendees"
                  value={attendeeInput}
                  onChange={(e) => setAttendeeInput(e.target.value)}
                  onKeyDown={handleAttendeeKeyDown}
                  onBlur={() => attendeeInput.trim() && commitAttendees(attendeeInput)}
                  placeholder={attendees.length === 0 ? "name@example.com" : "Add more…"}
                  type="email"
                  className="min-w-[8rem] flex-1 bg-transparent py-0.5 outline-none placeholder:text-muted-foreground"
                />
              </div>
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="h-3 w-3" aria-hidden="true" />
                Type an email and press Enter or comma to add it.
              </p>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="composer-description">Description</Label>
              <Textarea
                id="composer-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add details, agenda, or notes…"
                rows={3}
                className="resize-none"
              />
            </div>

            {/* Location segmented control */}
            <div className="space-y-2">
              <Label>Location</Label>
              <div
                role="radiogroup"
                aria-label="Event location type"
                className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1"
              >
                {segments.map((seg) => {
                  const Icon = seg.icon;
                  const active = locationType === seg.value;
                  return (
                    <button
                      key={seg.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={seg.disabled}
                      onClick={() => setLocationType(seg.value)}
                      title={
                        seg.disabled
                          ? "This account can't host online meetings"
                          : undefined
                      }
                      className={cn(
                        "inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40",
                        active
                          ? "bg-background text-foreground shadow"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{seg.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Video call detail */}
              {locationType === "conference" && conference && (
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                  <Video className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span>
                    A <span className="font-medium">{conference.label}</span> link
                    will be added automatically.
                  </span>
                </div>
              )}

              {/* Disabled-video hint */}
              {!canHostVideo && (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {selectedAccount
                      ? `${selectedAccount.email} can't host online meetings. You can still meet in person.`
                      : "Choose an account to enable video calls."}
                  </span>
                </p>
              )}

              {/* In-person detail */}
              {locationType === "physical" && (
                <div className="space-y-1.5">
                  <Input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Address or place name"
                    aria-invalid={attempted && Boolean(addressError)}
                    className={cn(
                      "h-10",
                      attempted && addressError && "border-destructive focus-visible:ring-destructive",
                    )}
                  />
                  {attempted && addressError ? (
                    <p className="text-xs text-destructive">{addressError}</p>
                  ) : address.trim() ? (
                    <a
                      href={googleMapsUrl(address.trim())}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
                    >
                      <MapPin className="h-3 w-3" aria-hidden="true" />
                      View on Google Maps
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2 border-t border-border p-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {isEdit
                ? submitting
                  ? "Saving…"
                  : "Save changes"
                : submitting
                  ? "Creating…"
                  : "Create event"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
