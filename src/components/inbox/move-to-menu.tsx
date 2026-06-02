"use client";

import * as React from "react";
import { Check, FolderInput, Loader2, Plus, Tag } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLabels } from "@/hooks/use-labels";
import { FetchError, postJson } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import type {
  MailLabel,
  OkResponse,
  ProviderId,
} from "@/lib/types";

/** Response envelope for POST /api/mail/labels (the created label). */
interface CreateLabelResponse {
  label: MailLabel;
}

/** "folder" for Microsoft (Outlook), "label" for Google (Gmail). */
export function labelNoun(provider: ProviderId): {
  one: string;
  create: string;
} {
  return provider === "microsoft"
    ? { one: "folder", create: "New folder" }
    : { one: "label", create: "New label" };
}

export interface CreateLabelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  provider: ProviderId;
  /** Called with the newly-created label after a successful POST. */
  onCreated: (label: MailLabel) => void | Promise<void>;
}

/**
 * A small dialog that creates a new user label (Gmail) / folder (Outlook) on an
 * account via POST /api/mail/labels, then hands the created label to `onCreated`.
 * Shared by the "Move to…" menu and the label filter's "New …" affordance.
 */
export function CreateLabelDialog({
  open,
  onOpenChange,
  accountId,
  provider,
  onCreated,
}: CreateLabelDialogProps) {
  const noun = labelNoun(provider);
  const [name, setName] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const inputId = React.useId();

  // Reset the field whenever the dialog opens.
  React.useEffect(() => {
    if (open) {
      setName("");
      setSaving(false);
    }
  }, [open]);

  const trimmed = name.trim();
  const canSave = !saving && trimmed.length > 0;

  async function handleCreate() {
    if (!canSave) return;
    setSaving(true);
    try {
      const { label } = await postJson<CreateLabelResponse>(
        "/api/mail/labels",
        { accountId, name: trimmed },
      );
      onOpenChange(false);
      await onCreated(label);
    } catch (err) {
      const message =
        err instanceof FetchError
          ? err.message
          : `Couldn't create the ${noun.one}.`;
      toast.error(message);
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="capitalize">{noun.create}</DialogTitle>
          <DialogDescription>
            Create a new {noun.one} on this account.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label htmlFor={inputId} className="capitalize">
            {noun.one} name
          </Label>
          <Input
            id={inputId}
            type="text"
            autoFocus
            autoComplete="off"
            placeholder="e.g. Receipts"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSave) {
                e.preventDefault();
                void handleCreate();
              }
            }}
            disabled={saving}
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleCreate()} disabled={!canSave}>
            {saving ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                Creating…
              </>
            ) : (
              <>
                <Plus aria-hidden="true" />
                Create
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface MoveToMenuProps {
  /** The single account the target messages belong to. */
  accountId: string;
  /** The provider, used to label the control "folder" (MS) vs "label" (Google). */
  provider: ProviderId;
  /** All message ids to move (the whole conversation, typically). */
  messageIds: string[];
  /** Optional label id of the current view, hidden/checked from the menu. */
  currentLabelId?: string | null;
  /** Called after a successful move so the caller can drop the conversation. */
  onMoved?: () => void;
  /** Disables the trigger (e.g. while the target is loading). */
  disabled?: boolean;
  /** Button size — "icon" (default) for headers, "sm" for compact rows. */
  size?: "icon" | "sm";
  className?: string;
}

/** System labels that can't be a move destination (Gmail) — kept out of the list. */
const UNMOVABLE_SYSTEM_IDS = new Set([
  "INBOX",
  "SENT",
  "DRAFT",
  "DRAFTS",
  "CHAT",
  "UNREAD",
  "STARRED",
  "IMPORTANT",
]);

function isMovable(label: MailLabel, currentLabelId?: string | null): boolean {
  if (label.id === currentLabelId) return false;
  if (label.type === "system" && UNMOVABLE_SYSTEM_IDS.has(label.id)) {
    return false;
  }
  return true;
}

/**
 * A "Move to…" control: a dropdown of the account's labels/folders. Choosing one
 * POSTs to /api/mail/move and calls `onMoved` so the caller can optimistically
 * drop the conversation from the current view. Includes a "New …" affordance that
 * opens a small dialog to create a label/folder and immediately move into it.
 *
 * Self-contained: it fetches its own labels for `accountId`, so callers in the
 * reader/list rows only need to pass the account + message ids.
 */
function MoveToMenuComponent({
  accountId,
  provider,
  messageIds,
  currentLabelId,
  onMoved,
  disabled,
  size = "icon",
  className,
}: MoveToMenuProps) {
  const [open, setOpen] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [moving, setMoving] = React.useState(false);

  // Only fetch labels once the menu is opened, to avoid a request per row.
  const [primed, setPrimed] = React.useState(false);
  const { labels, isLoading, mutate } = useLabels(primed ? accountId : null);

  const noun = labelNoun(provider);
  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";

  const movable = React.useMemo(
    () => labels.filter((l) => isMovable(l, currentLabelId)),
    [labels, currentLabelId],
  );

  const move = React.useCallback(
    async (label: Pick<MailLabel, "id" | "name">) => {
      if (messageIds.length === 0 || moving) return;
      setMoving(true);
      // Optimistically close + drop from view (mirrors archive behaviour).
      setOpen(false);
      onMoved?.();
      try {
        await postJson<OkResponse>("/api/mail/move", {
          accountId,
          messageIds,
          labelId: label.id,
        });
        toast.success(`Moved to ${label.name}`);
      } catch (err) {
        const message =
          err instanceof FetchError
            ? err.message
            : `Couldn't move this conversation.`;
        toast.error(message);
      } finally {
        setMoving(false);
      }
    },
    [accountId, messageIds, moving, onMoved],
  );

  const handleCreated = React.useCallback(
    async (label: MailLabel) => {
      // Refresh the cached label list so it reflects the new one, then move.
      void mutate();
      await move(label);
    },
    [mutate, move],
  );

  const triggerLabel = `Move to ${noun.one}`;
  const triggerSizeClass = size === "sm" ? "h-7 w-7" : "h-8 w-8";

  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          if (next) setPrimed(true);
          setOpen(next);
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={triggerLabel}
                disabled={disabled || moving || messageIds.length === 0}
                onClick={(e) => e.stopPropagation()}
                className={cn(triggerSizeClass, className)}
              >
                {moving ? (
                  <Loader2 className={cn(iconSize, "animate-spin")} aria-hidden="true" />
                ) : (
                  <FolderInput className={iconSize} aria-hidden="true" />
                )}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{triggerLabel}</TooltipContent>
        </Tooltip>

        <DropdownMenuContent
          align="end"
          className="max-h-80 w-60"
          // The trigger lives inside clickable rows/headers; keep clicks local.
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenuLabel className="capitalize">
            Move to {noun.one}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {isLoading ? (
            <div className="flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Loading…
            </div>
          ) : movable.length === 0 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">
              No {noun.one}s yet.
            </p>
          ) : (
            <div className="max-h-56 overflow-y-auto overflow-x-hidden scrollbar-thin">
              {movable.map((label) => (
                <DropdownMenuItem
                  key={label.id}
                  onSelect={() => void move(label)}
                  className="gap-2"
                >
                  <Tag
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate" title={label.name}>
                    {label.name}
                  </span>
                  {label.id === currentLabelId ? (
                    <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </div>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              // Keep the menu's selection from closing before the dialog mounts.
              e.preventDefault();
              setOpen(false);
              setCreateOpen(true);
            }}
            className="gap-2"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {noun.create}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateLabelDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        accountId={accountId}
        provider={provider}
        onCreated={handleCreated}
      />
    </>
  );
}

export const MoveToMenu = React.memo(MoveToMenuComponent);
