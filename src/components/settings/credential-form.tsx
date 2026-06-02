"use client";

import * as React from "react";
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FetchError, postJson } from "@/lib/fetcher";
import type { OkResponse, ProviderId } from "@/lib/types";

const DOCS_URL =
  "https://github.com/BeardOnTheBlock/onepane/blob/main/docs/OAUTH_SETUP.md";

export interface CredentialFormProps {
  provider: ProviderId;
  label: string;
  /** The redirect URI the user must register with the provider. */
  redirectUri: string;
  /** Whether existing credentials are being replaced (affects copy). */
  replacing?: boolean;
  onSaved: () => void;
  onCancel: () => void;
}

/**
 * The body of the "set up provider" dialog: enter a provider's OAuth Client ID +
 * Secret. POSTed to /api/providers/credentials, which stores them encrypted in
 * the local database — they never touch a .env file or the repository.
 */
export function CredentialForm({
  provider,
  label,
  redirectUri,
  replacing = false,
  onSaved,
  onCancel,
}: CredentialFormProps) {
  const [clientId, setClientId] = React.useState("");
  const [clientSecret, setClientSecret] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const canSave =
    !saving && clientId.trim().length > 0 && clientSecret.trim().length > 0;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      await postJson<OkResponse>("/api/providers/credentials", {
        provider,
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      });
      toast.success(`${label} credentials saved`);
      onSaved();
    } catch (err) {
      toast.error(
        err instanceof FetchError ? err.message : "Couldn't save credentials.",
      );
      setSaving(false);
    }
  }

  async function copyRedirect() {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy to clipboard.");
    }
  }

  return (
    <div className="grid min-w-0 gap-4">
      <ol className="list-inside list-decimal space-y-1 text-sm text-muted-foreground">
        <li>
          Create an OAuth client in the {label} developer console.{" "}
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 font-medium text-primary underline-offset-2 hover:underline"
          >
            Step-by-step
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </li>
        <li>Register this exact redirect URI:</li>
      </ol>

      {/* Redirect URI to register */}
      <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5">
        <code
          className="min-w-0 flex-1 truncate font-mono text-xs"
          title={redirectUri}
        >
          {redirectUri}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 px-2"
          onClick={copyRedirect}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          <span className="sr-only">Copy redirect URI</span>
        </Button>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${provider}-client-id`}>Client ID</Label>
        <Input
          id={`${provider}-client-id`}
          autoComplete="off"
          spellCheck={false}
          placeholder={replacing ? "Enter the new Client ID" : "Paste your Client ID"}
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${provider}-client-secret`}>Client Secret</Label>
        <Input
          id={`${provider}-client-secret`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={
            replacing ? "Enter the new Client Secret" : "Paste your Client Secret"
          }
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Stored encrypted in this machine&rsquo;s local database — never written to
        a file or sent anywhere except {label}.
      </p>

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button type="button" onClick={handleSave} disabled={!canSave}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Saving…
            </>
          ) : (
            "Save credentials"
          )}
        </Button>
      </div>
    </div>
  );
}
