"use client";

import * as React from "react";
import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";

import { EventChip } from "@/components/calendar/event-chip";
import { accountById } from "@/hooks/use-accounts";
import type { AccountPublic, UnifiedEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

interface MonthViewProps {
  anchor: Date;
  events: UnifiedEvent[];
  accounts: AccountPublic[];
  onEventClick: (event: UnifiedEvent) => void;
  onDayClick: (day: Date) => void;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_CHIPS = 3;

export function MonthView({
  anchor,
  events,
  accounts,
  onEventClick,
  onDayClick,
}: MonthViewProps) {
  const gridStart = startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  // Group events by calendar day for O(1) lookup per cell.
  const byDay = React.useMemo(() => {
    const map = new Map<string, UnifiedEvent[]>();
    for (const ev of events) {
      const key = format(new Date(ev.start), "yyyy-MM-dd");
      const list = map.get(key);
      if (list) list.push(ev);
      else map.set(key, [ev]);
    }
    return map;
  }, [events]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Weekday header */}
      <div className="grid shrink-0 grid-cols-7 border-b border-border">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            <span className="hidden sm:inline">{d}</span>
            <span className="sm:hidden">{d[0]}</span>
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div
        className="grid min-h-0 flex-1 auto-rows-fr grid-cols-7 overflow-y-auto scrollbar-thin"
        style={{ gridTemplateRows: `repeat(${days.length / 7}, minmax(5.5rem, 1fr))` }}
      >
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dayEvents = byDay.get(key) ?? [];
          const visible = dayEvents.slice(0, MAX_CHIPS);
          const overflow = dayEvents.length - visible.length;
          const inMonth = isSameMonth(day, anchor);
          const today = isToday(day);

          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              aria-label={`Create event on ${format(day, "EEEE, d MMMM")}`}
              onClick={() => onDayClick(day)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onDayClick(day);
                }
              }}
              className={cn(
                "group flex min-h-0 cursor-pointer flex-col gap-0.5 border-b border-r border-border p-1 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
                !inMonth && "bg-muted/30",
              )}
            >
              <div className="flex items-center justify-between px-0.5">
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium tabular-nums",
                    today
                      ? "bg-primary text-primary-foreground"
                      : inMonth
                        ? "text-foreground"
                        : "text-muted-foreground",
                  )}
                >
                  {format(day, "d")}
                </span>
              </div>

              <div className="flex min-h-0 flex-col gap-0.5 overflow-hidden">
                {visible.map((ev) => (
                  <EventChip
                    key={`${ev.accountId}:${ev.id}`}
                    event={ev}
                    compact
                    color={accountById(accounts, ev.accountId)?.color ?? "#94a3b8"}
                    onClick={onEventClick}
                  />
                ))}
                {overflow > 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDayClick(day);
                    }}
                    className="rounded px-1.5 py-0.5 text-left text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    +{overflow} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
