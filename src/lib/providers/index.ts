// ============================================================================
// Provider registry.
//
// SERVER-ONLY. Resolves a ProviderId to the concrete MailProvider /
// CalendarProvider singleton. The API routes use these so they never need to
// branch on the provider themselves.
// ============================================================================

import { caldavCalendarProvider } from "@/lib/providers/caldav";
import {
  googleCalendarProvider,
  googleMailProvider,
} from "@/lib/providers/google";
import { imapMailProvider } from "@/lib/providers/imap";
import {
  microsoftCalendarProvider,
  microsoftMailProvider,
} from "@/lib/providers/microsoft";
import type {
  CalendarProvider,
  MailProvider,
  ProviderId,
} from "@/lib/types";

/** Returns the MailProvider implementation for a given provider id. */
export function getMailProvider(provider: ProviderId): MailProvider {
  switch (provider) {
    case "google":
      return googleMailProvider;
    case "microsoft":
      return microsoftMailProvider;
    case "imap":
      return imapMailProvider;
    default:
      // Exhaustiveness guard — keeps this honest if ProviderId ever grows.
      throw new Error(`Unknown provider: ${provider as string}`);
  }
}

/** Returns the CalendarProvider implementation for a given provider id. */
export function getCalendarProvider(provider: ProviderId): CalendarProvider {
  switch (provider) {
    case "google":
      return googleCalendarProvider;
    case "microsoft":
      return microsoftCalendarProvider;
    case "imap":
      return caldavCalendarProvider;
    default:
      throw new Error(`Unknown provider: ${provider as string}`);
  }
}
