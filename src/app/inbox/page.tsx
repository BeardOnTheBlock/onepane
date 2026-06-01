"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { Inbox, PenSquare, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import {
  AccountFilter,
  ALL_ACCOUNTS,
} from "@/components/inbox/account-filter";
import {
  ComposeDialog,
  type ComposePrefill,
} from "@/components/inbox/compose-dialog";
import { MailList } from "@/components/inbox/mail-list";
import { MailReader } from "@/components/inbox/mail-reader";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccounts } from "@/hooks/use-accounts";
import { fetcher } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import type { AccountError, MailListResponse, UnifiedMessage } from "@/lib/types";

const PAGE_SIZE = 25;

/** Stable key for the message list given the current account filter. */
function mailKey(accountId: string): string {
  return `/api/mail?accountId=${encodeURIComponent(
    accountId,
  )}&limit=${PAGE_SIZE}`;
}

export default function InboxPage() {
  const { accounts, isLoading: accountsLoading } = useAccounts();

  const [filter, setFilter] = React.useState<string>(ALL_ACCOUNTS);
  const [selected, setSelected] = React.useState<{
    accountId: string;
    id: string;
  } | null>(null);

  const [composeOpen, setComposeOpen] = React.useState(false);
  const [prefill, setPrefill] = React.useState<ComposePrefill | undefined>();

  const { data, error, isLoading, isValidating, mutate } =
    useSWR<MailListResponse>(
      accounts.length > 0 ? mailKey(filter) : null,
      fetcher,
      { revalidateOnFocus: false },
    );

  const messages: UnifiedMessage[] = React.useMemo(
    () => data?.messages ?? [],
    [data?.messages],
  );

  // Surface per-account failures without blocking the messages that loaded.
  const reportedRef = React.useRef<string>("");
  React.useEffect(() => {
    const errors: AccountError[] = data?.errors ?? [];
    if (errors.length === 0) {
      reportedRef.current = "";
      return;
    }
    const signature = errors.map((e) => e.accountId).join("|");
    if (signature === reportedRef.current) return;
    reportedRef.current = signature;
    const names = errors.map((e) => e.email).join(", ");
    toast.warning(
      errors.length === 1
        ? `Couldn't load messages from ${names}.`
        : `Couldn't load messages from ${errors.length} accounts: ${names}.`,
    );
  }, [data?.errors]);

  // Whole-request failure (e.g. network/server error).
  React.useEffect(() => {
    if (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load your inbox.",
      );
    }
  }, [error]);

  // Drop the selection if the selected message is no longer in the list.
  React.useEffect(() => {
    if (!selected) return;
    const stillPresent = messages.some(
      (m) => m.id === selected.id && m.accountId === selected.accountId,
    );
    if (!stillPresent && !isLoading && !isValidating) {
      setSelected(null);
    }
  }, [messages, selected, isLoading, isValidating]);

  const handleSelect = React.useCallback((message: UnifiedMessage) => {
    setSelected({ accountId: message.accountId, id: message.id });
  }, []);

  const handleCompose = React.useCallback(() => {
    setPrefill(undefined);
    setComposeOpen(true);
  }, []);

  const handleReply = React.useCallback((next: ComposePrefill) => {
    setPrefill(next);
    setComposeOpen(true);
  }, []);

  function handleRefresh() {
    void mutate();
  }

  // ---- No accounts connected yet ----
  if (!accountsLoading && accounts.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <Toolbar
          onCompose={handleCompose}
          onRefresh={handleRefresh}
          refreshing={false}
          disabled
        />
        <EmptyState
          icon={Inbox}
          title="No accounts connected"
          description="Connect a Google or Microsoft account to start reading and sending mail from one place."
          action={
            <Button asChild>
              <Link href="/settings">Connect an account</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        onCompose={handleCompose}
        onRefresh={handleRefresh}
        refreshing={isValidating}
        disabled={accountsLoading}
      />

      {/* Account filter row */}
      <div className="shrink-0 border-b border-border px-4 pt-3">
        {accountsLoading ? (
          <div className="flex gap-2 pb-3">
            <Skeleton className="h-8 w-14 rounded-full" />
            <Skeleton className="h-8 w-32 rounded-full" />
            <Skeleton className="h-8 w-32 rounded-full" />
          </div>
        ) : (
          <AccountFilter
            accounts={accounts}
            value={filter}
            onChange={setFilter}
          />
        )}
      </div>

      {/* Two-pane (stacks on small screens) */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* List pane */}
        <section
          aria-label="Messages"
          className={cn(
            "flex min-h-0 flex-col border-border md:w-[380px] md:shrink-0 md:border-r lg:w-[420px]",
            // On mobile, hide the list when a message is open so the reader fills the screen.
            selected ? "hidden md:flex" : "flex flex-1 md:flex-none",
          )}
        >
          <MailList
            messages={messages}
            accounts={accounts}
            isLoading={isLoading || accountsLoading}
            selectedId={selected?.id ?? null}
            onSelect={handleSelect}
          />
        </section>

        {/* Reader pane */}
        <section
          aria-label="Message"
          className={cn(
            "min-h-0 min-w-0 flex-1 flex-col",
            selected ? "flex" : "hidden md:flex",
          )}
        >
          {/* Mobile back-to-list control */}
          {selected ? (
            <div className="shrink-0 border-b border-border p-2 md:hidden">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelected(null)}
              >
                ← Back to messages
              </Button>
            </div>
          ) : null}
          <div className="min-h-0 flex-1">
            <MailReader
              selected={selected}
              accounts={accounts}
              onReply={handleReply}
            />
          </div>
        </section>
      </div>

      <ComposeDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        accounts={accounts}
        defaultAccountId={filter !== ALL_ACCOUNTS ? filter : undefined}
        prefill={prefill}
        onSent={() => void mutate()}
      />
    </div>
  );
}

function Toolbar({
  onCompose,
  onRefresh,
  refreshing,
  disabled,
}: {
  onCompose: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
      <h1 className="text-base font-semibold tracking-tight">Inbox</h1>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Refresh"
          title="Refresh"
          onClick={onRefresh}
          disabled={disabled || refreshing}
        >
          <RefreshCw className={cn(refreshing && "animate-spin")} aria-hidden="true" />
        </Button>
        <Button type="button" onClick={onCompose} disabled={disabled}>
          <PenSquare aria-hidden="true" />
          <span className="hidden sm:inline">Compose</span>
        </Button>
      </div>
    </div>
  );
}
