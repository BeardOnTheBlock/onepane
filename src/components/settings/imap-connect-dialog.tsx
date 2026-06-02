"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Switch } from "@/components/ui/switch";
import { FetchError, postJson } from "@/lib/fetcher";
import type { ImapCredentials, OkResponse } from "@/lib/types";

// ---------------------------------------------------------------------------
// Presets prefill the host/port fields for the common providers. "custom"
// leaves whatever the user has already typed untouched.
// ---------------------------------------------------------------------------

type PresetId = "icloud" | "fastmail" | "custom";

interface Preset {
  label: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  caldavUrl: string;
}

const PRESETS: Record<Exclude<PresetId, "custom">, Preset> = {
  icloud: {
    label: "iCloud",
    imapHost: "imap.mail.me.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.mail.me.com",
    smtpPort: 587,
    smtpSecure: false, // STARTTLS on 587
    caldavUrl: "https://caldav.icloud.com",
  },
  fastmail: {
    label: "Fastmail",
    imapHost: "imap.fastmail.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.fastmail.com",
    smtpPort: 465,
    smtpSecure: true, // implicit TLS on 465
    caldavUrl: "https://caldav.fastmail.com",
  },
};

// The body of POST /api/connect/imap: an ImapCredentials plus the account email.
type ImapConnectBody = ImapCredentials & { email: string };

interface FormState {
  email: string;
  imapHost: string;
  imapPort: string;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  username: string;
  /** True once the user edits Username, so preset/email changes stop overwriting it. */
  usernameTouched: boolean;
  password: string;
  caldavUrl: string;
}

const INITIAL_STATE: FormState = {
  email: "",
  imapHost: "",
  imapPort: "993",
  imapSecure: true,
  smtpHost: "",
  smtpPort: "587",
  smtpSecure: false,
  username: "",
  usernameTouched: false,
  password: "",
  caldavUrl: "",
};

export interface ImapConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful connection so the parent can revalidate. */
  onConnected: () => void;
}

/**
 * The "Other (IMAP / CalDAV)" connect dialog. Collects IMAP/SMTP (+ optional
 * CalDAV) connection details and POSTs them to /api/connect/imap, which verifies
 * the credentials and creates the account. Stays open (with an error toast) when
 * the connection can't be established so the user can fix the details.
 */
