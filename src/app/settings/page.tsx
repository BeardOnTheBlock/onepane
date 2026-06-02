"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Users } from "lucide-react";
import { toast } from "sonner";

import { AccountRow } from "@/components/settings/account-row";
import { ConnectAccountCard } from "@/components/settings/connect-account-card";
import { ImapConnectCard } from "@/components/settings/imap-connect-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccounts } from "@/hooks/use-accounts";
import { useProviderCredentials } from "@/hooks/use-provider-credentials";

/**
 * Reads ?connected / ?error params once on mount, surfaces a toast, refreshes
 * the accounts cache, then strips the params from the URL. Kept separate so it
 * can sit under a Suspense boundary (required for useSearchParams in Next 15).
 */
function ConnectFlowToasts({ onConnected }: { onConnected: () => void }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const handled = React.useRef(false);

  React.useEffect(() => {
    if (handled.current) return;

    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    if (!connected && !error) return;

    handled.current = true;

    if (connected) {
      toast.success(`Connected ${connected}`);
      onConnected();
    }
    if (error) {
      toast.error(error);
    }

    // Strip the one-shot params so a refresh doesn't re-fire the toast.
    router.replace("/settings");
  }, [searchParams, router, onConnected]);

  return null;
}

function ConnectedAccountsSkeleton() {
  return (
    <div className="divide-y divide-border rounded-lg border border-border bg-card">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-6 w-6 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-8 w-24" />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card px-6 py-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Users className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="font-medium">No accounts connected yet</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Connect a Google or Microsoft account above to bring its mail and
        calendar into OnePane.
      </p>
    </div>
  );
}

function LoadErrorState({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>
        <p className="font-medium">Couldn&rsquo;t load your accounts</p>
        <p className="text-destructive/80">{message}</p>
      </div>
    </div>
  );
}

const HOSTED = process.env.NEXT_PUBLIC_ONEPANE_HOSTED === "true";

export default function SettingsPage() {
  const { accounts, isLoading, error, mutate } = useAccounts();
  const {
    statuses,
    isLoading: credsLoading,
    mutate: mutateCreds,
  } = useProviderCredentials();

  const refreshAccounts = React.useCallback(() => {
    void mutate();
  }, [mutate]);

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <React.Suspense fallback={null}>
        <ConnectFlowToasts onConnected={refreshAccounts} />
      </React.Suspense>

      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect your inboxes and calendars, and colour-code each account.
          </p>
        </header>

        {/* Connect an account */}
        <section aria-labelledby="connect-heading" className="mb-10">
          <h2
            id="connect-heading"
            className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Connect an account
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">
            {HOSTED
              ? "Connect a Google or Microsoft account to bring its mail and calendar into OnePane. Your tokens are stored encrypted and scoped to your account only."
              : "Add each provider’s OAuth Client ID & Secret (stored encrypted on this machine), then run the consent flow. Tokens are stored encrypted here only."}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ConnectAccountCard
              provider="google"
              status={statuses?.google}
              isLoading={credsLoading}
              onChanged={mutateCreds}
            />
            <ConnectAccountCard
              provider="microsoft"
              status={statuses?.microsoft}
              isLoading={credsLoading}
              onChanged={mutateCreds}
            />
            <ImapConnectCard />
          </div>
        </section>

        {/* Connected accounts */}
        <section aria-labelledby="connected-heading">
          <div className="mb-4 flex items-baseline justify-between gap-2">
            <h2
              id="connected-heading"
              className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Connected accounts
            </h2>
            {!isLoading && !error && accounts.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {accounts.length}{" "}
                {accounts.length === 1 ? "account" : "accounts"}
              </span>
            )}
          </div>

          {isLoading ? (
            <ConnectedAccountsSkeleton />
          ) : error ? (
            <LoadErrorState message={error.message} />
          ) : accounts.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {accounts.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  onChanged={refreshAccounts}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
