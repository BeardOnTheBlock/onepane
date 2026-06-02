"use client";

import * as React from "react";
import { Archive, Paperclip, Star, Trash2 } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";

import { MoveToMenu } from "@/components/inbox/move-to-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { AccountPublic, MailActionType } from "@/lib/types";
import type { Conversation } from "@/components/inbox/conversations";
import type { ActionTarget } from "@/hooks/use-mail-actions";

export interface MailListItemProps {
  conversation: Conversation;
  /** The account the conversation belongs to, for the colour stripe (may be absent). */
  account: AccountPublic | undefined;
  selected: boolean;
  /** Label id of the current view, hidden from the row's move menu. */
  currentLabelId?: string | null;
  onSelect: (conversation: Conversation) => void;
  /** Apply a triage action to a target set of messages. */
  onAction: (target: ActionTarget, action: MailActionType) => void;
  /** Called after this conversation is moved to a label/folder. When absent (or
   *  the account is unknown) the row shows no move control. */
  onMoved?: (target: ActionTarget) => void;
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
  currentLabelId,
  onSelect,
  onAction,
  onMoved,
}: MailListItemProps) {
  const { latest, count, unread, hasAttachments } = conversation;
  const senderLabel = latest.from.name?.trim() || latest.from.email;
  const stripeColor = account?.color ?? "hsl(var(--muted-foreground))";
  const time = relativeTime(latest.date);
  const fullTime = new Date(latest.date).toLocaleString();

  // No starred flag on UnifiedMessage, so the star is optimistic-local here.
  const [starred, setStarred] = React.useState(false);

  const target = React.useMemo<ActionTarget>(
    () => ({
      accountId: conversation.accountId,
      messageIds: conversation.messageIds,
    }),
    [conversation.accountId, conversation.messageIds],
  );

  const fire = React.useCallback(
    (e: React.MouseEvent, action: MailActionType) => {
      // Keep the row's click-to-open behaviour from firing.
      e.stopPropagation();
      onAction(target, action);
    },
    [onAction, target],
  );

  const toggleStar = React.useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const next = !starred;
      setStarred(next);
      onAction(target, next ? "star" : "unstar");
    },
    [onAction, target, starred],
  );

  const handleMoved = React.useCallback(() => {
    onMoved?.(target);
  }, [onMoved, target]);

  // Offer the move control only when the page wired up `onMoved` (single-account
  // view) and we know the provider (to label it folder vs label correctly).
  const canMove = Boolean(onMoved) && account !== undefined;

  return (
    <div
      className={cn(
        "group relative rounded-lg transition-colors",
        selected ? "bg-secondary" : "hover:bg-accent",
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(conversation)}
        className="relative flex w-full items-stretch gap-3 rounded-lg py-2.5 pl-4 pr-3 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
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

      {/* Quick-actions overlay. Sits outside the row button (no nested
          buttons) and stops propagation so it never opens the conversation.
          Star is always visible; Archive/Delete reveal on hover/focus. */}
      <div className="pointer-events-none absolute right-2 top-1.5 flex items-center gap-0.5">
        {canMove && account ? (
          <MoveToMenu
            accountId={conversation.accountId}
            provider={account.provider}
            messageIds={conversation.messageIds}
            currentLabelId={currentLabelId}
            onMoved={handleMoved}
            size="sm"
            className="pointer-events-auto opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
          />
        ) : null}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={starred ? "Remove star" : "Star"}
              aria-pressed={starred}
              onClick={toggleStar}
              className={cn(
                "pointer-events-auto h-7 w-7",
                starred
                  ? "text-amber-500 hover:text-amber-500"
                  : "opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100",
              )}
            >
              <Star
                className={cn("h-3.5 w-3.5", starred && "fill-current")}
                aria-hidden="true"
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{starred ? "Remove star" : "Star"}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Archive"
              onClick={(e) => fire(e, "archive")}
              className="pointer-events-auto h-7 w-7 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
            >
              <Archive className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Archive</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Delete"
              onClick={(e) => fire(e, "trash")}
              className="pointer-events-auto h-7 w-7 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

export const MailListItem = React.memo(MailListItemComponent);
