"use client";

import * as React from "react";

import { AccountDot } from "@/components/account-dot";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { AccountPublic } from "@/lib/types";

/**
 * The sentinel value used to mean "show messages/events from every account".
 * Exported so callers can compare against it without re-deriving the string.
 */
export const ALL_ACCOUNTS = "all" as const;

export type AccountFilterValue = string;

export interface AccountFilterProps {
  accounts: AccountPublic[];
  /** Currently selected account id, or "all". */
  value: AccountFilterValue;
  onChange: (value: AccountFilterValue) => void;
  className?: string;
}

/**
 * A horizontal, scrollable row of filter chips: an "All" chip followed by one
 * colour-coded chip per connected account. Shared by the Inbox and Calendar
 * screens to control which account's items are shown.
 *
 * Implemented as a single-select radiogroup so it is fully keyboard accessible
 * (arrow keys move between chips; Space/Enter selects).
 */
export function AccountFilter({
  accounts,
  value,
  onChange,
  className,
}: AccountFilterProps) {
  return (
    <ScrollArea className={cn("w-full whitespace-nowrap", className)}>
      <div
        role="radiogroup"
        aria-label="Filter by account"
        className="flex items-center gap-1.5 pb-2"
      >
        <Chip
          selected={value === ALL_ACCOUNTS}
          onSelect={() => onChange(ALL_ACCOUNTS)}
        >
          All
        </Chip>

        {accounts.map((account) => (
          <Chip
            key={account.id}
            selected={value === account.id}
            onSelect={() => onChange(account.id)}
            title={account.email}
          >
            <AccountDot color={account.color} size="sm" />
            <span className="min-w-0 max-w-[12rem] truncate">
              {account.displayName ?? account.email}
            </span>
          </Chip>
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}

function Chip({
  selected,
  onSelect,
  title,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      title={title}
      onClick={onSelect}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-2 rounded-full border px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring",
        selected
          ? "border-transparent bg-primary text-primary-foreground shadow-sm"
          : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
