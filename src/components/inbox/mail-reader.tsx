"use client";

import * as React from "react";
import useSWR from "swr";
import { AlertCircle, MailOpen, Reply } from "lucide-react";

import { AccountBadge } from "@/components/account-badge";
import { EmptyState } from "@/components/empty-state";
import { ThreadMessage } from "@/components/inbox/thread-message";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { accountById } from "@/hooks/use-accounts";
import { fetcher } from "@/lib/fetcher";
import type {
  AccountPublic,
  MailMessageResponse,
  MailThreadResponse,
  UnifiedMessageFull,
} from "@/lib/types";
import type { ComposePrefill } from "@/components/inbox/compose-dialog";

/** The conversation the reader is showing: account + thread + representative msg. */
export interface ReaderSelection {
  accountId: string;
  threadId: string | null;
  messageId: string;
}

export interface MailReaderProps {
  selected: ReaderSelection | null;
  accounts: AccountPublic[];
  onReply: (prefill: ComposePrefill) => void;
}

/** Build the reply pre-fill from a fully-loaded message (the latest in a thread). */
function buildReplyPrefill(m: UnifiedMessageFull): ComposePrefill {
  const subject = /^re:/i.test(m.subject.trim())
    ? m.subject
    : `Re: ${m.subject}`;
  return {
    accountId: m.accountId,
    to: [m.from],
    subject,
    reply: {
      inReplyToMessageId: m.id,
      threadId: m.threadId,
      messageIdHeader: m.messageIdHeader,
      references: m.references,
    },
  };
}

/** SWR key for the conversation: the thread when threaded, else the single message. */
function readerKey(selected: ReaderSelection | null): string | null {
  if (!selected) return null;
  if (selected.threadId) {
    return `/api/mail/thread?accountId=${encodeURIComponent(
      selected.accountId,
    )}&threadId=${encodeURIComponent(selected.threadId)}`;
  }
  return `/api/mail/message?accountId=${encodeURIComponent(
    selected.accountId,
  )}&id=${encodeURIComponent(selected.messageId)}`;
}

/** Normalises either endpoint's payload into a list of messages, oldest first. */
function messagesFrom(
  selected: ReaderSelection,
  data: MailThreadResponse | MailMessageResponse | undefined,
): UnifiedMessageFull[] {
  if (!data) return [];
  if (selected.threadId) {
    return (data as MailThreadResponse).messages ?? [];
  }
  const single = (data as MailMessageResponse).message;
  return single ? [single] : [];
}

export function MailReader({ selected, accounts, onReply }: MailReaderProps) {
  const key = readerKey(selected);

  const { data, error, isLoading } = useSWR<
    MailThreadResponse | MailMessageResponse
  >(key, fetcher);

  const messages = React.useMemo(
    () => (selected ? messagesFrom(selected, data) : []),
    [selected, data],
  );

  // Track which message cards are expanded. We default to the latest expanded,
  // re-deriving whenever the conversation changes (keyed on its message ids).
  const idSignature = messages.map((m) => m.id).join("|");
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    if (messages.length === 0) {
      setExpanded(new Set());
      return;
    }
    const latest = messages[messages.length - 1];
    setExpanded(new Set([latest.id]));
    // Re-run only when the conversation's identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idSignature]);

  const toggle = React.useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (!selected) {
    return (
      <EmptyState
        icon={MailOpen}
        title="Select a message"
        description="Choose a message from the list to read it here."
      />
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Couldn't load this conversation"
        description={error instanceof Error ? error.message : undefined}
      />
    );
  }

  if (isLoading || messages.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <div className="space-y-3 border-b border-border p-5">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </div>
        <div className="space-y-3 p-5">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  const latest = messages[messages.length - 1];
  const account = accountById(accounts, selected.accountId);
  const subject = latest.subject || "(no subject)";

  return (
    <div className="flex h-full flex-col">
      {/* Conversation header */}
      <div className="shrink-0 border-b border-border p-5">
        <div className="flex items-start justify-between gap-4">
          <h2 className="min-w-0 break-words text-lg font-semibold leading-snug text-foreground">
            {subject}
          </h2>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => onReply(buildReplyPrefill(latest))}
          >
            <Reply aria-hidden="true" />
            Reply
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          {account ? (
            <AccountBadge
              account={account}
              className="rounded-full bg-secondary px-2.5 py-0.5"
            />
          ) : null}
          {messages.length > 1 ? (
            <span className="text-xs text-muted-foreground">
              {messages.length} messages
            </span>
          ) : null}
        </div>
      </div>

      {/* Conversation thread */}
      <ScrollArea className="min-h-0 flex-1 scrollbar-thin">
        <div className="flex flex-col gap-2.5 p-4">
          {messages.map((message) => (
            <ThreadMessage
              key={message.id}
              message={message}
              account={accountById(accounts, message.accountId) ?? account}
              expanded={expanded.has(message.id)}
              onToggle={() => toggle(message.id)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
