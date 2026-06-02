"use client";

import * as React from "react";
import { KeyRound, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { CredentialForm } from "@/components/settings/credential-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { FetchError, del } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import type { OkResponse, OAuthProviderId } from "@/lib/types";
import type { ProviderCredentialStatus } from "@/hooks/use-provider-credentials";

interface ProviderMeta {
  label: string;
  blurb: string;
  accent: string;
}

const PROVIDER_META: Record<OAuthProviderId, ProviderMeta> = {
  google: {
    label: "Google",
    blurb: "Gmail, Google Calendar, and Google Meet.",
    accent: "#ea4335",
  },
  microsoft: {
    label: "Microsoft",
    blurb: "Outlook mail, calendar, and Microsoft Teams.",
    accent: "#0078d4",
  },
};

/** A four-square mark evoking the Google / Microsoft brand tiles. */
function ProviderMark({ accent }: { accent: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid h-10 w-10 shrink-0 grid-cols-2 grid-rows-2 gap-0.5 rounded-md p-1.5"
      style={{ backgroundColor: `${accent}14` }}
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <span
          key={i}
          className="rounded-[2px]"
          style={{ backgroundColor: accent, opacity: 0.65 + i * 0.1 }}
        />
      ))}
    </span>
  );
}

export interface ConnectAccountCardProps {
  provider: OAuthProviderId;
  /** Credential status for this provider (from useProviderCredentials). */
  status: ProviderCredentialStatus | undefined;
  isLoading?: boolean;
  /** Called after credentials change so the parent can revalidate. */
  onChanged: () => void;
}

/**
 * A card that walks the user from "no OAuth credentials" → entering them (stored
 * encrypted in the local DB) → a working "Connect {Provider}" OAuth button.
 */
export function ConnectAccountCard({
  provider,
  status,
  isLoading = false,
  onChanged,
}: ConnectAccountCardProps) {
  const meta = PROVIDER_META[provider];
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);

  // Hosted mode: the operator configures a single central OAuth client via env
  // vars, so users never enter their own Client ID/Secret. We hide the whole
  // credential-entry path and always present a plain "Connect {Provider}"
  // button (the consent flow uses the central client).
  const hosted = process.env.NEXT_PUBLIC_ONEPANE_HOSTED === "true";

  const configured = hosted || Boolean(status?.configured);

  async function handleRemove() {
    setRemoving(true);
    try {
      await del<OkResponse>(
        `/api/providers/credentials?provider=${encodeURIComponent(provider)}`,
      );
      toast.success(`${meta.label} credentials removed`);
      onChanged();
    } catch (err) {
      toast.error(
        err instanceof FetchError ? err.message : "Couldn't remove credentials.",
      );
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div
      className={cn(
        // min-w-0 keeps the card from growing past its grid track so the
        // credential form (long redirect URI, inputs) stays contained.
        "flex h-full min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-colors",
        configured && "hover:border-foreground/20",
      )}
    >
      <div className="flex items-start gap-3">
        <ProviderMark accent={meta.accent} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight">{meta.label}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{meta.blurb}</p>
        </div>
      </div>

      {hosted ? (
        // Hosted: just the Connect button — central client, no credential entry.
        <div className="mt-auto flex flex-col gap-2">
          {/* OAuth redirect — must be a real navigation, not fetch(). */}
          <Button asChild className="w-full">
            <a href={`/api/connect/${provider}`}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Connect {meta.label}
            </a>
          </Button>
        </div>
      ) : isLoading || !status ? (
        <Skeleton className="mt-auto h-9 w-full" />
      ) : configured ? (
        <div className="mt-auto flex flex-col gap-2">
          {/* OAuth redirect — must be a real navigation, not fetch(). */}
          <Button asChild className="w-full">
            <a href={`/api/connect/${provider}`}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Connect {meta.label}
            </a>
          </Button>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {status.source === "env" ? (
                <span>Configured via environment</span>
              ) : (
                <span className="truncate" title={status.clientIdHint ?? undefined}>
                  Credentials saved{status.clientIdHint ? ` · ${status.clientIdHint}` : ""}
                </span>
              )}
            </span>
            {status.editable ? (
              <span className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => setDialogOpen(true)}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="sr-only">Edit credentials</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-destructive hover:text-destructive"
                  onClick={handleRemove}
                  disabled={removing}
                >
                  {removing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  <span className="sr-only">Remove credentials</span>
                </Button>
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-auto flex flex-col gap-2">
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={() => setDialogOpen(true)}
          >
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            Set up {meta.label}
          </Button>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Add your {meta.label} OAuth Client ID &amp; Secret to enable
            connecting — stored encrypted on this machine, never in a file.
          </p>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Set up {meta.label}</DialogTitle>
            <DialogDescription>
              Add your {meta.label} OAuth Client ID &amp; Secret. They&rsquo;re
              stored encrypted in this machine&rsquo;s local database.
            </DialogDescription>
          </DialogHeader>
          {status ? (
            <CredentialForm
              provider={provider}
              label={meta.label}
              redirectUri={status.redirectUri}
              replacing={configured}
              onSaved={() => {
                setDialogOpen(false);
                onChanged();
              }}
              onCancel={() => setDialogOpen(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
