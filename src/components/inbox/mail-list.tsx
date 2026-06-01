"use client";

import * as React from "react";
import { MailX } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { MailListItem } from "@/components/inbox/mail-list-item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { accountById } from "@/hooks/use-accounts";
import type { AccountPublic, UnifiedMessage } from "@/lib/types";

export interface MailListProps {
  messages: UnifiedMessage[];
  accounts: AccountPublic[];
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (message: UnifiedMessage) => void;
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

export function MailList({
  messages,
  accounts,
  isLoading,
  selectedId,
  onSelect,
}: MailListProps) {
  if (isLoading && messages.length === 0) {
    return (
      <div className="flex flex-col gap-0.5 p-2" aria-busy="true">
        {Array.from({ length: 8 }).map((_, i) => (
          <MailListSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <EmptyState
        icon={MailX}
        title="No messages"
        description="There's nothing in this view right now. Try a different account filter or refresh."
      />
    );
  }

  return (
    <ScrollArea className="h-full scrollbar-thin">
      <ul className="flex flex-col gap-0.5 p-2">
        {messages.map((message) => (
          <li key={`${message.accountId}:${message.id}`}>
            <MailListItem
              message={message}
              account={accountById(accounts, message.accountId)}
              selected={selectedId === message.id}
              onSelect={onSelect}
            />
          </li>
        ))}
      </ul>
    </ScrollArea>
  );
}
