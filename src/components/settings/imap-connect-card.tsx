"use client";

import * as React from "react";
import { Server } from "lucide-react";

import { ImapConnectDialog } from "@/components/settings/imap-connect-dialog";
import { Button } from "@/components/ui/button";
import { useAccounts } from "@/hooks/use-accounts";

/** A neutral server mark, matching the visual weight of the OAuth ProviderMark. */
function ServerMark() {
  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
    >
      <Server className="h-5 w-5" />
    </span>
  );
}

/**
 * The "Other (IMAP / CalDAV)" connect card. Sits alongside the Google and
 * Microsoft OAuth cards. Opens a dialog to connect any mailbox with a username
 * and app password; refreshes the accounts list on success.
 */
export function ImapConnectCard() {
  const { mutate } = useAccounts();
  const [dialogOpen, setDialogOpen] = React.useState(false);

  return (
    <div className="flex h-full min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20">
      <div className="flex items-start gap-3">
        <ServerMark />
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight">Other (IMAP / CalDAV)</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Connect any mailbox with an app password — iCloud, Fastmail, and
            more.
          </p>
        </div>
      </div>

      <div className="mt-auto flex flex-col gap-2">
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => setDialogOpen(true)}
        >
          <Server className="h-4 w-4" aria-hidden="true" />
          Connect mailbox
        </Button>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Uses IMAP/SMTP (and optional CalDAV). No OAuth — just a username and an
          app-specific password.
        </p>
      </div>

      <ImapConnectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onConnected={() => void mutate()}
      />
    </div>
  );
}
