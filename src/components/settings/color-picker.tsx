"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";

import { AccountDot } from "@/components/account-dot";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { patchJson } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import type { AccountPublic } from "@/lib/types";

/**
 * The account colour palette. Mirrored from the server's ACCOUNT_COLOR_PALETTE
 * (see @/lib/config) and intentionally hardcoded here so this client component
 * never imports the server-only config module.
 */
const PALETTE: ReadonlyArray<{ hex: string; name: string }> = [
  { hex: "#6366f1", name: "Indigo" },
  { hex: "#ec4899", name: "Pink" },
  { hex: "#10b981", name: "Emerald" },
  { hex: "#f59e0b", name: "Amber" },
  { hex: "#3b82f6", name: "Blue" },
  { hex: "#8b5cf6", name: "Violet" },
  { hex: "#ef4444", name: "Red" },
  { hex: "#14b8a6", name: "Teal" },
];

function eqColor(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export interface ColorPickerProps {
  account: AccountPublic;
  /** Re-validate/optimistically update the accounts cache after a successful PATCH. */
  onChanged: () => void | Promise<unknown>;
}

/**
 * A colour swatch popover for recolouring an account. The trigger is the
 * account's current dot; the panel shows the eight palette swatches and
 * PATCHes /api/accounts on selection.
 */
export function ColorPicker({ account, onChanged }: ColorPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState<string | null>(null);

  async function selectColor(hex: string) {
    if (eqColor(hex, account.color) || saving) {
      setOpen(false);
      return;
    }
    setSaving(hex);
    try {
      await patchJson<{ account: AccountPublic }>("/api/accounts", {
        id: account.id,
        color: hex,
      });
      await onChanged();
      setOpen(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not update the colour",
      );
    } finally {
      setSaving(null);
    }
  }

  const label = account.displayName || account.email;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Change colour for ${label}`}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full outline-none transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
        >
          <AccountDot color={account.color} size="lg" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Account colour
        </p>
        <div className="grid grid-cols-4 gap-2" role="group" aria-label="Colours">
          {PALETTE.map(({ hex, name }) => {
            const selected = eqColor(hex, account.color);
            const isSaving = saving === hex;
            return (
              <button
                key={hex}
                type="button"
                aria-label={name}
                aria-pressed={selected}
                title={name}
                disabled={saving !== null}
                onClick={() => selectColor(hex)}
                className={cn(
                  "relative flex h-9 w-9 items-center justify-center rounded-md outline-none ring-1 ring-black/5 transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover disabled:cursor-not-allowed disabled:opacity-60",
                  selected && "ring-2 ring-ring ring-offset-2 ring-offset-popover",
                )}
                style={{ backgroundColor: hex }}
              >
                {(selected || isSaving) && (
                  <Check
                    className={cn(
                      "h-4 w-4 text-white drop-shadow",
                      isSaving && "animate-pulse",
                    )}
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
