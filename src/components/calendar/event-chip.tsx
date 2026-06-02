"use client";

import * as React from "react";
import { format } from "date-fns";

import { cn } from "@/lib/utils";
import type { UnifiedEvent } from "@/lib/types";

/**
 * Decides whether a hex colour needs light or dark text for legible contrast.
 * Uses the relative-luminance threshold; falls back to dark text on parse miss.
 */
function readableTextColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "hsl(var(--foreground))";
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 0xff;
  const g = (int >> 8) & 0xff;
  const b = int & 0xff;
  // Perceived luminance (sRGB-weighted).
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#0b1120" : "#ffffff";
}

export interface EventChipProps {
  event: UnifiedEvent;
  /** The owning account's colour (drives the chip fill). */
  color: string;
  /** Tighter single-line presentation for dense month cells. */
  compact?: boolean;
  onClick?: (event: UnifiedEvent) => void;
  className?: string;
}

/**
 * A compact, account-coloured representation of an event used in the month and
 * week grids. Shows the start time + title on one line, truncating cleanly.
 */
export function EventChip({
  event,
  color,
  compact = false,
  onClick,
  className,
}: EventChipProps) {
  const textColor = readableTextColor(color);
  const timeLabel = event.allDay ? "All day" : format(new Date(event.start), "HH:mm");
  const label = `${timeLabel} · ${event.title || "(no title)"}`;

  return (
    <button
      type="button"
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(event);
      }}
      style={{ backgroundColor: color, color: textColor }}
      className={cn(
        "group flex w-full items-center gap-1 overflow-hidden rounded px-1.5 text-left text-xs font-medium leading-tight outline-none transition-[filter] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        compact ? "py-0.5" : "py-1",
        className,
      )}
    >
      {!event.allDay && (
        <span className="shrink-0 tabular-nums opacity-80">{timeLabel}</span>
      )}
      <span className="min-w-0 flex-1 truncate">
        {event.title || "(no title)"}
      </span>
    </button>
  );
}
