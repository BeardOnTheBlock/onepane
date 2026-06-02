"use client";

import * as React from "react";
import { Paperclip } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AccountPublic } from "@/lib/types";
import type { Conversation } from "@/components/inbox/conversations";

export interface MailListItemProps {
  conversation: Conversation;
  /** The account the conversation belongs to, for the colour stripe (may be absent). */
  account: AccountPublic | undefined;
  selected: boolean;
  onSelect: (conversation: Conversation) => void;
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
  conversation,
  account,
  selected,
  onSelect,
}: MailListItemProps) {
  const { latest, count, unread, hasAttachments } = conversation;
  const senderLabel = latest.from.name?.trim() || latest.from.email;
  const stripeColor = account?.color ?? "hsl(var(--muted-foreground))";
  const time = relativeTime(latest.date);
  const fullTime = new Date(latest.date).toLocaleString();

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(conversation)}
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
        {unread ? (
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
              unread
                ? "font-semibold text-foreground"
                : "font-medium text-foreground/90",
            )}
            title={latest.from.email}
          >
            {senderLabel}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {count > 1 ? (
              <Badge
                variant="secondary"
                className="h-5 min-w-5 justify-center rounded-full px-1.5 py-0 text-[11px] font-semibold tabular-nums"
                aria-label={`${count} messages`}
                title={`${count} messages`}
              >
                {count}
              </Badge>
            ) : null}
            {hasAttachments ? (
              <Paperclip
                className="h-3.5 w-3.5 text-muted-foreground"
                aria-label="Has attachments"
              />
            ) : null}
            <time
              dateTime={latest.date}
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
            unread ? "font-medium text-foreground" : "text-foreground/80",
          )}
          title={latest.subject || "(no subject)"}
        >
          {latest.subject || "(no subject)"}
        </span>

        {latest.snippet ? (
          <span
            className="min-w-0 truncate text-xs text-muted-foreground"
            title={latest.snippet}
          >
            {latest.snippet}
          </span>
        ) : null}
      </div>
    </button>
  );
}

export const MailListItem = React.memo(MailListItemComponent);
