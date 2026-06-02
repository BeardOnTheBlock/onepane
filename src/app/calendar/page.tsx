"use client";

import * as React from "react";
import useSWR from "swr";
import {
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { AlertTriangle, CalendarPlus, Inbox } from "lucide-react";

import { AgendaView } from "@/components/calendar/agenda-view";
import { CalendarPicker } from "@/components/calendar/calendar-picker";
import {
  CalendarToolbar,
  type CalendarView,
} from "@/components/calendar/calendar-toolbar";
import { EventComposerDialog } from "@/components/calendar/event-composer-dialog";
import { EventDetailDialog } from "@/components/calendar/event-detail-dialog";
import { MonthView } from "@/components/calendar/month-view";
import { WeekView } from "@/components/calendar/week-view";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { accountById, useAccounts } from "@/hooks/use-accounts";
import {
  calendarKey,
  serializeCalendarSelection,
  useCalendars,
} from "@/hooks/use-calendars";
import { fetcher } from "@/lib/fetcher";
import type { CalendarInfo, CalendarListResponse, UnifiedEvent } from "@/lib/types";

/**
 * The visible date range for a given view + anchor.
 * - month: the month padded out to whole Mon–Sun weeks (5–6 rows).
 * - week: the Mon–Sun week containing the anchor.
 * - agenda: a rolling ~6-week window starting from the anchor's week.
 */
function rangeFor(view: CalendarView, anchor: Date): { start: Date; end: Date } {
  if (view === "month") {
    return {
      start: startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 }),
      end: endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 }),
    };
  }
  if (view === "week") {
    return {
      start: startOfWeek(anchor, { weekStartsOn: 1 }),
      end: endOfWeek(anchor, { weekStartsOn: 1 }),
    };
  }
  // agenda: 6 weeks forward from the anchor's week start.
  const start = startOfWeek(anchor, { weekStartsOn: 1 });
  return { start, end: endOfWeek(addWeeks(start, 5), { weekStartsOn: 1 }) };
}

function periodLabelFor(view: CalendarView, anchor: Date): string {
  if (view === "month") return format(anchor, "MMMM yyyy");
  if (view === "week") {
    const start = startOfWeek(anchor, { weekStartsOn: 1 });
    const end = endOfWeek(anchor, { weekStartsOn: 1 });
    if (start.getMonth() === end.getMonth()) {
      return `${format(start, "d")}–${format(end, "d MMM yyyy")}`;
    }
    if (start.getFullYear() === end.getFullYear()) {
      return `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")}`;
    }
    return `${format(start, "d MMM yyyy")} – ${format(end, "d MMM yyyy")}`;
  }
  const { start, end } = rangeFor("agenda", anchor);
  return `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")}`;
}

function stepAnchor(
  view: CalendarView,
  anchor: Date,
  direction: 1 | -1,
): Date {
  if (view === "month") return addMonths(anchor, direction);
  if (view === "week") return addWeeks(anchor, direction);
  // agenda steps a window of 6 weeks at a time.
  return addWeeks(anchor, direction * 6);
}

function ViewSkeleton() {
  return (
    <div className="flex h-full flex-col gap-2 p-4">
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-5" />
        ))}
      </div>
      <div className="grid flex-1 grid-cols-7 grid-rows-5 gap-2">
        {Array.from({ length: 35 }).map((_, i) => (
          <Skeleton key={i} className="h-full min-h-16 w-full" />
        ))}
      </div>
    </div>
  );
}

