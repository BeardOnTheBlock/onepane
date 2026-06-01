"use client";

import * as React from "react";
import { Paperclip } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";

import { cn } from "@/lib/utils";
import type { AccountPublic, UnifiedMessage } from "@/lib/types";

export interface MailListItemProps {
  message: UnifiedMessage;
  /** The account the message belongs to, for the colour stripe (may be absent). */
  account: AccountPublic | undefined;
  selected: boolean;
  onSelect: (message: UnifiedMessage) => void;
}

/** Compact relative time, e.g. "3h", "2d". Falls back gracefully on bad dates. */
function relativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return formatDistanceToNowStrict(date, { addSuffix: false })
    .replace(/ seconds?/, "s")
    .replace(/ minutes?/, "m")
    .replace(/ hours?/, "h")
    .replace(/ days?/, "d")
    .replace(/ months?/, "mo")
    .replace(/ years?/, "y");
}

function MailListItemComponent({
  message,
  account,
  selected,
  onSelect,
}: MailListItemProps) {
  const senderLabel = message.from.name?.trim() || message.from.email;
  const stripeColor = account?.color ?? "hsl(var(--muted-foreground))";
  const time = relativeTime(message.date);
  const fullTime = new Date(message.date).toLocaleString();

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(message)}
      className={cn(
        "group relative flex w-full items-stretch gap-3 rounded-lg py-2.5 pl-4 pr-3 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring",
        selected ? "bg-secondary" : "hover:bg-accent",
      )}
    >
      {/* Account colour stripe */}
      <span
        aria-hidden="true"
        className="absolute inset-y-2 left-1 w-1 rounded-full"
        style={{ backgroundColor: stripeColor }}
      />

      {/* Unread indicator column keeps text aligned whether or not it shows. */}
      <span className="flex w-2 shrink-0 items-center justify-center pt-1.5">
        {message.unread ? (
          <span
            className="h-2 w-2 rounded-full bg-primary"
            aria-label="Unread"
          />
        ) : null}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              message.unread
                ? "font-semibold text-foreground"
                : "font-medium text-foreground/90",
            )}
            title={message.from.email}
          >
            {senderLabel}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {message.hasAttachments ? (
              <Paperclip
                className="h-3.5 w-3.5 text-muted-foreground"
                aria-label="Has attachments"
              />
            ) : null}
            <time
              dateTime={message.date}
              title={fullTime}
              className="shrink-0 text-xs tabular-nums text-muted-foreground"
            >
              {time}
            </time>
          </span>
        </div>

        <span
          className={cn(
            "min-w-0 truncate text-sm",
            message.unread
              ? "font-medium text-foreground"
              : "text-foreground/80",
          )}
          title={message.subject || "(no subject)"}
        >
          {message.subject || "(no subject)"}
        </span>

        {message.snippet ? (
          <span
            className="min-w-0 truncate text-xs text-muted-foreground"
            title={message.snippet}
          >
            {message.snippet}
          </span>
        ) : null}
      </div>
    </button>
  );
}

export const MailListItem = React.memo(MailListItemComponent);
