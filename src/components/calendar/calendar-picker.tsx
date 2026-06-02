"use client";

import * as React from "react";
import { CalendarDays, Check, Loader2 } from "lucide-react";

import { AccountDot } from "@/components/account-dot";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { accountById } from "@/hooks/use-accounts";
import { calendarKey } from "@/hooks/use-calendars";
import type { AccountError, AccountPublic, CalendarInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

interface CalendarPickerProps {
  accounts: AccountPublic[];
  calendars: CalendarInfo[];
  /** Calendar keys (accountId + id) currently visible. */
  selected: ReadonlySet<string>;
  onToggle: (calendar: CalendarInfo, visible: boolean) => void;
  /** Show/hide every calendar at once. */
  onSetAll: (visible: boolean) => void;
  isLoading: boolean;
  errors: AccountError[];
}

interface AccountGroup {
  accountId: string;
  label: string;
  color: string;
  calendars: CalendarInfo[];
}

/** Groups calendars under their owning account, preserving provider order. */
function groupByAccount(
  accounts: AccountPublic[],
  calendars: CalendarInfo[],
): AccountGroup[] {
  const groups = new Map<string, AccountGroup>();
  for (const cal of calendars) {
    let group = groups.get(cal.accountId);
    if (!group) {
      const account = accountById(accounts, cal.accountId);
      group = {
        accountId: cal.accountId,
        label: account?.email ?? "Unknown account",
        color: account?.color ?? "hsl(var(--muted-foreground))",
        calendars: [],
      };
      groups.set(cal.accountId, group);
    }
    group.calendars.push(cal);
  }
  // Primaries first within each account, then alphabetical.
  for (const group of groups.values()) {
    group.calendars.sort((a, b) => {
      if (a.primary !== b.primary) return a.primary ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }
  return [...groups.values()];
}

export function CalendarPicker({
  accounts,
  calendars,
  selected,
  onToggle,
  onSetAll,
  isLoading,
  errors,
}: CalendarPickerProps) {
  const [open, setOpen] = React.useState(false);

  const groups = React.useMemo(
    () => groupByAccount(accounts, calendars),
    [accounts, calendars],
  );

  const total = calendars.length;
  const visibleCount = calendars.reduce(
    (n, c) => (selected.has(calendarKey(c.accountId, c.id)) ? n + 1 : n),
    0,
  );
  const allVisible = total > 0 && visibleCount === total;
  const noneVisible = visibleCount === 0;

  // Compact count for the trigger: "All" when everything is on, else "n/total".
  const countLabel =
    total === 0 ? null : allVisible ? "All" : `${visibleCount}/${total}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          aria-label="Choose which calendars are visible"
        >
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Calendars</span>
          {countLabel && (
            <span className="ml-0.5 rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-secondary-foreground">
              {countLabel}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="flex items-center justify-between gap-2 px-3 py-2.5">
          <p className="text-sm font-semibold">Calendars</p>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={total === 0 || allVisible}
              onClick={() => onSetAll(true)}
            >
              All
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={total === 0 || noneVisible}
              onClick={() => onSetAll(false)}
            >
              None
            </Button>
          </div>
        </div>
        <Separator />

        <div className="max-h-[min(60vh,22rem)] overflow-y-auto py-1 scrollbar-thin">
          {isLoading && total === 0 ? (
            <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading calendars…
            </div>
          ) : total === 0 ? (
            <p className="px-3 py-6 text-sm text-muted-foreground">
              No calendars found.
            </p>
          ) : (
            groups.map((group, gi) => (
              <div key={group.accountId} className={cn(gi > 0 && "mt-1")}>
                <div className="flex items-center gap-2 px-3 pb-1 pt-2">
                  <AccountDot color={group.color} size="sm" />
                  <span
                    className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-wide text-muted-foreground"
                    title={group.label}
                  >
                    {group.label}
                  </span>
                </div>
                <ul role="group" aria-label={`Calendars for ${group.label}`}>
                  {group.calendars.map((cal) => {
                    const key = calendarKey(cal.accountId, cal.id);
                    const checked = selected.has(key);
                    const dot = cal.color ?? group.color;
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={checked}
                          onClick={() => onToggle(cal, !checked)}
                          className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                        >
                          <span
                            className={cn(
                              "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                              checked ? "border-transparent" : "border-input",
                            )}
                            style={
                              checked ? { backgroundColor: dot } : undefined
                            }
                            aria-hidden="true"
                          >
                            {checked && (
                              <Check
                                className="h-3 w-3 text-white"
                                strokeWidth={3}
                              />
                            )}
                          </span>
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/5"
                            style={{ backgroundColor: dot }}
                            aria-hidden="true"
                          />
                          <span
                            className={cn(
                              "min-w-0 flex-1 truncate",
                              !checked && "text-muted-foreground",
                            )}
                            title={cal.name}
                          >
                            {cal.name}
                          </span>
                          {cal.primary && (
                            <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              Primary
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>

        {errors.length > 0 && (
          <>
            <Separator />
            <p className="px-3 py-2 text-xs text-muted-foreground">
              Couldn’t load calendars from {errors.length} account
              {errors.length === 1 ? "" : "s"}.
            </p>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
