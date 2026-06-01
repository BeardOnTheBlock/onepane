"use client";

import * as React from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { AccountDot } from "@/components/account-dot";
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
  ReplyContext,
} from "@/lib/types";

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
  const [sending, setSending] = React.useState(false);

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
    setSending(false);
    // We intentionally only re-run when the dialog transitions open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

    const draft: MailDraft = {
      to: recipients,
      subject: subject.trim(),
      bodyText: body,
      ...(showCc && ccRecipients.length > 0 ? { cc: ccRecipients } : {}),
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
