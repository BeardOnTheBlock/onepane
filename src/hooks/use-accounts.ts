"use client";

import useSWR from "swr";

import { fetcher } from "@/lib/fetcher";
import type { AccountPublic, AccountsResponse } from "@/lib/types";

const EMPTY: AccountPublic[] = [];

export interface UseAccountsResult {
  accounts: AccountPublic[];
  isLoading: boolean;
  error: Error | undefined;
  /** Re-run the request (and optionally write through optimistic data). */
  mutate: ReturnType<typeof useSWR<AccountsResponse>>["mutate"];
}

/**
 * Loads the connected accounts. Shared across the whole app via SWR's cache,
 * so the sidebar, settings page, and every selector stay in sync.
 */
export function useAccounts(): UseAccountsResult {
  const { data, error, isLoading, mutate } = useSWR<AccountsResponse>(
    "/api/accounts",
    fetcher,
  );

  return {
    accounts: data?.accounts ?? EMPTY,
    isLoading,
    error: error as Error | undefined,
    mutate,
  };
}

/** Find a single account by id, or undefined. */
export function accountById(
  accounts: AccountPublic[],
  id: string | null | undefined,
): AccountPublic | undefined {
  if (!id) return undefined;
  return accounts.find((a) => a.id === id);
}

/**
 * The colour for a given account id, falling back to the muted border colour
 * (used for "all accounts" / unknown ids so callers never render a bad value).
 */
export function colorFor(
  accounts: AccountPublic[],
  id: string | null | undefined,
): string {
  return accountById(accounts, id)?.color ?? "hsl(var(--muted-foreground))";
}
