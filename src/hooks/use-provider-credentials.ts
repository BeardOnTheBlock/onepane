"use client";

import useSWR from "swr";

import { fetcher } from "@/lib/fetcher";
import type { OAuthProviderId } from "@/lib/types";

/** Mirror of the server's ProviderCredentialStatus (never includes the secret). */
export interface ProviderCredentialStatus {
  configured: boolean;
  source: "db" | "env" | null;
  /** Masked Client ID hint when stored in the DB; null otherwise. */
  clientIdHint: string | null;
  /** The exact redirect URI to register with the provider. */
  redirectUri: string;
  /** Whether the credentials can be edited/removed in the UI (DB-backed). */
  editable: boolean;
}

interface CredentialsResponse {
  providers: Record<OAuthProviderId, ProviderCredentialStatus>;
}

export interface UseProviderCredentialsResult {
  statuses: Record<OAuthProviderId, ProviderCredentialStatus> | undefined;
  isLoading: boolean;
  error: Error | undefined;
  mutate: () => void;
}

/**
 * Per-provider OAuth client-credential status for the Settings UI: whether
 * credentials are configured, where they came from (local DB vs environment),
 * a masked Client ID hint, and the redirect URI to register. Never exposes secrets.
 */
export function useProviderCredentials(): UseProviderCredentialsResult {
  const { data, error, isLoading, mutate } = useSWR<CredentialsResponse>(
    "/api/providers/credentials",
    fetcher,
    { revalidateOnFocus: false },
  );

  return {
    statuses: data?.providers,
    isLoading,
    error: error as Error | undefined,
    mutate: () => {
      void mutate();
    },
  };
}
