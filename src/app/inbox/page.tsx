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
import {
  groupConversations,
  type Conversation,
} from "@/components/inbox/conversations";
import { DraftsList } from "@/components/inbox/drafts-list";
import { LabelFilter } from "@/components/inbox/label-filter";
import { MailList } from "@/components/inbox/mail-list";
import { MailReader, type ReaderSelection } from "@/components/inbox/mail-reader";
import { SearchInput } from "@/components/inbox/search-input";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { accountById, useAccounts } from "@/hooks/use-accounts";
import { useDrafts } from "@/hooks/use-drafts";
import { useLabels } from "@/hooks/use-labels";
import {
  useMailActions,
  type ActionTarget,
} from "@/hooks/use-mail-actions";
import { del, FetchError } from "@/lib/fetcher";
import { fetcher } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import type {
  AccountError,
  DraftSummary,
  MailLabel,
  MailListResponse,
  OkResponse,
  UnifiedMessage,
} from "@/lib/types";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 350;

/**
 * Stable key for the message list given the account filter, search term, and
 * (single-account only) the selected label/folder. `labelId` is ignored for
 * "all accounts" since labels are inherently per-account.
 */
function mailKey(
  accountId: string,
  query: string,
  labelId: string | null,
): string {
  const base = `/api/mail?accountId=${encodeURIComponent(
    accountId,
  )}&limit=${PAGE_SIZE}`;
  const q = query.trim();
  let key = q ? `${base}&q=${encodeURIComponent(q)}` : base;
  if (accountId !== ALL_ACCOUNTS && labelId) {
    key += `&labelId=${encodeURIComponent(labelId)}`;
  }
  return key;
}

/**
 * True when the given selection points at the account's Drafts view: Gmail's
 * `DRAFT` system label, or any folder/label whose name is "Drafts" (Outlook's
 * folder id is opaque, so we fall back to a case-insensitive name match).
 */
function isDraftsSelection(
  labelId: string | null,
  labels: MailLabel[],
): boolean {
  if (!labelId) return false;
  if (labelId === "DRAFT") return true;
  const label = labels.find((l) => l.id === labelId);
  return label?.name.trim().toLowerCase() === "drafts";
}

