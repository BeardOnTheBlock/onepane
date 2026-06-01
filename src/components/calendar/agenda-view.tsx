"use client";

import * as React from "react";
import { format, isSameDay, isToday } from "date-fns";
import { CalendarX2, MapPin, Video } from "lucide-react";

import { AccountDot } from "@/components/account-dot";
import { accountById } from "@/hooks/use-accounts";
import type { AccountPublic, UnifiedEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

interface AgendaViewProps {
  events: UnifiedEvent[];
  accounts: AccountPublic[];
  onEventClick: (event: UnifiedEvent) => void;
}

interface DayGroup {
  date: Date;
  key: string;
  events: UnifiedEvent[];
}

function groupByDay(events: UnifiedEvent[]): DayGroup[] {
  const groups: DayGroup[] = [];
  let current: DayGroup | null = null;
  for (const ev of events) {
    const date = new Date(ev.start);
    const key = format(date, "yyyy-MM-dd");
    if (!current || current.key !== key) {
      current = { date, key, events: [] };
      groups.push(current);
    }
    current.events.push(ev);
  }
  return groups;
}

function timeRange(ev: UnifiedEvent): string {
  if (ev.allDay) return "All day";
  const start = new Date(ev.start);
  const end = new Date(ev.end);
  if (isSameDay(start, end)) {
    return `${format(start, "HH:mm")} – ${format(end, "HH:mm")}`;
  }
  return `${format(start, "HH:mm")} – ${format(end, "d MMM HH:mm")}`;
}

export function AgendaView({ events, accounts, onEventClick }: AgendaViewProps) {
  const groups = React.useMemo(() => groupByDay(events), [events]);

  if (events.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <CalendarX2 className="h-10 w-10 text-muted-foreground/60" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium">No events in this range</p>
          <p className="text-sm text-muted-foreground">
            Use “New event” to create one.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <ul className="divide-y divide-border">
        {groups.map((group) => {
          const today = isToday(group.date);
          return (
            <li key={group.key}>
              <div className="sticky top-0 z-10 flex items-baseline gap-2 border-b border-border bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
                <span
                  className={cn(
                    "text-sm font-semibold",
                    today ? "text-primary" : "text-foreground",
                  )}
                >
                  {format(group.date, "EEEE")}
                </span>
                <span className="text-sm text-muted-foreground">
                  {format(group.date, "d MMMM")}
                </span>
                {today && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    Today
                  </span>
                )}
              </div>

              <ul>
                {group.events.map((ev) => {
                  const account = accountById(accounts, ev.accountId);
                  const color = account?.color ?? "#94a3b8";
                  const isOnline = ev.conferenceType !== "none";
                  return (
                    <li key={`${ev.accountId}:${ev.id}`}>
                      <button
                        type="button"
                        onClick={() => onEventClick(ev)}
                        className="flex w-full items-stretch gap-3 px-4 py-2.5 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
                      >
                        <span
                          className="mt-0.5 w-1 shrink-0 rounded-full"
                          style={{ backgroundColor: color }}
                          aria-hidden="true"
                        />
                        <span className="w-28 shrink-0 pt-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                          {timeRange(ev)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <AccountDot
                              color={color}
                              size="sm"
                              aria-label={account?.email ?? "Account"}
                            />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium" title={ev.title}>
                              {ev.title || "(no title)"}
                            </span>
                          </span>
                          {(isOnline || ev.location) && (
                            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                              {isOnline ? (
                                <>
                                  <Video className="h-3 w-3 shrink-0" aria-hidden="true" />
                                  <span className="truncate">
                                    {ev.conferenceType === "google_meet"
                                      ? "Google Meet"
                                      : "Microsoft Teams"}
                                  </span>
                                </>
                              ) : (
                                <>
                                  <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                                  <span className="truncate" title={ev.location ?? undefined}>
                                    {ev.location}
                                  </span>
                                </>
                              )}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