export default function CalendarPage() {
  const { accounts, isLoading: accountsLoading } = useAccounts();

  const [view, setView] = React.useState<CalendarView>("month");
  const [anchor, setAnchor] = React.useState<Date>(() => new Date());
  const [selectedAccountId, setSelectedAccountId] = React.useState<string>("all");

  const [detailEvent, setDetailEvent] = React.useState<UnifiedEvent | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [composerOpen, setComposerOpen] = React.useState(false);
  const [composerDate, setComposerDate] = React.useState<Date | null>(null);
  const [editEvent, setEditEvent] = React.useState<UnifiedEvent | null>(null);

  // Calendar visibility: track the calendars the user has explicitly hidden, so
  // calendars discovered later default to visible (the "all visible" default).
  const [hiddenKeys, setHiddenKeys] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const {
    calendars,
    errors: calendarErrors,
    isLoading: calendarsLoading,
  } = useCalendars(selectedAccountId);

  const { start, end } = React.useMemo(
    () => rangeFor(view, anchor),
    [view, anchor],
  );

  // The set of currently-visible calendars (every known calendar minus hidden).
  const selectedKeys = React.useMemo(() => {
    const set = new Set<string>();
    for (const c of calendars) {
      const key = calendarKey(c.accountId, c.id);
      if (!hiddenKeys.has(key)) set.add(key);
    }
    return set;
  }, [calendars, hiddenKeys]);

  function toggleCalendar(calendar: CalendarInfo, visible: boolean) {
    const key = calendarKey(calendar.accountId, calendar.id);
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      if (visible) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function setAllCalendars(visible: boolean) {
    if (visible) {
      setHiddenKeys(new Set());
    } else {
      setHiddenKeys(new Set(calendars.map((c) => calendarKey(c.accountId, c.id))));
    }
  }

  // If the selected account is removed, fall back to "all".
  React.useEffect(() => {
    if (
      selectedAccountId !== "all" &&
      !accountsLoading &&
      !accountById(accounts, selectedAccountId)
    ) {
      setSelectedAccountId("all");
    }
  }, [accounts, accountsLoading, selectedAccountId]);

  const hasAccounts = accounts.length > 0;

  // Once we know the calendars, prefer sending the explicit visible selection.
  // Before they load (or with no calendars), omit the param so the server
  // falls back to its default (primaries).
  const allVisible =
    calendars.length > 0 && selectedKeys.size === calendars.length;
  const calendarsParam =
    calendars.length === 0 || allVisible
      ? null
      : serializeCalendarSelection(calendars, selectedKeys);

  const swrKey = hasAccounts
    ? `/api/calendar?start=${encodeURIComponent(
        start.toISOString(),
      )}&end=${encodeURIComponent(end.toISOString())}&accountId=${selectedAccountId}` +
      (calendarsParam !== null
        ? `&calendars=${encodeURIComponent(calendarsParam)}`
        : "")
    : null;

  const { data, error, isLoading, mutate } = useSWR<CalendarListResponse>(
    swrKey,
    fetcher,
    { keepPreviousData: true },
  );

  const events = data?.events ?? [];
  const accountErrors = data?.errors ?? [];

  function handleEventClick(event: UnifiedEvent) {
    setDetailEvent(event);
    setDetailOpen(true);
  }

  function handleDayClick(day: Date) {
    if (!hasAccounts) return;
    setComposerDate(day);
    setComposerOpen(true);
  }

  function handleNewEvent() {
    setEditEvent(null);
    setComposerDate(null);
    setComposerOpen(true);
  }

  function handleEditEvent(event: UnifiedEvent) {
    setDetailOpen(false);
    setEditEvent(event);
    setComposerDate(null);
    setComposerOpen(true);
  }

  // The account to pre-select as organiser: the active filter, or the first.
  const composerDefaultAccount =
    selectedAccountId !== "all" ? selectedAccountId : accounts[0]?.id;
  const detailAccount = detailEvent
    ? accountById(accounts, detailEvent.accountId)
    : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <CalendarToolbar
        view={view}
        onViewChange={setView}
        periodLabel={periodLabelFor(view, anchor)}
        onPrev={() => setAnchor((a) => stepAnchor(view, a, -1))}
        onToday={() => setAnchor(new Date())}
        onNext={() => setAnchor((a) => stepAnchor(view, a, 1))}
        accounts={accounts}
        selectedAccountId={selectedAccountId}
        onAccountChange={setSelectedAccountId}
        onNewEvent={handleNewEvent}
        canCreate={hasAccounts}
        calendarPicker={
          hasAccounts ? (
            <CalendarPicker
              accounts={accounts}
              calendars={calendars}
              selected={selectedKeys}
              onToggle={toggleCalendar}
              onSetAll={setAllCalendars}
              isLoading={calendarsLoading}
              errors={calendarErrors}
            />
          ) : undefined
        }
      />

      {/* Per-account errors (non-blocking) */}
      {accountErrors.length > 0 && (
        <div className="flex items-start gap-2 border-b border-border bg-destructive/5 px-4 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <p className="min-w-0">
            Couldn’t load events from{" "}
            {accountErrors.map((e, i) => (
              <React.Fragment key={e.accountId}>
                <span className="font-medium" title={e.message}>
                  {e.email}
                </span>
                {i < accountErrors.length - 1 ? ", " : ""}
              </React.Fragment>
            ))}
            .
          </p>
        </div>
      )}

      {/* Body */}
      <div className="min-h-0 flex-1">
        {accountsLoading ? (
          <ViewSkeleton />
        ) : !hasAccounts ? (
          <EmptyNoAccounts />
        ) : error ? (
          <ErrorState onRetry={() => mutate()} />
        ) : isLoading && !data ? (
          <ViewSkeleton />
        ) : view === "month" ? (
          <MonthView
            anchor={anchor}
            events={events}
            accounts={accounts}
            onEventClick={handleEventClick}
            onDayClick={handleDayClick}
          />
        ) : view === "week" ? (
          <WeekView
            anchor={anchor}
            events={events}
            accounts={accounts}
            onEventClick={handleEventClick}
            onDayClick={handleDayClick}
          />
        ) : (
          <AgendaView
            events={events}
            accounts={accounts}
            onEventClick={handleEventClick}
          />
        )}
      </div>

      {/* Dialogs */}
      <EventDetailDialog
        event={detailEvent}
        account={detailAccount}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onEdit={handleEditEvent}
        onDeleted={() => mutate()}
        onResponded={() => mutate()}
      />
      <EventComposerDialog
        open={composerOpen}
        onOpenChange={setComposerOpen}
        accounts={accounts}
        calendars={calendars}
        defaultAccountId={composerDefaultAccount}
        initialDate={composerDate}
        editEvent={editEvent}
        onCreated={() => mutate()}
        onSaved={() => mutate()}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty / error states
// ---------------------------------------------------------------------------

function EmptyNoAccounts() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
        <Inbox className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <h2 className="text-base font-semibold">No accounts connected</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          Connect a Google or Microsoft account to see your calendars unified in
          one place.
        </p>
      </div>
      <Button asChild>
        <a href="/settings">
          <CalendarPlus className="h-4 w-4" aria-hidden="true" />
          Connect an account
        </a>
      </Button>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Couldn’t load your calendar</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          Something went wrong fetching events. Please try again.
        </p>
      </div>
      <Button variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
