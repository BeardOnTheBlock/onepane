"use client";

import * as React from "react";
import { ExternalLink, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ProviderId } from "@/lib/types";

interface ProviderMeta {
  label: string;
  /** Short description of what connecting unlocks. */
  blurb: string;
  /** Env vars required to enable this provider (shown in the not-configured hint). */
  envVars: string[];
  /** Accent colour for the provider mark. */
  accent: string;
}

const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
  google: {
    label: "Google",
    blurb: "Gmail, Google Calendar, and Google Meet.",
    envVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    accent: "#ea4335",
  },
  microsoft: {
    label: "Microsoft",
    blurb: "Outlook mail, calendar, and Microsoft Teams.",
    envVars: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
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
  provider: ProviderId;
  /** Whether the provider has OAuth credentials configured server-side. */
  configured: boolean;
  /** Show a loading skeleton while provider config is still loading. */
  isLoading?: boolean;
}

/**
 * A card to start the OAuth consent flow for a provider. When configured the
 * primary action is a full-navigation <a> to /api/connect/{provider} (an OAuth
 * redirect, never a fetch). When not configured the button is disabled and a
 * hint points to docs/OAUTH_SETUP.md with the env vars to set.
 */
export function ConnectAccountCard({
  provider,
  configured,
  isLoading = false,
}: ConnectAccountCardProps) {
  const meta = PROVIDER_META[provider];

  return (
    <div
      className={cn(
        "flex h-full flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-colors",
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

      {isLoading ? (
        <Skeleton className="mt-auto h-9 w-full" />
      ) : configured ? (
        <Button asChild className="mt-auto w-full">
          {/* OAuth redirect — must be a real navigation, not fetch(). */}
          <a href={`/api/connect/${provider}`}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Connect {meta.label}
          </a>
        </Button>
      ) : (
        <div className="mt-auto flex flex-col gap-2">
          <Button disabled className="w-full" title="Not configured">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Connect {meta.label}
          </Button>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Set{" "}
            {meta.envVars.map((name, i) => (
              <React.Fragment key={name}>
                {i > 0 && " and "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.7rem] text-foreground">
                  {name}
                </code>
              </React.Fragment>
            ))}{" "}
            in your <code className="font-mono text-[0.7rem]">.env</code>, then
            restart. See{" "}
            <a
              href="https://github.com/BeardOnTheBlock/onepane/blob/main/docs/OAUTH_SETUP.md"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 font-medium text-primary underline-offset-2 hover:underline"
            >
              docs/OAUTH_SETUP.md
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
            .
          </p>
        </div>
      )}
    </div>
  );
}
