"use client";

import useSWR from "swr";

import { fetcher } from "@/lib/fetcher";

interface ProvidersResponse {
  providers: { google: boolean; microsoft: boolean };
}

const NONE = { google: false, microsoft: false } as const;

export interface UseProvidersResult {
  providers: { google: boolean; microsoft: boolean };
  isLoading: boolean;
  error: Error | undefined;
}

/**
 * Which providers are configured (i.e. have OAuth client credentials set).
 * Used to show/hide the "Connect" buttons without ever exposing secrets.
 */
export function useProviders(): UseProvidersResult {
  const { data, error, isLoading } = useSWR<ProvidersResponse>(
    "/api/providers",
    fetcher,
  );

  return {
    providers: data?.providers ?? NONE,
    isLoading,
    error: error as Error | undefined,
  };
}
