"use client";

import * as React from "react";
import { Archive, Mail, MailOpen, Star, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { MailActionType } from "@/lib/types";

export interface MessageActionsProps {
  /** Current unread state of the target — toggles the read/unread control. */
  unread: boolean;
  /** Current starred state of the target — toggles the star control. */
  starred: boolean;
  /** Invoked with the chosen action; the parent handles the optimistic update. */
  onAction: (action: MailActionType) => void;
  /** Disables every control (e.g. while the target is loading). */
  disabled?: boolean;
  /** Button size — "icon" (default) for headers, "sm" for compact rows. */
  size?: "icon" | "sm";
  /** Visually hide the control until the parent row is hovered/focused. */
  revealOnHover?: boolean;
  className?: string;
}

/** A single tooltip-wrapped icon button used inside the action row. */
function ActionButton({
  label,
  onClick,
  disabled,
  size,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  size: "icon" | "sm";
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={(e) => {
            // Don't let the click bubble to an enclosing clickable row/header.
            e.stopPropagation();
            onClick();
          }}
          className={cn(
            size === "sm" ? "h-7 w-7" : "h-8 w-8",
            active && "text-amber-500 hover:text-amber-500",
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * A compact, accessible row of triage icon-buttons (Archive, Delete, Mark
 * read/unread, Star/Unstar). Read/unread and star/unstar render as toggles
 * driven by `unread` / `starred`. Each press calls `onAction`; the parent owns
 * the optimistic update and network call.
 */
function MessageActionsComponent({
  unread,
  starred,
  onAction,
  disabled,
  size = "icon",
  revealOnHover = false,
  className,
}: MessageActionsProps) {
  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <div
      className={cn(
        "flex items-center gap-0.5",
        // When revealed on hover, keep layout stable (no shift) by only
        // animating opacity; the row still reserves its space.
        revealOnHover &&
          "opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100",
        className,
      )}
    >
      <ActionButton
        label="Archive"
        size={size}
        disabled={disabled}
        onClick={() => onAction("archive")}
      >
        <Archive className={iconSize} aria-hidden="true" />
      </ActionButton>

      <ActionButton
        label="Delete"
        size={size}
        disabled={disabled}
        onClick={() => onAction("trash")}
      >
        <Trash2 className={iconSize} aria-hidden="true" />
      </ActionButton>

      <ActionButton
        label={unread ? "Mark as read" : "Mark as unread"}
        size={size}
        disabled={disabled}
        onClick={() => onAction(unread ? "markRead" : "markUnread")}
      >
        {unread ? (
          <MailOpen className={iconSize} aria-hidden="true" />
        ) : (
          <Mail className={iconSize} aria-hidden="true" />
        )}
      </ActionButton>

      <ActionButton
        label={starred ? "Remove star" : "Star"}
        size={size}
        disabled={disabled}
        active={starred}
        onClick={() => onAction(starred ? "unstar" : "star")}
      >
        <Star
          className={cn(iconSize, starred && "fill-current")}
          aria-hidden="true"
        />
      </ActionButton>
    </div>
  );
}

export const MessageActions = React.memo(MessageActionsComponent);
