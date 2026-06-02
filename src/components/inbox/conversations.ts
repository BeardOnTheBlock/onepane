// UI-only conversation grouping for the inbox list. Groups the flat list of
// messages returned by /api/mail into conversations keyed by account + thread,
// computing the per-conversation aggregates the list rows need. This type is
// intentionally NOT part of the shared contracts in @/lib/types — it only ever
// lives in the inbox UI.

import type { UnifiedMessage } from "@/lib/types";

export interface Conversation {
  /** Stable key: `${accountId}:${threadId ?? id}`. */
  key: string;
  accountId: string;
  /** The provider thread id, or null when the message has no thread. */
  threadId: string | null;
  /** The latest (max-date) message in the conversation. */
  latest: UnifiedMessage;
  /** Number of messages in the conversation. */
  count: number;
  /** True if any message in the conversation is unread. */
  unread: boolean;
  /** True if any message in the conversation reports attachments. */
  hasAttachments: boolean;
  /** All fetched member message ids of the thread, so triage actions can
   *  target the whole conversation in one call. */
  messageIds: string[];
}

function timeOf(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Groups messages into conversations keyed by `${accountId}:${threadId ?? id}`,
 * then sorts the conversations by their latest message date, newest first.
 */
export function groupConversations(
  messages: UnifiedMessage[],
): Conversation[] {
  const byKey = new Map<string, Conversation>();

  for (const message of messages) {
    const key = `${message.accountId}:${message.threadId ?? message.id}`;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, {
        key,
        accountId: message.accountId,
        threadId: message.threadId,
        latest: message,
        count: 1,
        unread: message.unread,
        hasAttachments: message.hasAttachments,
        messageIds: [message.id],
      });
      continue;
    }

    existing.count += 1;
    existing.unread = existing.unread || message.unread;
    existing.hasAttachments = existing.hasAttachments || message.hasAttachments;
    existing.messageIds.push(message.id);
    if (timeOf(message.date) > timeOf(existing.latest.date)) {
      existing.latest = message;
    }
  }

  return Array.from(byKey.values()).sort(
    (a, b) => timeOf(b.latest.date) - timeOf(a.latest.date),
  );
}
