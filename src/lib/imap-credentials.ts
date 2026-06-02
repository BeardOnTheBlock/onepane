// ============================================================================
// IMAP/SMTP/CalDAV account credentials.
// To avoid a schema migration, generic ("imap") accounts store their connection
// details as an encrypted JSON blob in the account's token field. These helpers
// (de)serialise that blob. SERVER-ONLY.
// ============================================================================

import type { AccountWithTokens, ImapCredentials } from "@/lib/types";

/** Serialises credentials for storage in the (to-be-encrypted) token field. */
export function serializeImapCredentials(creds: ImapCredentials): string {
  return JSON.stringify(creds);
}

/** Reads the credentials from an "imap" account's (decrypted) token field. */
export function parseImapCredentials(account: AccountWithTokens): ImapCredentials {
  let parsed: Partial<ImapCredentials>;
  try {
    parsed = JSON.parse(account.accessToken) as Partial<ImapCredentials>;
  } catch {
    throw new Error(
      `Account ${account.email} is misconfigured (bad credentials). Please re-connect it.`,
    );
  }
  if (!parsed.imapHost || !parsed.username || !parsed.password) {
    throw new Error(
      `Account ${account.email} is missing IMAP credentials. Please re-connect it.`,
    );
  }
  return {
    imapHost: parsed.imapHost,
    imapPort: parsed.imapPort ?? 993,
    imapSecure: parsed.imapSecure ?? true,
    smtpHost: parsed.smtpHost ?? parsed.imapHost,
    smtpPort: parsed.smtpPort ?? 587,
    smtpSecure: parsed.smtpSecure ?? false,
    username: parsed.username,
    password: parsed.password,
    caldavUrl: parsed.caldavUrl,
  };
}
