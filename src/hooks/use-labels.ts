"use client";

import useSWR from "swr";

import { ALL_ACCOUNTS } from "@/components/inbox/account-filter";
import { fetcher } from "@/lib/fetcher";
import type { MailLabel, MailLabelsResponse } from "@/lib/types";

const EMPTY: MailLabel[] = [];

export interface UseLabelsResult {
  labels: MailLabel[];
  isLoading: boolean;
  error: Error | undefined;
  /** Re-run the request (and optionally write through optimistic data). */
  mutate: ReturnType<typeof useSWR<MailLabelsResponse>>["mutate"];
}

/** SWR key for a single account's labels, or null to skip fetching. */
function labelsKey(accountId: string | null): string | null {
  if (!accountId || accountId === ALL_ACCOUNTS) return null;
  return `/api/mail/labels?accountId=${encodeURIComponent(accountId)}`;
}

/**
 * Loads the labels (Gmail) / folders (Outlook) for a single account. Labels are
 * inherently per-account, so passing null or the "all accounts" sentinel skips
 * the request entirely and returns an empty list. Shared via SWR's cache so the
 * label filter and the "Move to…" menu stay in sync without double-fetching.
 */
export function useLabels(accountId: string | null): UseLabelsResult {
  const { data, error, isLoading, mutate } = useSWR<MailLabelsResponse>(
    labelsKey(accountId),
    fetcher,
    { revalidateOnFocus: false },
  );

  return {
    labels: data?.labels ?? EMPTY,
    isLoading,
    error: error as Error | undefined,
    mutate,
  };
}
