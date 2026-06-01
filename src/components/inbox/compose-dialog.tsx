"use client";

import * as React from "react";
import { Loader2, Paperclip, Send, X } from "lucide-react";
import { toast } from "sonner";

import { AccountDot } from "@/components/account-dot";
import { formatBytes } from "@/components/inbox/attachment-list";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { accountById } from "@/hooks/use-accounts";
import { FetchError, postJson } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import type {
  AccountPublic,
  MailAddress,
  MailDraft,
  OkResponse,
  OutgoingAttachment,
  ReplyContext,
} from "@/lib/types";

/** Total attachment size cap (sum of raw file bytes) for a single message. */
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** A picked attachment held in compose state (base64 + size for the cap/chips). */
interface PendingAttachment extends OutgoingAttachment {
  /** Raw file size in bytes, used for the chip label and the total-size cap. */
  size: number;
}

/** Reads a File as standard base64 (strips the "data:...;base64," prefix). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

/** A pre-fill payload supplied when composing a reply. */
export interface ComposePrefill {
  /** Account the reply must be sent from (locked in the UI). */
  accountId: string;
  to: MailAddress[];
  subject: string;
  reply: ReplyContext;
}

export interface ComposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: AccountPublic[];
  /** Account pre-selected for a fresh compose (ignored when `prefill` is set). */
  defaultAccountId?: string;
  /** When present, the dialog is a reply: recipients/subject filled, From locked. */
  prefill?: ComposePrefill;
  /** Called after a successful send (e.g. to revalidate the list). */
  onSent?: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Parse a free-text recipient string ("a@b.com, c@d.com d@e.com") to addresses. */
function parseRecipients(raw: string): MailAddress[] {
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((email) => ({ email }));
}

function formatRecipients(addresses: MailAddress[]): string {
  return addresses.map((a) => a.email).join(", ");
}

