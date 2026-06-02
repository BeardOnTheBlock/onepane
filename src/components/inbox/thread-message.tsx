"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { AccountDot } from "@/components/account-dot";
import { AttachmentList } from "@/components/inbox/attachment-list";
import { MessageActions } from "@/components/inbox/message-actions";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, formatAddress, initials } from "@/lib/utils";
import type {
  AccountPublic,
  MailActionType,
  UnifiedMessageFull,
} from "@/lib/types";

export interface ThreadMessageProps {
  message: UnifiedMessageFull;
  /** The account this message belongs to, for the avatar colour (may be absent). */
  account: AccountPublic | undefined;
  expanded: boolean;
  onToggle: () => void;
  /** Apply a triage action to just this message. Omit to hide per-message actions. */
  onAction?: (action: MailActionType) => void;
}

function dateLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

function AddressLine({
  label,
  addresses,
}: {
  label: string;
  addresses: { name?: string; email: string }[];
}) {
  if (addresses.length === 0) return null;
  return (
    <div className="flex gap-2 text-xs">
      <span className="w-9 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-foreground/80">
        {addresses.map((a) => formatAddress(a)).join(", ")}
      </span>
    </div>
  );
}

/**
 * Renders the message body in a fully sandboxed iframe (empty `sandbox` → no
 * scripts, no same-origin) for HTML, or pre-wrapped text otherwise. Identical
 * isolation approach to the single-message reader.
 */
function MessageBody({ message }: { message: UnifiedMessageFull }) {
  if (message.bodyHtml) {
    return (
      <iframe
        title={`Message from ${message.from.email}`}
        sandbox=""
        srcDoc={message.bodyHtml}
        className="h-[420px] w-full border-0 bg-white"
      />
    );
  }

  if (message.bodyText) {
    return (
      <ScrollArea className="max-h-[420px] scrollbar-thin">
        <pre className="whitespace-pre-wrap break-words p-4 font-sans text-sm leading-relaxed text-foreground/90">
          {message.bodyText}
        </pre>
      </ScrollArea>
    );
  }

  return (
    <p className="p-4 text-sm text-muted-foreground">
      This message has no body to display.
    </p>
  );
}

/**
 * A single card in the conversation reader. Collapsed cards show a one-line
 * summary (sender + snippet + date); expanded cards show the full header, the
 * sandboxed body, and any downloadable attachments. The whole header acts as
 * the expand/collapse toggle.
 */
function ThreadMessageComponent({
  message,
  account,
  expanded,
  onToggle,
  onAction,
}: ThreadMessageProps) {
  const senderLabel = message.from.name?.trim() || message.from.email;
  const when = dateLabel(message.date);
  const avatarColor = account?.color ?? "hsl(var(--muted-foreground))";

  // No starred flag on the message model — track per-message star locally.
  const [starred, setStarred] = React.useState(false);
  const handleAction = React.useCallback(
    (action: MailActionType) => {
      if (action === "star") setStarred(true);
      if (action === "unstar") setStarred(false);
      onAction?.(action);
    },
    [onAction],
  );

  return (
    <article
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-card",
        message.unread && "ring-1 ring-primary/30",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:ring-1 focus-visible:ring-ring"
      >
        {/* Avatar */}
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
          style={{ backgroundColor: avatarColor }}
        >
          {initials(senderLabel)}
        </span>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                message.unread
                  ? "font-semibold text-foreground"
                  : "font-medium text-foreground/90",
              )}
              title={message.from.email}
            >
              {senderLabel}
            </span>
            {when ? (
              <time
                dateTime={message.date}
                className="shrink-0 text-xs text-muted-foreground"
                title={when}
              >
                {when}
              </time>
            ) : null}
          </div>

          {/* Collapsed preview only. */}
          {!expanded ? (
            <span
              className="min-w-0 truncate text-xs text-muted-foreground"
              title={message.snippet}
            >
              {message.snippet || "(no preview)"}
            </span>
          ) : null}
        </div>

        <ChevronDown
          aria-hidden="true"
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded ? (
        <div className="border-t border-border">
          <div className="flex flex-col gap-0.5 px-4 py-2">
            <div className="mb-1 flex items-center gap-2">
              <AccountDot color={avatarColor} size="sm" />
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {account?.email ?? ""}
              </span>
              {onAction ? (
                <MessageActions
                  unread={message.unread}
                  starred={starred}
                  onAction={handleAction}
                  size="sm"
                  className="shrink-0"
                />
              ) : null}
            </div>
            <AddressLine label="From" addresses={[message.from]} />
            <AddressLine label="To" addresses={message.to} />
            <AddressLine label="Cc" addresses={message.cc} />
          </div>

          <div className="border-t border-border">
            <MessageBody message={message} />
          </div>

          <AttachmentList
            accountId={message.accountId}
            messageId={message.id}
            attachments={message.attachments}
            className="px-4 py-3"
          />
        </div>
      ) : null}
    </article>
  );
}

export const ThreadMessage = React.memo(ThreadMessageComponent);
