"use client";

import * as React from "react";
import useSWR from "swr";
import { AlertCircle, MailOpen, Paperclip, Reply } from "lucide-react";

import { AccountBadge } from "@/components/account-badge";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { accountById } from "@/hooks/use-accounts";
import { fetcher } from "@/lib/fetcher";
import { formatAddress } from "@/lib/utils";
import type {
  AccountPublic,
  MailMessageResponse,
  UnifiedMessageFull,
} from "@/lib/types";
import type { ComposePrefill } from "@/components/inbox/compose-dialog";

export interface MailReaderProps {
  /** The selected list message's account + id, or null for the empty state. */
  selected: { accountId: string; id: string } | null;
  accounts: AccountPublic[];
  onReply: (prefill: ComposePrefill) => void;
}

/** Build the reply pre-fill from a fully-loaded message. */
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

function AddressList({
  label,
  addresses,
}: {
  label: string;
  addresses: { name?: string; email: string }[];
}) {
  if (addresses.length === 0) return null;
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-12 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-foreground/90">
        {addresses.map((a) => formatAddress(a)).join(", ")}
      </span>
    </div>
  );
}

export function MailReader({ selected, accounts, onReply }: MailReaderProps) {
  const key = selected
    ? `/api/mail/message?accountId=${encodeURIComponent(
        selected.accountId,
      )}&id=${encodeURIComponent(selected.id)}`
    : null;

  const { data, error, isLoading } = useSWR<MailMessageResponse>(key, fetcher);

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
        title="Couldn't load this message"
        description={error instanceof Error ? error.message : undefined}
      />
    );
  }

  if (isLoading || !data) {
    return (
      <div className="flex h-full flex-col">
        <div className="space-y-3 border-b border-border p-5">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
        </div>
        <div className="space-y-3 p-5">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    );
  }

  const m = data.message;
  const account = accountById(accounts, m.accountId);
  const dateLabel = (() => {
    const d = new Date(m.date);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
  })();

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border p-5">
        <div className="flex items-start justify-between gap-4">
          <h2 className="min-w-0 break-words text-lg font-semibold leading-snug text-foreground">
            {m.subject || "(no subject)"}
          </h2>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => onReply(buildReplyPrefill(m))}
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
          {dateLabel ? (
            <time
              dateTime={m.date}
              className="text-xs text-muted-foreground"
            >
              {dateLabel}
            </time>
          ) : null}
          {m.hasAttachments ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
              Attachments
            </span>
          ) : null}
        </div>

        <div className="mt-3 space-y-1">
          <AddressList label="From" addresses={[m.from]} />
          <AddressList label="To" addresses={m.to} />
          <AddressList label="Cc" addresses={m.cc} />
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1">
        <MessageBody message={m} />
      </div>
    </div>
  );
}

/**
 * Renders the message body. HTML is isolated inside a fully sandboxed iframe
 * (empty `sandbox` attribute → no scripts, no same-origin, no top navigation),
 * so remote content can't run or read the app. Plain text is shown pre-wrapped.
 */
function MessageBody({ message }: { message: UnifiedMessageFull }) {
  if (message.bodyHtml) {
    return (
      <iframe
        title="Message content"
        sandbox=""
        srcDoc={message.bodyHtml}
        className="h-full w-full border-0 bg-white"
      />
    );
  }

  if (message.bodyText) {
    return (
      <ScrollArea className="h-full scrollbar-thin">
        <pre className="whitespace-pre-wrap break-words p-5 font-sans text-sm leading-relaxed text-foreground/90">
          {message.bodyText}
        </pre>
      </ScrollArea>
    );
  }

  return (
    <EmptyState
      icon={MailOpen}
      title="No content"
      description="This message has no body to display."
    />
  );
}
