"use client";

import * as React from "react";
import { Download, File as FileIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AttachmentMeta } from "@/lib/types";

/** Human-readable byte size, e.g. "12.4 KB", "1.2 MB". Returns "" for 0/unknown. */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // One decimal place, but drop a trailing ".0".
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

/** Builds the download URL for a single attachment on a given message. */
function attachmentUrl(
  accountId: string,
  messageId: string,
  attachmentId: string,
): string {
  return `/api/mail/attachment?accountId=${encodeURIComponent(
    accountId,
  )}&messageId=${encodeURIComponent(messageId)}&attachmentId=${encodeURIComponent(
    attachmentId,
  )}`;
}

export interface AttachmentListProps {
  accountId: string;
  messageId: string;
  attachments: AttachmentMeta[];
  className?: string;
}

/**
 * Lists a message's downloadable (non-inline) attachments. Each row is a file
 * icon, a truncated filename, its size, and a download control implemented as a
 * real anchor (with the `download` attribute) so the browser saves the file.
 */
export function AttachmentList({
  accountId,
  messageId,
  attachments,
  className,
}: AttachmentListProps) {
  const files = attachments.filter((a) => !a.inline);
  if (files.length === 0) return null;

  return (
    <section
      aria-label="Attachments"
      className={cn("border-t border-border", className)}
    >
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        {files.length === 1 ? "1 attachment" : `${files.length} attachments`}
      </p>
      <ul className="flex flex-col gap-1.5">
        {files.map((att) => {
          const size = formatBytes(att.size);
          return (
            <li key={att.id}>
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 py-1.5 pl-2.5 pr-1.5">
                <FileIcon
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span
                    className="min-w-0 truncate text-sm text-foreground"
                    title={att.filename}
                  >
                    {att.filename}
                  </span>
                  {size ? (
                    <span className="text-xs text-muted-foreground">{size}</span>
                  ) : null}
                </div>
                <Button
                  asChild
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                >
                  <a
                    href={attachmentUrl(accountId, messageId, att.id)}
                    download={att.filename}
                    aria-label={`Download ${att.filename}`}
                    title={`Download ${att.filename}`}
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                  </a>
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
