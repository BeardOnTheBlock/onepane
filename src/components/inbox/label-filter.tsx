"use client";

import * as React from "react";
import { Inbox, Loader2, Plus, Tag } from "lucide-react";

import {
  CreateLabelDialog,
  labelNoun,
} from "@/components/inbox/move-to-menu";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useLabels } from "@/hooks/use-labels";
import { cn } from "@/lib/utils";
import type { MailLabel, ProviderId } from "@/lib/types";

/** Sentinel for "no label selected" — the account's inbox. */
export const INBOX_LABEL = null;

/** Gmail system labels we never offer as a filter (they aren't a mailbox view). */
const HIDDEN_SYSTEM_IDS = new Set([
  "UNREAD",
  "STARRED",
  "IMPORTANT",
  "CHAT",
  "CATEGORY_PERSONAL",
  "CATEGORY_SOCIAL",
  "CATEGORY_PROMOTIONS",
  "CATEGORY_UPDATES",
  "CATEGORY_FORUMS",
]);

function isFilterable(label: MailLabel): boolean {
  // INBOX is represented by the dedicated "Inbox" chip, not a label chip.
  if (label.id === "INBOX") return false;
  if (label.type === "system" && HIDDEN_SYSTEM_IDS.has(label.id)) return false;
  return true;
}

export interface LabelFilterProps {
  /** The single account whose labels/folders are shown. */
  accountId: string;
  provider: ProviderId;
  /** Currently selected label id, or null for the inbox. */
  value: string | null;
  onChange: (labelId: string | null) => void;
  className?: string;
}

/**
 * A horizontal, scrollable row of label/folder chips for a single account: an
 * "Inbox" chip (the default, no labelId) followed by one chip per filterable
 * label, ending with a "New …" affordance. Mirrors AccountFilter's chip styling
 * and keyboard model (a single-select radiogroup) so it reads as a natural
 * second row beneath the account filter.
 */
export function LabelFilter({
  accountId,
  provider,
  value,
  onChange,
  className,
}: LabelFilterProps) {
  const { labels, isLoading, mutate } = useLabels(accountId);
  const [createOpen, setCreateOpen] = React.useState(false);
  const noun = labelNoun(provider);

  const filterable = React.useMemo(
    () => labels.filter(isFilterable),
    [labels],
  );

  const handleCreated = React.useCallback(
    (label: MailLabel) => {
      void mutate();
      onChange(label.id);
    },
    [mutate, onChange],
  );

  if (isLoading && labels.length === 0) {
    return (
      <div className={cn("flex gap-1.5 pb-2", className)} aria-hidden="true">
        <Skeleton className="h-8 w-20 rounded-full" />
        <Skeleton className="h-8 w-24 rounded-full" />
        <Skeleton className="h-8 w-16 rounded-full" />
      </div>
    );
  }

  return (
    <>
      <ScrollArea className={cn("w-full whitespace-nowrap", className)}>
        <div
          role="radiogroup"
          aria-label={`Filter by ${noun.one}`}
          className="flex items-center gap-1.5 pb-2"
        >
          <Chip
            selected={value === INBOX_LABEL}
            onSelect={() => onChange(INBOX_LABEL)}
          >
            <Inbox className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Inbox
          </Chip>

          {filterable.map((label) => (
            <Chip
              key={label.id}
              selected={value === label.id}
              onSelect={() => onChange(label.id)}
              title={label.name}
            >
              <Tag
                className="h-3.5 w-3.5 shrink-0 opacity-70"
                aria-hidden="true"
              />
              <span className="min-w-0 max-w-[12rem] truncate">
                {label.name}
              </span>
            </Chip>
          ))}

          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            title={noun.create}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-border bg-background px-3 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          >
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            )}
            <span className="capitalize">{noun.create}</span>
          </button>
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      <CreateLabelDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        accountId={accountId}
        provider={provider}
        onCreated={handleCreated}
      />
    </>
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
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring",
        selected
          ? "border-transparent bg-primary text-primary-foreground shadow-sm"
          : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
