"use client";

import * as React from "react";
import { toast } from "sonner";
import type { KeyedMutator } from "swr";

import { postJson } from "@/lib/fetcher";
import {
  INVERSE_ACTION,
  REMOVES_FROM_INBOX,
  type MailActionType,
  type MailListResponse,
  type UnifiedMessage,
} from "@/lib/types";

/** The thing a triage action targets: a set of message ids on one account. */
export interface ActionTarget {
  accountId: string;
  /** All message ids the action should apply to. */
  messageIds: string[];
}

export interface UseMailActionsArgs {
  /** SWR mutator for the inbox list response. */
  mutate: KeyedMutator<MailListResponse>;
  /** Called after a conversation is removed from the list (trash/archive), so
   *  the caller can clear the reader selection if it was showing that target. */
  onRemoved?: (target: ActionTarget) => void;
  /** Called after a read/unread/star action, to revalidate the open thread. */
  revalidateThread?: () => void;
}

export interface UseMailActions {
  /** Apply a triage action to a target (optimistic + network + undo/revert). */
  applyAction: (target: ActionTarget, action: MailActionType) => Promise<void>;
}

const POST_URL = "/api/mail/actions";

/** True when every targeted id is absent from the list (already gone). */
function targetIdSet(target: ActionTarget): Set<string> {
  return new Set(target.messageIds);
}

/** Removes the targeted messages from a list response (immutably). */
function removeMessages(
  data: MailListResponse | undefined,
  target: ActionTarget,
): MailListResponse {
  const ids = targetIdSet(target);
  const messages = (data?.messages ?? []).filter(
    (m) => !(m.accountId === target.accountId && ids.has(m.id)),
  );
  return { messages, errors: data?.errors ?? [] };
}

/** Flips the unread flag on the targeted messages (immutably). */
function setUnread(
  data: MailListResponse | undefined,
  target: ActionTarget,
  unread: boolean,
): MailListResponse {
  const ids = targetIdSet(target);
  const messages = (data?.messages ?? []).map((m): UnifiedMessage =>
    m.accountId === target.accountId && ids.has(m.id) ? { ...m, unread } : m,
  );
  return { messages, errors: data?.errors ?? [] };
}

/**
 * Centralises inbox triage: optimistic updates, the POST to /api/mail/actions,
 * error revert, and Undo. Used by the inbox page so the list, the list rows,
 * and the reader all share one implementation.
 */
export function useMailActions({
  mutate,
  onRemoved,
  revalidateThread,
}: UseMailActionsArgs): UseMailActions {
  // Keep the latest callbacks without re-creating applyAction each render.
  const onRemovedRef = React.useRef(onRemoved);
  const revalidateThreadRef = React.useRef(revalidateThread);
  React.useEffect(() => {
    onRemovedRef.current = onRemoved;
    revalidateThreadRef.current = revalidateThread;
  });

  const post = React.useCallback(
    (target: ActionTarget, action: MailActionType) =>
      postJson(POST_URL, {
        accountId: target.accountId,
        messageIds: target.messageIds,
        action,
      }),
    [],
  );

  const applyAction = React.useCallback(
    async (target: ActionTarget, action: MailActionType): Promise<void> => {
      if (target.messageIds.length === 0) return;

      // ---- Removal actions: trash / archive ----
      if (REMOVES_FROM_INBOX.has(action)) {
        // Optimistically drop the conversation from the list and clear the
        // reader selection if it was showing this target.
        await mutate((data) => removeMessages(data, target), {
          revalidate: false,
        });
        onRemovedRef.current?.(target);

        try {
          await post(target, action);
        } catch (err) {
          // Revert: pull the list back from the server.
          void mutate();
          toast.error(
            err instanceof Error
              ? err.message
              : `Couldn't ${action} this conversation.`,
          );
          return;
        }

        // Success — revalidate, and offer Undo for trash (archive has no
        // single-call inverse, per the shared contract).
        void mutate();
        const inverse = INVERSE_ACTION[action];
        if (action === "trash" && inverse) {
          toast.success("Moved to Trash", {
            action: {
              label: "Undo",
              onClick: () => {
                void (async () => {
                  try {
                    await post(target, inverse);
                  } catch (e) {
                    toast.error(
                      e instanceof Error ? e.message : "Couldn't undo.",
                    );
                  } finally {
                    void mutate();
                  }
                })();
              },
            },
          });
        } else {
          toast.success("Archived");
        }
        return;
      }

      // ---- Read/unread toggles ----
      if (action === "markRead" || action === "markUnread") {
        const unread = action === "markUnread";
        await mutate((data) => setUnread(data, target, unread), {
          revalidate: false,
        });
        try {
          await post(target, action);
        } catch (err) {
          void mutate();
          toast.error(
            err instanceof Error
              ? err.message
              : "Couldn't update the read state.",
          );
          return;
        }
        void mutate();
        revalidateThreadRef.current?.();
        return;
      }

      // ---- Star toggles ----
      // UnifiedMessage carries no starred flag, so optimistic UI for the star
      // is owned by the components; here we just POST and revert on failure.
      if (action === "star" || action === "unstar") {
        try {
          await post(target, action);
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : "Couldn't update the star.",
          );
          // Signal callers to re-sync their local star state.
          throw err;
        }
        revalidateThreadRef.current?.();
        return;
      }

      // ---- Fallback (untrash and any future action): POST + revalidate ----
      try {
        await post(target, action);
      } catch (err) {
        void mutate();
        toast.error(
          err instanceof Error ? err.message : "Couldn't apply that action.",
        );
        return;
      }
      void mutate();
    },
    [mutate, post],
  );

  return { applyAction };
}
