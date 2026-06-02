"use client";

import * as React from "react";
import { MailX, SearchX } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { MailListItem } from "@/components/inbox/mail-list-item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { accountById } from "@/hooks/use-accounts";
import { cn } from "@/lib/utils";
import type { AccountPublic, MailActionType } from "@/lib/types";
import type { Conversation } from "@/components/inbox/conversations";
import type { ActionTarget } from "@/hooks/use-mail-actions";

export interface MailListProps {
  conversations: Conversation[];
  accounts: AccountPublic[];
  isLoading: boolean;
  /** The selected conversation key, or null. */
  selectedKey: string | null;
  /** The active search term, used for the header label and empty-state copy. */
  query: string;
  onSelect: (conversation: Conversation) => void;
  /** Apply a triage action to a target set of messages. */
  onAction: (target: ActionTarget, action: MailActionType) => void;
}

/** A single placeholder row shown while messages load. */
function MailListSkeleton() {
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

/** Subtle "Results for ‘term’" header shown when a search is active. */
function ResultsHeader({ query, count }: { query: string; count: number }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
      <p className="min-w-0 truncate text-xs text-muted-foreground" title={query}>
        Results for <span className="font-medium text-foreground">‘{query}’</span>
      </p>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {count === 1 ? "1 result" : `${count} results`}
      </span>
    </div>
  );
}

export function MailList({
  conversations,
  accounts,
  isLoading,
  selectedKey,
  query,
  onSelect,
  onAction,
}: MailListProps) {
  const searching = query.trim().length > 0;

  if (isLoading && conversations.length === 0) {
    return (
      <div className="flex flex-col gap-0.5 p-2" aria-busy="true">
        {Array.from({ length: 8 }).map((_, i) => (
          <MailListSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (conversations.length === 0) {
    return searching ? (
      <div className="flex h-full flex-col">
        <ResultsHeader query={query} count={0} />
        <EmptyState
          icon={SearchX}
          title="No messages matched"
          description={`Nothing matched ‘${query}’. Try a different search or clear it.`}
        />
      </div>
    ) : (
      <EmptyState
        icon={MailX}
        title="No messages"
        description="There's nothing in this view right now. Try a different account filter or refresh."
      />
    );
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col")}>
      {searching ? (
        <ResultsHeader query={query} count={conversations.length} />
      ) : null}
      <ScrollArea className="min-h-0 flex-1 scrollbar-thin">
        <ul className="flex flex-col gap-0.5 p-2">
          {conversations.map((conversation) => (
            <li key={conversation.key}>
              <MailListItem
                conversation={conversation}
                account={accountById(accounts, conversation.accountId)}
                selected={selectedKey === conversation.key}
                onSelect={onSelect}
                onAction={onAction}
              />
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
}