export function ComposeDialog({
  open,
  onOpenChange,
  accounts,
  defaultAccountId,
  prefill,
  onSent,
}: ComposeDialogProps) {
  const isReply = Boolean(prefill);

  const [accountId, setAccountId] = React.useState("");
  const [to, setTo] = React.useState("");
  const [cc, setCc] = React.useState("");
  const [showCc, setShowCc] = React.useState(false);
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [attachments, setAttachments] = React.useState<PendingAttachment[]>([]);
  const [sending, setSending] = React.useState(false);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Initialise (or reset) the form whenever the dialog opens.
  React.useEffect(() => {
    if (!open) return;
    if (prefill) {
      setAccountId(prefill.accountId);
      setTo(formatRecipients(prefill.to));
      setSubject(prefill.subject);
    } else {
      setAccountId(defaultAccountId ?? accounts[0]?.id ?? "");
      setTo("");
      setSubject("");
    }
    setCc("");
    setShowCc(false);
    setBody("");
    setAttachments([]);
    setSending(false);
    // We intentionally only re-run when the dialog transitions open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const totalAttachmentBytes = React.useMemo(
    () => attachments.reduce((sum, a) => sum + a.size, 0),
    [attachments],
  );

  async function handleFilesChosen(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const chosen = Array.from(fileList);

    // Accumulate against the current total so multiple picks stay under the cap.
    let runningTotal = totalAttachmentBytes;
    const accepted: PendingAttachment[] = [];

    for (const file of chosen) {
      if (runningTotal + file.size > MAX_TOTAL_ATTACHMENT_BYTES) {
        toast.error(
          `"${file.name}" exceeds the ${formatBytes(
            MAX_TOTAL_ATTACHMENT_BYTES,
          )} attachment limit.`,
        );
        continue;
      }
      try {
        const contentBase64 = await fileToBase64(file);
        accepted.push({
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          contentBase64,
          size: file.size,
        });
        runningTotal += file.size;
      } catch {
        toast.error(`Couldn't read "${file.name}".`);
      }
    }

    if (accepted.length > 0) {
      setAttachments((prev) => [...prev, ...accepted]);
    }
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  const recipients = React.useMemo(() => parseRecipients(to), [to]);
  const ccRecipients = React.useMemo(() => parseRecipients(cc), [cc]);

  const invalidRecipients = recipients.filter((r) => !EMAIL_RE.test(r.email));
  const invalidCc = ccRecipients.filter((r) => !EMAIL_RE.test(r.email));

  const hasValidRecipient =
    recipients.length > 0 && invalidRecipients.length === 0;
  const hasSubject = subject.trim().length > 0;
  const ccValid = invalidCc.length === 0;

  const canSend =
    !sending && Boolean(accountId) && hasValidRecipient && hasSubject && ccValid;

  const selectedAccount = accountById(accounts, accountId);

  async function handleSend() {
    if (!canSend) return;
    setSending(true);

    const outgoing: OutgoingAttachment[] = attachments.map(
      ({ filename, mimeType, contentBase64 }) => ({
        filename,
        mimeType,
        contentBase64,
      }),
    );

    const draft: MailDraft = {
      to: recipients,
      subject: subject.trim(),
      bodyText: body,
      ...(showCc && ccRecipients.length > 0 ? { cc: ccRecipients } : {}),
      ...(outgoing.length > 0 ? { attachments: outgoing } : {}),
    };

    try {
      await postJson<OkResponse>("/api/mail/send", {
        accountId,
        draft,
        ...(prefill ? { reply: prefill.reply } : {}),
      });
      toast.success(isReply ? "Reply sent" : "Message sent");
      onSent?.();
      onOpenChange(false);
    } catch (err) {
      const message =
        err instanceof FetchError
          ? err.message
          : "Couldn't send the message. Please try again.";
      toast.error(message);
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !sending && onOpenChange(next)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isReply ? "Reply" : "New message"}</DialogTitle>
          <DialogDescription>
            {isReply
              ? "Your reply will be sent from the account this message was received on."
              : "Compose a message from any of your connected accounts."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {/* From */}
          <div className="grid gap-2">
            <Label htmlFor="compose-from">From</Label>
            {isReply ? (
              <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-muted/40 px-3 text-sm">
                {selectedAccount ? (
                  <>
                    <AccountDot color={selectedAccount.color} size="sm" />
                    <span className="min-w-0 truncate" title={selectedAccount.email}>
                      {selectedAccount.email}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">Account</span>
                )}
              </div>
            ) : (
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger id="compose-from" aria-label="From account">
                  <SelectValue placeholder="Select an account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      <span className="flex items-center gap-2">
                        <AccountDot color={account.color} size="sm" />
                        <span className="truncate">{account.email}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* To */}
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="compose-to">To</Label>
              {!showCc ? (
                <button
                  type="button"
                  onClick={() => setShowCc(true)}
                  className="text-xs font-medium text-primary outline-none hover:underline focus-visible:underline"
                >
                  Add Cc
                </button>
              ) : null}
            </div>
            <Input
              id="compose-to"
              type="text"
              inputMode="email"
              autoComplete="off"
              placeholder="name@example.com, another@example.com"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-invalid={invalidRecipients.length > 0}
            />
            {invalidRecipients.length > 0 ? (
              <p className="text-xs text-destructive">
                Invalid address: {invalidRecipients.map((r) => r.email).join(", ")}
              </p>
            ) : null}
          </div>

          {/* Cc (optional) */}
          {showCc ? (
            <div className="grid gap-2">
              <Label htmlFor="compose-cc">Cc</Label>
              <Input
                id="compose-cc"
                type="text"
                inputMode="email"
                autoComplete="off"
                placeholder="cc@example.com"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                aria-invalid={invalidCc.length > 0}
              />
              {invalidCc.length > 0 ? (
                <p className="text-xs text-destructive">
                  Invalid address: {invalidCc.map((r) => r.email).join(", ")}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Subject */}
          <div className="grid gap-2">
            <Label htmlFor="compose-subject">Subject</Label>
            <Input
              id="compose-subject"
              type="text"
              placeholder="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          {/* Body */}
          <div className="grid gap-2">
            <Label htmlFor="compose-body">Message</Label>
            <Textarea
              id="compose-body"
              placeholder="Write your message…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className={cn("min-h-[180px] resize-y scrollbar-thin")}
            />
          </div>

          {/* Attachments */}
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending}
              >
                <Paperclip aria-hidden="true" />
                Attach files
              </Button>
              {attachments.length > 0 ? (
                <span className="text-xs text-muted-foreground">
                  {formatBytes(totalAttachmentBytes)} of{" "}
                  {formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)}
                </span>
              ) : null}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              aria-hidden="true"
              tabIndex={-1}
              onChange={(e) => {
                void handleFilesChosen(e.target.files);
                // Reset so re-picking the same file fires onChange again.
                e.target.value = "";
              }}
            />

            {attachments.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {attachments.map((att, index) => {
                  const size = formatBytes(att.size);
                  return (
                    <li
                      key={`${att.filename}:${index}`}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-muted/40 py-1 pl-2.5 pr-1 text-xs"
                    >
                      <Paperclip
                        className="h-3 w-3 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span
                        className="min-w-0 max-w-[14rem] truncate text-foreground"
                        title={att.filename}
                      >
                        {att.filename}
                      </span>
                      {size ? (
                        <span className="shrink-0 text-muted-foreground">
                          {size}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => removeAttachment(index)}
                        disabled={sending}
                        aria-label={`Remove ${att.filename}`}
                        title={`Remove ${att.filename}`}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={sending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSend} disabled={!canSend}>
            {sending ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                Sending…
              </>
            ) : (
              <>
                <Send aria-hidden="true" />
                Send
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
