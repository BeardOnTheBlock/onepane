# Contributing to OnePane

Thanks for your interest in improving OnePane. This guide covers the dev environment,
the provider abstraction (the main extension point), the coding conventions, and the
checks to run before opening a pull request.

## Development environment

Prerequisites: **Node.js 20+** and **npm**.

```bash
git clone https://github.com/BeardOnTheBlock/onepane.git
cd onepane
npm install

cp .env.example .env
# Generate an encryption key and paste it into ONEPANE_ENCRYPTION_KEY:
openssl rand -base64 32
```

Add OAuth credentials for at least one provider so you can connect a real account while
developing — the full walkthrough is in [`docs/OAUTH_SETUP.md`](docs/OAUTH_SETUP.md).

Initialise the database and start the dev server:

```bash
npm run setup     # prisma generate && prisma db push
npm run dev       # http://localhost:6969
```

Useful scripts (all defined in `package.json`):

| Script             | What it does                                       |
| ------------------ | -------------------------------------------------- |
| `npm run dev`      | Start the Next.js dev server                       |
| `npm run build`    | Production build                                   |
| `npm start`        | Serve the production build                         |
| `npm run lint`     | ESLint via `next lint`                             |
| `npm run typecheck`| `tsc --noEmit` (strict type-check, no emit)        |
| `npm run setup`    | `prisma generate && prisma db push`                |
| `npm run db:studio`| Open Prisma Studio against the local SQLite DB     |

## Project layout

```
src/
  app/            Next.js App Router: pages + /api/* route handlers
  components/ui/  Reusable shadcn/ui primitives
  hooks/          Client data hooks (useAccounts, useProviders, ...)
  lib/
    types.ts      Canonical shared contracts (import from "@/lib/types")
    config.ts     Provider config, scopes, ACCOUNT_COLOR_PALETTE
    crypto.ts     AES-256-GCM token encryption
    db.ts         Prisma client singleton
    accounts.ts   The only module that reads/writes the Account table
    oauth.ts      OAuth code exchange + token refresh lifecycle
    providers/    Per-provider MailProvider/CalendarProvider implementations
prisma/
  schema.prisma   SQLite schema (one Account row per connected login)
docs/             OAuth setup + architecture
```

## Adding a provider

OnePane's provider layer is the primary extension point. A provider implements two
interfaces from `@/lib/types` and is then registered in `src/lib/providers/index.ts`.
Nothing else in the app needs to change — the API routes resolve providers through the
registry by the account's `provider` id.

The two interfaces (defined in `src/lib/types.ts`):

```ts
export interface MailProvider {
  listMessages(account: AccountWithTokens, limit: number): Promise<UnifiedMessage[]>;
  getMessage(account: AccountWithTokens, messageId: string): Promise<UnifiedMessageFull>;
  sendMessage(account: AccountWithTokens, draft: MailDraft, reply?: ReplyContext): Promise<void>;
}

export interface CalendarProvider {
  listEvents(account: AccountWithTokens, range: DateRange): Promise<UnifiedEvent[]>;
  createEvent(account: AccountWithTokens, draft: EventDraft): Promise<UnifiedEvent>;
}
```

To add a provider (for example, `fastmail`):

1. **Extend the contract.** Add the new id to the `ProviderId` union in `src/lib/types.ts`,
   and add its OAuth config + scopes to `src/lib/config.ts`
   (`getProviderConfig`, `isProviderConfigured`, `ALL_PROVIDERS`).
2. **Implement the interfaces.** Create `src/lib/providers/<provider>/mail.ts` and
   `src/lib/providers/<provider>/calendar.ts` implementing `MailProvider` and
   `CalendarProvider`. Always obtain a token with `getValidAccessToken(account)` from
   `@/lib/oauth` so expired tokens are refreshed transparently.
3. **Map to the unified shapes.** Convert the provider's API responses into
   `UnifiedMessage` / `UnifiedMessageFull` / `UnifiedEvent`. Set `locationMapsUrl` with
   `googleMapsUrl()` from `@/lib/utils` when an event has a physical location, and set
   `conferenceType` / `conferenceUrl` for online meetings.
4. **Report capabilities at connect time.** In `src/lib/oauth.ts`'s `fetchProfile`, return
   accurate `canMeet` / `canTeams` flags so the UI only offers conferencing the account can
   actually create.
5. **Register it.** Export the implementations from `src/lib/providers/index.ts` so the API
   routes can resolve `mailProviderFor(providerId)` / `calendarProviderFor(providerId)`.
6. **Document its OAuth setup** in `docs/OAUTH_SETUP.md` and add any new env vars to
   `.env.example`.

Keep providers resilient: one account failing should never blank out the unified view. The
aggregating routes collect per-account failures into the `errors: AccountError[]` field of
the response rather than throwing.

## Coding conventions

- **TypeScript, strict mode.** No `any` escape hatches where a real type exists.
- **Imports use the `@/` alias** (maps to `src/`). Never reach across top-level directories
  with relative `../../` paths.
- **Server-only modules stay server-only.** Anything importing `@/lib/db`, `@/lib/accounts`,
  `@/lib/oauth`, `@/lib/crypto`, or a provider must never be imported into a client
  component. Client components talk to the server only through `fetch()` to `/api/*`.
- **Client components** that use hooks, state, effects, event handlers, or browser APIs
  start with `"use client"` on line 1.
- **Next.js 15 async APIs.** `cookies()` from `next/headers` is async (`await` it); dynamic
  route params are a `Promise` (`await params`); read query params via
  `new URL(req.url).searchParams`.
- **Styling.** Tailwind CSS v3 + shadcn/ui (new-york). Compose class names with `cn()` from
  `@/lib/utils`. Reusable primitives live in `@/components/ui/*`.
- **Icons** from `lucide-react`; **toasts** via `import { toast } from "sonner"`.
- **No new dependencies** without discussion — the dependency set in `package.json` is
  intentionally small.
- **Account colour.** Every account has a hex `color`; use it consistently as a left stripe
  or dot wherever the account appears.
- **Quality bar.** Accessible, pixel-clean, no text overflow (truncate long
  subjects/emails with a `title` attribute), sensible empty states, loading skeletons, and
  error toasts.

## Before you open a pull request

Run the full check suite and make sure it is green:

```bash
npm run typecheck
npm run lint
npm run build
```

Then open a PR with a clear description of the change and any new env vars or migrations it
requires. Please keep PRs focused and include screenshots for UI changes.
