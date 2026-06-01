"use client";

import * as React from "react";
import {
  eachDayOfInterval,
  endOfWeek,
  format,
  isToday,
  startOfWeek,
} from "date-fns";

import { EventChip } from "@/components/calendar/event-chip";
import { accountById } from "@/hooks/use-accounts";
import type { AccountPublic, UnifiedEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

interface WeekViewProps {
  anchor: Date;
  events: UnifiedEvent[];
  accounts: AccountPublic[];
  onEventClick: (event: UnifiedEvent) => void;
  onDayClick: (day: Date) => void;
}

const HOUR_HEIGHT = 48; // px per hour
const DAY_START_HOUR = 0;
const DAY_END_HOUR = 24;
const HOURS = Array.from(
  { length: DAY_END_HOUR - DAY_START_HOUR },
  (_, i) => DAY_START_HOUR + i,
);

function colorOf(accounts: AccountPublic[], ev: UnifiedEvent): string {
  return accountById(accounts, ev.accountId)?.color ?? "#94a3b8";
}

/** A timed event positioned absolutely within a day column. */
function readableTextColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 0xff;
  const g = (int >> 8) & 0xff;
  const b = int & 0xff;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#0b1120" : "#ffffff";
}

export function WeekView({
  anchor,
  events,
  accounts,
  onEventClick,
  onDayClick,
}: WeekViewProps) {
  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(anchor, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });

  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Scroll to ~08:00 on mount/week change so the day starts in a useful place.
  const weekStartMs = weekStart.getTime();
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 8 * HOUR_HEIGHT;
    }
  }, [weekStartMs]);

  // Bucket events per day into all-day vs timed.
  const perDay = React.useMemo(() => {
    return days.map((day) => {
      const key = format(day, "yyyy-MM-dd");
      const allDay: UnifiedEvent[] = [];
      const timed: UnifiedEvent[] = [];
      for (const ev of events) {
        if (format(new Date(ev.start), "yyyy-MM-dd") !== key) continue;
        if (ev.allDay) allDay.push(ev);
        else timed.push(ev);
      }
      return { day, key, allDay, timed };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, weekStart.getTime()]);

  const hasAllDay = perDay.some((d) => d.allDay.length > 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Day headers */}
      <div className="grid shrink-0 grid-cols-[3.5rem_repeat(7,1fr)] border-b border-border">
        <div className="border-r border-border" />
        {days.map((day) => {
          const today = isToday(day);
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onDayClick(day)}
              className="flex flex-col items-center gap-0.5 border-r border-border py-2 outline-none transition-colors hover:bg-accent/40 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {format(day, "EEE")}
              </span>
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold tabular-nums",
                  today ? "bg-primary text-primary-foreground" : "text-foreground",
                )}
              >
                {format(day, "d")}
              </span>
            </button>
          );
        })}
      </div>

      {/* All-day row */}
      {hasAllDay && (
        <div className="grid shrink-0 grid-cols-[3.5rem_repeat(7,1fr)] border-b border-border bg-muted/20">
          <div className="flex items-center justify-end border-r border-border px-1 py-1 text-[10px] font-medium uppercase text-muted-foreground">
            All day
          </div>
          {perDay.map(({ key, allDay }) => (
            <div
              key={key}
              className="flex flex-col gap-0.5 border-r border-border p-1"
            >
              {allDay.map((ev) => (
                <EventChip
                  key={`${ev.accountId}:${ev.id}`}
                  event={ev}
                  compact
                  color={colorOf(accounts, ev)}
                  onClick={onEventClick}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Time grid */}
      <div
        ref={scrollRef}
        className="grid min-h-0 flex-1 grid-cols-[3.5rem_repeat(7,1fr)] overflow-y-auto scrollbar-thin"
      >
        {/* Hour gutter */}
        <div className="relative border-r border-border">
          {HOURS.map((h) => (
            <div
              key={h}
              style={{ height: HOUR_HEIGHT }}
              className="relative"
            >
              {h !== DAY_START_HOUR && (
                <span className="absolute -top-2 right-1 text-[10px] tabular-nums text-muted-foreground">
                  {format(new Date(2000, 0, 1, h), "HH:mm")}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {perDay.map(({ key, day, timed }) => (
          <div
            key={key}
            className="relative border-r border-border"
            onClick={() => onDayClick(day)}
            role="button"
            tabIndex={-1}
            aria-label={`Create event on ${format(day, "EEEE, d MMMM")}`}
          >
            {/* Hour lines */}
            {HOURS.map((h) => (
              <div
                key={h}
                style={{ height: HOUR_HEIGHT }}
                className="border-b border-border/60"
              />
            ))}

            {/* Today tint */}
            {isToday(day) && (
              <div className="pointer-events-none absolute inset-0 bg-primary/[0.04]" aria-hidden="true" />
            )}

            {/* Timed events */}
            {timed.map((ev) => {
              const start = new Date(ev.start);
              const end = new Date(ev.end);
              const startMin =
                start.getHours() * 60 + start.getMinutes() - DAY_START_HOUR * 60;
              const rawEndMin = end.getHours() * 60 + end.getMinutes() - DAY_START_HOUR * 60;
              const endMin = rawEndMin <= startMin ? startMin + 30 : rawEndMin;
              const top = (startMin / 60) * HOUR_HEIGHT;
              const height = Math.max(((endMin - startMin) / 60) * HOUR_HEIGHT, 18);
              const color = colorOf(accounts, ev);
              const textColor = readableTextColor(color);
              const label = `${format(start, "HH:mm")} ${ev.title || "(no title)"}`;
              return (
                <button
                  key={`${ev.accountId}:${ev.id}`}
                  type="button"
                  title={label}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEventClick(ev);
                  }}
                  style={{
                    top,
                    height,
                    backgroundColor: color,
                    color: textColor,
                  }}
                  className="absolute inset-x-0.5 z-10 overflow-hidden rounded px-1.5 py-0.5 text-left text-xs font-medium leading-tight outline-none ring-1 ring-black/5 transition-[filter] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="block truncate font-semibold">
                    {ev.title || "(no title)"}
                  </span>
                  {height > 28 && (
                    <span className="block truncate opacity-80">
                      {format(start, "HH:mm")}–{format(end, "HH:mm")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
