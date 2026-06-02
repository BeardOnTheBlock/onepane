"use client";

import * as React from "react";
import { FileText, Loader2, Trash2 } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { accountById } from "@/hooks/use-accounts";
import { cn } from "@/lib/utils";
import type { AccountPublic, DraftSummary, MailAddress } from "@/lib/types";

export interface DraftsListProps {
  drafts: DraftSummary[];
  accounts: AccountPublic[];
  isLoading: boolean;
  /** The selected draft id, or null. */
  selectedId: string | null;
  /** Open a draft in the editor. */
  onSelect: (draft: DraftSummary) => void;
  /** Delete a draft from the list (the row handles stopPropagation). */
  onDelete: (draft: DraftSummary) => void;
  /** Draft ids currently being deleted (row shows a spinner + is disabled). */
  deletingIds?: ReadonlySet<string>;
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

function formatRecipients(addresses: MailAddress[]): string {
  return addresses
    .map((a) => a.name?.trim() || a.email)
    .filter(Boolean)
    .join(", ");
}

/** A single placeholder row shown while drafts load. */
function DraftSkeleton() {
  return (
    <div className="flex w-full items-stretch gap-3 py-2.5 pl-4 pr-3">
      <span className="w-2 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3 w-8" />
        </div>
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-3 w-full" />
      </div>
    </div>
  );
}

function DraftRow({
  draft,
  account,
  selected,
  onSelect,
  onDelete,
  deleting,
}: {
  draft: DraftSummary;
  account: AccountPublic | undefined;
  selected: boolean;
  onSelect: (draft: DraftSummary) => void;
  onDelete: (draft: DraftSummary) => void;
  deleting: boolean;
}) {
  const stripeColor = account?.color ?? "hsl(var(--muted-foreground))";
  const time = relativeTime(draft.updatedAt);
  const fullTime = new Date(draft.updatedAt).toLocaleString();
  const hasRecipients = draft.to.length > 0;
  const recipientLabel = hasRecipients
    ? formatRecipients(draft.to)
    : "(no recipients)";
  const recipientTitle = hasRecipients
    ? draft.to.map((a) => a.email).join(", ")
    : "(no recipients)";

  const handleDelete = React.useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (deleting) return;
      onDelete(draft);
    },
    [onDelete, draft, deleting],
  );

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
        onClick={() => onSelect(draft)}
        className="relative flex w-full items-stretch gap-3 rounded-lg py-2.5 pl-4 pr-3 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {/* Account colour stripe */}
        <span
          aria-hidden="true"
          className="absolute inset-y-2 left-1 w-1 rounded-full"
          style={{ backgroundColor: stripeColor }}
        />

        {/* Draft glyph column keeps text aligned with the inbox list. */}
        <span className="flex w-2 shrink-0 items-center justify-center pt-1.5">
          <FileText
            className="h-3.5 w-3.5 text-muted-foreground"
            aria-hidden="true"
          />
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm font-medium text-foreground/90",
                !hasRecipients && "italic text-muted-foreground",
              )}
              title={recipientTitle}
            >
              {recipientLabel}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {/* Keep room for the delete button so the timestamp never jumps
                  under the hover overlay. */}
              <time
                dateTime={draft.updatedAt}
                title={fullTime}
                className="shrink-0 text-xs tabular-nums text-muted-foreground transition-opacity group-hover:opacity-0 group-focus-within:opacity-0"
              >
                {time}
              </time>
            </span>
          </div>

          <span
            className={cn(
              "min-w-0 truncate text-sm text-foreground/80",
              !draft.subject && "italic text-muted-foreground",
            )}
            title={draft.subject || "(no subject)"}
          >
            {draft.subject || "(no subject)"}
          </span>

          {draft.snippet ? (
            <span
              className="min-w-0 truncate text-xs text-muted-foreground"
              title={draft.snippet}
            >
              {draft.snippet}
            </span>
          ) : null}
        </div>
      </button>

      {/* Quick delete. Sits outside the row button (no nested buttons) and
          stops propagation so it never opens the draft. */}
      <div className="pointer-events-none absolute right-2 top-1.5 flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Delete draft"
              onClick={handleDelete}
              disabled={deleting}
              className="pointer-events-auto h-7 w-7 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 disabled:opacity-100"
            >
              {deleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete draft</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

/**
 * The drafts pane for a single account. Mirrors MailList's shell (loading
 * skeletons, scroll area, empty state) and MailListItem's row layout so the
 * Drafts view reads as a natural variant of the inbox.
 */
export function DraftsList({
  drafts,
  accounts,
  isLoading,
  selectedId,
  onSelect,
  onDelete,
  deletingIds,
}: DraftsListProps) {
  if (isLoading && drafts.length === 0) {
    return (
      <div className="flex flex-col gap-0.5 p-2" aria-busy="true">
        {Array.from({ length: 8 }).map((_, i) => (
          <DraftSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (drafts.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No drafts"
        description="Messages you save without sending will appear here. Start a new message and choose ‘Save as draft’."
      />
    );
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col")}>
      <ScrollArea className="min-h-0 flex-1 scrollbar-thin">
        <ul className="flex flex-col gap-0.5 p-2">
          {drafts.map((draft) => (
            <li key={draft.id}>
              <DraftRow
                draft={draft}
                account={accountById(accounts, draft.accountId)}
                selected={selectedId === draft.id}
                onSelect={onSelect}
                onDelete={onDelete}
                deleting={deletingIds?.has(draft.id) ?? false}
              />
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
}