export function ImapConnectDialog({
  open,
  onOpenChange,
  onConnected,
}: ImapConnectDialogProps) {
  const [preset, setPreset] = React.useState<PresetId>("custom");
  const [form, setForm] = React.useState<FormState>(INITIAL_STATE);
  const [submitting, setSubmitting] = React.useState(false);

  // Reset everything whenever the dialog is freshly opened.
  React.useEffect(() => {
    if (open) {
      setPreset("custom");
      setForm(INITIAL_STATE);
      setSubmitting(false);
    }
  }, [open]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function applyPreset(id: PresetId) {
    setPreset(id);
    if (id === "custom") return;
    const p = PRESETS[id];
    setForm((prev) => ({
      ...prev,
      imapHost: p.imapHost,
      imapPort: String(p.imapPort),
      imapSecure: p.imapSecure,
      smtpHost: p.smtpHost,
      smtpPort: String(p.smtpPort),
      smtpSecure: p.smtpSecure,
      caldavUrl: p.caldavUrl,
    }));
  }

  // Username defaults to the email until the user explicitly edits it.
  const effectiveUsername = form.usernameTouched
    ? form.username
    : form.email;

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const imapPortNum = Number(form.imapPort);
  const smtpPortNum = Number(form.smtpPort);
  const portsValid =
    Number.isInteger(imapPortNum) &&
    imapPortNum > 0 &&
    imapPortNum <= 65535 &&
    Number.isInteger(smtpPortNum) &&
    smtpPortNum > 0 &&
    smtpPortNum <= 65535;

  const canSubmit =
    !submitting &&
    emailValid &&
    form.imapHost.trim().length > 0 &&
    form.smtpHost.trim().length > 0 &&
    effectiveUsername.trim().length > 0 &&
    form.password.length > 0 &&
    portsValid;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      const body: ImapConnectBody = {
        email: form.email.trim(),
        imapHost: form.imapHost.trim(),
        imapPort: imapPortNum,
        imapSecure: form.imapSecure,
        smtpHost: form.smtpHost.trim(),
        smtpPort: smtpPortNum,
        smtpSecure: form.smtpSecure,
        username: effectiveUsername.trim(),
        password: form.password,
        caldavUrl: form.caldavUrl.trim() || undefined,
      };
      await postJson<OkResponse>("/api/connect/imap", body);
      toast.success(`Connected ${form.email.trim()}`);
      onConnected();
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof FetchError
          ? err.message
          : "Couldn't connect. Check the host, port, and password and try again.",
      );
      // Keep the dialog open so the user can correct the details.
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto scrollbar-thin">
        <DialogHeader>
          <DialogTitle>Connect a mailbox</DialogTitle>
          <DialogDescription>
            Connect any IMAP/SMTP mailbox with a username and password. Tokens
            are stored encrypted on this machine.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid min-w-0 gap-4">
          {/* Preset */}
          <div className="grid gap-1.5">
            <Label htmlFor="imap-preset">Provider preset</Label>
            <Select
              value={preset}
              onValueChange={(v) => applyPreset(v as PresetId)}
            >
              <SelectTrigger id="imap-preset">
                <SelectValue placeholder="Choose a provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="icloud">iCloud</SelectItem>
                <SelectItem value="fastmail">Fastmail</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              iCloud and Gmail require an app-specific password, not your normal
              login password.
            </p>
          </div>

          {/* Email */}
          <div className="grid gap-1.5">
            <Label htmlFor="imap-email">Email</Label>
            <Input
              id="imap-email"
              type="email"
              autoComplete="off"
              spellCheck={false}
              placeholder="you@example.com"
              value={form.email}
              onChange={(e) => update("email", e.target.value)}
            />
          </div>

          {/* IMAP host + port */}
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor="imap-host">IMAP host</Label>
              <Input
                id="imap-host"
                autoComplete="off"
                spellCheck={false}
                placeholder="imap.example.com"
                value={form.imapHost}
                onChange={(e) => update("imapHost", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5 sm:w-24">
              <Label htmlFor="imap-port">IMAP port</Label>
              <Input
                id="imap-port"
                type="number"
                inputMode="numeric"
                min={1}
                max={65535}
                placeholder="993"
                value={form.imapPort}
                onChange={(e) => update("imapPort", e.target.value)}
              />
            </div>
          </div>

          {/* IMAP TLS */}
          <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
            <div className="min-w-0">
              <Label htmlFor="imap-secure" className="block">
                IMAP TLS
              </Label>
              <p className="text-xs text-muted-foreground">
                Implicit TLS (usually port 993).
              </p>
            </div>
            <Switch
              id="imap-secure"
              checked={form.imapSecure}
              onCheckedChange={(v) => update("imapSecure", v)}
            />
          </div>

          {/* SMTP host + port */}
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor="smtp-host">SMTP host</Label>
              <Input
                id="smtp-host"
                autoComplete="off"
                spellCheck={false}
                placeholder="smtp.example.com"
                value={form.smtpHost}
                onChange={(e) => update("smtpHost", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5 sm:w-24">
              <Label htmlFor="smtp-port">SMTP port</Label>
              <Input
                id="smtp-port"
                type="number"
                inputMode="numeric"
                min={1}
                max={65535}
                placeholder="587"
                value={form.smtpPort}
                onChange={(e) => update("smtpPort", e.target.value)}
              />
            </div>
          </div>

          {/* SMTP TLS */}
          <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
            <div className="min-w-0">
              <Label htmlFor="smtp-secure" className="block">
                SMTP TLS
              </Label>
              <p className="text-xs text-muted-foreground">
                On for implicit TLS (port 465); off for STARTTLS (port 587).
              </p>
            </div>
            <Switch
              id="smtp-secure"
              checked={form.smtpSecure}
              onCheckedChange={(v) => update("smtpSecure", v)}
            />
          </div>

          {/* Username */}
          <div className="grid gap-1.5">
            <Label htmlFor="imap-username">Username</Label>
            <Input
              id="imap-username"
              autoComplete="off"
              spellCheck={false}
              placeholder="Defaults to your email"
              value={effectiveUsername}
              onChange={(e) => {
                update("usernameTouched", true);
                update("username", e.target.value);
              }}
            />
          </div>

          {/* Password */}
          <div className="grid gap-1.5">
            <Label htmlFor="imap-password">Password / app password</Label>
            <Input
              id="imap-password"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="App-specific password"
              value={form.password}
              onChange={(e) => update("password", e.target.value)}
            />
          </div>

          {/* CalDAV URL (optional) */}
          <div className="grid gap-1.5">
            <Label htmlFor="imap-caldav">
              CalDAV URL{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Input
              id="imap-caldav"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://caldav.example.com"
              value={form.caldavUrl}
              onChange={(e) => update("caldavUrl", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Add a CalDAV base URL to sync this account&rsquo;s calendar too.
            </p>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Connecting…
                </>
              ) : (
                "Connect"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