export default function InboxPage() {
  const { accounts, isLoading: accountsLoading } = useAccounts();

  const [filter, setFilter] = React.useState<string>(ALL_ACCOUNTS);
  const [labelId, setLabelId] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const [selected, setSelected] = React.useState<ReaderSelection | null>(null);

  // The single account being viewed, if any (labels are per-account).
  const singleAccount =
    filter === ALL_ACCOUNTS ? undefined : accountById(accounts, filter);

  // Labels of the single account: used to detect the Drafts view (folder ids
  // are opaque on Outlook, so we match the selected label by name there).
  const { labels } = useLabels(singleAccount?.id ?? null);
  const draftsView = Boolean(
    singleAccount && isDraftsSelection(labelId, labels),
  );

  // Changing the account filter clears any label selection: labels belong to a
  // specific account, and "all accounts" has no label view at all.
  const handleFilterChange = React.useCallback((next: string) => {
    setFilter(next);
    setLabelId(null);
  }, []);

  const [composeOpen, setComposeOpen] = React.useState(false);
  const [prefill, setPrefill] = React.useState<ComposePrefill | undefined>();
  // When set, the compose dialog opens in draft-edit mode for this draft.
  const [editDraft, setEditDraft] = React.useState<{
    id: string;
    accountId: string;
  } | null>(null);

  // Drafts for the single account (only when the Drafts view is active).
  const { drafts, isLoading: draftsLoading, mutate: mutateDrafts } = useDrafts(
    draftsView && singleAccount ? singleAccount.id : null,
  );

  // Ids currently being deleted from the drafts list (for per-row spinners).
  const [deletingDraftIds, setDeletingDraftIds] = React.useState<Set<string>>(
    () => new Set(),
  );

  // Debounce the search term into the SWR key.
  React.useEffect(() => {
    const id = window.setTimeout(
      () => setDebouncedQuery(query),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(id);
  }, [query]);

  const { data, error, isLoading, isValidating, mutate } =
    useSWR<MailListResponse>(
      accounts.length > 0
        ? mailKey(filter, debouncedQuery, labelId)
        : null,
      fetcher,
      { revalidateOnFocus: false },
    );

  const messages: UnifiedMessage[] = React.useMemo(
    () => data?.messages ?? [],
    [data?.messages],
  );

  const conversations: Conversation[] = React.useMemo(
    () => groupConversations(messages),
    [messages],
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

  // Drop the selection if its conversation is no longer in the list.
  React.useEffect(() => {
    if (!selected) return;
    const stillPresent = conversations.some(
      (c) =>
        c.accountId === selected.accountId &&
        (c.threadId ?? c.latest.id) === (selected.threadId ?? selected.messageId),
    );
    if (!stillPresent && !isLoading && !isValidating) {
      setSelected(null);
    }
  }, [conversations, selected, isLoading, isValidating]);

  const selectedKey = selected
    ? `${selected.accountId}:${selected.threadId ?? selected.messageId}`
    : null;

  // Clear the reader selection when its conversation gets trashed/archived.
  const handleRemoved = React.useCallback((target: ActionTarget) => {
    setSelected((prev) => {
      if (!prev || prev.accountId !== target.accountId) return prev;
      const ids = new Set(target.messageIds);
      return ids.has(prev.messageId) ? null : prev;
    });
  }, []);

  const { applyAction } = useMailActions({
    mutate,
    onRemoved: handleRemoved,
  });

  // After a successful "Move to…", optimistically drop the conversation from the
  // current view (it has left this label/inbox), and clear the reader selection
  // if it was showing it. The move-to menu owns the network call + toast.
  const handleMoved = React.useCallback(
    (target: ActionTarget) => {
      const ids = new Set(target.messageIds);
      void mutate(
        (current) => ({
          messages: (current?.messages ?? []).filter(
            (m) => !(m.accountId === target.accountId && ids.has(m.id)),
          ),
          errors: current?.errors ?? [],
        }),
        { revalidate: false },
      );
      handleRemoved(target);
    },
    [mutate, handleRemoved],
  );

  const handleSelect = React.useCallback((conversation: Conversation) => {
    setSelected({
      accountId: conversation.accountId,
      threadId: conversation.threadId,
      messageId: conversation.latest.id,
    });
  }, []);

  const handleCompose = React.useCallback(() => {
    setPrefill(undefined);
    setEditDraft(null);
    setComposeOpen(true);
  }, []);

  const handleReply = React.useCallback((next: ComposePrefill) => {
    setPrefill(next);
    setEditDraft(null);
    setComposeOpen(true);
  }, []);

  // Open a saved draft in the compose dialog's draft-edit mode.
  const handleEditDraft = React.useCallback((draft: DraftSummary) => {
    setPrefill(undefined);
    setEditDraft({ id: draft.id, accountId: draft.accountId });
    setComposeOpen(true);
  }, []);

  // Quick row delete from the drafts list (optimistic, with spinner + revert).
  const handleDeleteDraft = React.useCallback(
    async (draft: DraftSummary) => {
      setDeletingDraftIds((prev) => {
        const next = new Set(prev);
        next.add(draft.id);
        return next;
      });
      // Optimistically drop the row; revalidate (or restore) when the call lands.
      void mutateDrafts(
        (current) => ({
          drafts: (current?.drafts ?? []).filter((d) => d.id !== draft.id),
        }),
        { revalidate: false },
      );
      try {
        await del<OkResponse>("/api/mail/drafts", {
          accountId: draft.accountId,
          draftId: draft.id,
        });
        toast.success("Draft deleted");
        void mutateDrafts();
      } catch (err) {
        toast.error(
          err instanceof FetchError
            ? err.message
            : "Couldn't delete the draft. Please try again.",
        );
        // Restore the list (the optimistic removal was wrong).
        void mutateDrafts();
      } finally {
        setDeletingDraftIds((prev) => {
          const next = new Set(prev);
          next.delete(draft.id);
          return next;
        });
      }
    },
    [mutateDrafts],
  );

  // Revalidate the drafts list after the dialog creates/updates/sends/deletes.
  const handleDraftsChanged = React.useCallback(() => {
    void mutateDrafts();
  }, [mutateDrafts]);

  function handleRefresh() {
    if (draftsView) {
      void mutateDrafts();
      return;
    }
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

      {/* Search + account filter row */}
      <div className="shrink-0 space-y-3 border-b border-border px-4 pb-1 pt-3">
        <SearchInput
          value={query}
          onChange={setQuery}
          disabled={accountsLoading || draftsView}
        />
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
            onChange={handleFilterChange}
          />
        )}

        {/* Label/folder filter — only for a single account (labels are
            per-account). Renders as a natural second row under the accounts. */}
        {!accountsLoading && singleAccount ? (
          <LabelFilter
            accountId={singleAccount.id}
            provider={singleAccount.provider}
            value={labelId}
            onChange={setLabelId}
          />
        ) : null}
      </div>

      {/* Drafts view: a single full-width list (clicking opens the editor,
          there's no reader pane). Otherwise the normal two-pane layout. */}
      {draftsView && singleAccount ? (
        <section aria-label="Drafts" className="flex min-h-0 flex-1 flex-col">
          <DraftsList
            drafts={drafts}
            accounts={accounts}
            isLoading={draftsLoading || accountsLoading}
            selectedId={editDraft && composeOpen ? editDraft.id : null}
            onSelect={handleEditDraft}
            onDelete={(draft) => void handleDeleteDraft(draft)}
            deletingIds={deletingDraftIds}
          />
        </section>
      ) : (
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
              conversations={conversations}
              accounts={accounts}
              isLoading={isLoading || accountsLoading}
              selectedKey={selectedKey}
              query={debouncedQuery}
              currentLabelId={singleAccount ? labelId : null}
              onSelect={handleSelect}
              onAction={applyAction}
              onMoved={handleMoved}
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
                onAction={applyAction}
              />
            </div>
          </section>
        </div>
      )}

      <ComposeDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        accounts={accounts}
        defaultAccountId={filter !== ALL_ACCOUNTS ? filter : undefined}
        prefill={prefill}
        editDraftId={editDraft?.id}
        editDraftAccountId={editDraft?.accountId}
        onSent={() => void mutate()}
        onDraftsChanged={handleDraftsChanged}
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
