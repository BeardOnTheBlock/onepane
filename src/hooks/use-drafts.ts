"use client";

import useSWR from "swr";

import { ALL_ACCOUNTS } from "@/components/inbox/account-filter";
import { fetcher } from "@/lib/fetcher";
import type { DraftSummary, DraftsListResponse } from "@/lib/types";

const EMPTY: DraftSummary[] = [];

export interface UseDraftsResult {
  drafts: DraftSummary[];
  isLoading: boolean;
  error: Error | undefined;
  /** Re-run the request (and optionally write through optimistic data). */
  mutate: ReturnType<typeof useSWR<DraftsListResponse>>["mutate"];
}

const DRAFTS_LIMIT = 50;

/** SWR key for a single account's drafts, or null to skip fetching. */
function draftsKey(accountId: string | null): string | null {
  if (!accountId || accountId === ALL_ACCOUNTS) return null;
  return `/api/mail/drafts?accountId=${encodeURIComponent(
    accountId,
  )}&limit=${DRAFTS_LIMIT}`;
}

/**
 * Loads the saved (unsent) drafts for a single account. Drafts are inherently
 * per-account, so passing null or the "all accounts" sentinel skips the request
 * entirely and returns an empty list. Shared via SWR's cache so the page and the
 * compose dialog stay in sync after create/update/send/delete.
 */
export function useDrafts(accountId: string | null): UseDraftsResult {
  const { data, error, isLoading, mutate } = useSWR<DraftsListResponse>(
    draftsKey(accountId),
    fetcher,
    { revalidateOnFocus: false },
  );

  return {
    drafts: data?.drafts ?? EMPTY,
    isLoading,
    error: error as Error | undefined,
    mutate,
  };
}
