"use client";

import * as React from "react";
import { format, parseISO } from "date-fns";
import { Trash2, Video } from "lucide-react";
import { toast } from "sonner";

import { ColorPicker } from "@/components/settings/color-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { del } from "@/lib/fetcher";
import type { AccountPublic } from "@/lib/types";

const PROVIDER_LABEL: Record<AccountPublic["provider"], string> = {
  google: "Google",
  microsoft: "Microsoft",
  imap: "IMAP",
};

/** Safely formats an ISO timestamp, tolerating bad input. */
function formatConnected(iso: string): string | null {
  try {
    return format(parseISO(iso), "d MMM yyyy");
  } catch {
    return null;
  }
}

export interface AccountRowProps {
  account: AccountPublic;
  /** Re-validate the accounts cache after a colour change or disconnect. */
  onChanged: () => void | Promise<unknown>;
}

/**
 * A single connected account: colour dot (opens the recolour popover),
 * identity, provider + capability badges, connected date, and a Disconnect
 * action confirmed through a dialog.
 */
export function AccountRow({ account, onChanged }: AccountRowProps) {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);

  const connected = formatConnected(account.createdAt);
  const name = account.displayName?.trim();

  async function disconnect() {
    setRemoving(true);
    try {
      await del(`/api/accounts?id=${encodeURIComponent(account.id)}`);
      await onChanged();
      toast.success(`Disconnected ${account.email}`);
      setConfirmOpen(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not disconnect the account",
      );
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <ColorPicker account={account} onChanged={onChanged} />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium" title={name || account.email}>
            {name || account.email}
          </span>
          <Badge variant="secondary" className="shrink-0 font-normal">
            {PROVIDER_LABEL[account.provider]}
          </Badge>
          {account.canMeet && (
            <Badge variant="outline" className="shrink-0 gap-1 font-normal">
              <Video className="h-3 w-3" aria-hidden="true" />
              Meet
            </Badge>
          )}
          {account.canTeams && (
            <Badge variant="outline" className="shrink-0 gap-1 font-normal">
              <Video className="h-3 w-3" aria-hidden="true" />
              Teams
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          {name && (
            <span className="truncate" title={account.email}>
              {account.email}
            </span>
          )}
          {name && connected && <span aria-hidden="true">&middot;</span>}
          {connected && (
            <span className="shrink-0">Connected {connected}</span>
          )}
        </div>
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => setConfirmOpen(true)}
        className="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Disconnect</span>
      </Button>

      <Dialog open={confirmOpen} onOpenChange={(o) => !removing && setConfirmOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Disconnect account?</DialogTitle>
            <DialogDescription>
              OnePane will remove{" "}
              <span className="font-medium text-foreground">
                {account.email}
              </span>{" "}
              and delete its stored tokens from this machine. Your mail and
              calendar data at {PROVIDER_LABEL[account.provider]} are not
              affected. You can reconnect at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={removing}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={disconnect}
              disabled={removing}
            >
              {removing ? "Disconnecting…" : "Disconnect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
