# Architecture

OnePane is a single Next.js 15 (App Router) application that runs locally. The server side
talks to Google and Microsoft, stores state in SQLite, and exposes a small JSON API. The
client side is a desktop-style UI that only ever talks to that local API. This document
describes the layers, the API surface, and how a request flows through them.

## Layers at a glance

```
                        Browser (client components)
                  Inbox · Message view · Calendar · Compose · Settings
                                     │
                            fetch() to /api/*  (JSON only)
                                     │
   ──────────────────────────────── HTTP ────────────────────────────────
                                     │
                          API routes  (src/app/api/*)
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        │                            │                             │
   accounts.ts                   oauth.ts                  providers/ (registry)
   (data layer)            (token lifecycle)         google/* · microsoft/*
        │                            │                  implements MailProvider
   encrypt/decrypt           getValidAccessToken             + CalendarProvider
   (crypto.ts, AES-256-GCM)  refresh + persist                     │
        │                            │                             │
        └──────────────┬─────────────┘                   Gmail · Calendar APIs
                       │                                  Microsoft Graph
                  Prisma (db.ts)
                       │
                  SQLite (onepane.db)
```

All types crossing these boundaries come from a single contract module, so the data layer,
providers, routes, and UI all agree on shapes.

### 1. Types contract — `src/lib/types.ts`

The single source of truth. Everything imports from `@/lib/types`:

- **Accounts:** `AccountPublic` (browser-safe, never includes tokens) and the server-only
  `AccountWithTokens` (adds decrypted `accessToken` / `refreshToken`).
- **Mail:** `UnifiedMessage`, `UnifiedMessageFull`, `MailDraft`, `ReplyContext`, `MailAddress`.
- **Calendar:** `UnifiedEvent`, `EventDraft`, `EventAttendee`, plus `ConferenceType`
  (`none` / `google_meet` / `ms_teams`) and `EventLocationType`.
- **Provider interfaces:** `MailProvider` and `CalendarProvider` — the contract each provider
  implements.
- **API envelopes:** `AccountsResponse`, `MailListResponse`, `MailMessageResponse`,
  `CalendarListResponse`, `CreateEventResponse`, `OkResponse`, `ErrorResponse`, and the
  per-account `AccountError`.

### 2. Accounts data layer + encryption — `src/lib/accounts.ts`, `src/lib/crypto.ts`, `src/lib/db.ts`

`accounts.ts` is the **only** module that reads or writes the `Account` table. It converts
between the Prisma row, the server-side `AccountWithTokens`, and the browser-safe
`AccountPublic`, and it transparently **encrypts tokens on write and decrypts on read**.

Encryption (`crypto.ts`) uses **AES-256-GCM**. The key is derived (SHA-256) from
`ONEPANE_ENCRYPTION_KEY`, and the stored payload format is `iv:authTag:ciphertext`, each part
base64-encoded. A leaked `onepane.db` therefore does not expose usable credentials.

`db.ts` is a Prisma client singleton (reused across HMR in development). The schema
(`prisma/schema.prisma`) is a single `Account` model with a unique `(provider, email)`
constraint, so re-connecting an account updates the same row rather than duplicating it.
New accounts are auto-assigned the least-used colour from `ACCOUNT_COLOR_PALETTE`.

### 3. OAuth lifecycle — `src/lib/oauth.ts`, `src/lib/config.ts`

`config.ts` resolves per-provider OAuth config (client id/secret, scopes, auth/token URLs,
redirect URI) from environment variables, and exposes `isProviderConfigured()` so the UI can
show "Connect" only for configured providers.

`oauth.ts` implements the authorization-code flow and token lifecycle:

- `buildAuthUrl()` — builds the provider consent URL. Google gets `access_type=offline` +
  `prompt=consent` to guarantee a refresh token; Microsoft relies on the `offline_access`
  scope.
- `exchangeCodeForTokens()` — trades the callback `code` for access + refresh tokens.
- `fetchProfile()` — reads the account's email/name and derives capabilities: `canMeet`
  (always true for Google) and `canTeams` (true only for Microsoft work/school accounts,
  detected by probing the Graph organization endpoint).
- `getValidAccessToken()` — returns a valid access token, refreshing and persisting it first
  if it is expired or within the expiry skew. Providers should always call this rather than
  using `account.accessToken` directly.

### 4. Provider abstraction + registry — `src/lib/providers/*`

Each provider implements `MailProvider` (`listMessages` / `getMessage` / `sendMessage`) and
`CalendarProvider` (`listEvents` / `createEvent`) against its real API — Gmail + Google
Calendar, or Microsoft Graph — and maps the responses into the unified types. The registry
at `src/lib/providers/index.ts` resolves a provider implementation from an account's
`provider` id, so the API routes never special-case Google vs Microsoft. Adding a provider
is implementing the two interfaces and registering them (see `CONTRIBUTING.md`).

### 5. API routes — `src/app/api/*`

Thin Next.js 15 route handlers. They authenticate via the local data layer (no end-user
auth — the app is single-user and local), resolve providers through the registry, and return
the shared envelopes. Aggregating routes (`/api/mail`, `/api/calendar`) query every selected
account in parallel and collect per-account failures into `errors: AccountError[]` so one
broken account never blanks out the whole unified view.

### 6. Client UI — `src/app/*`, `src/components/*`, `src/hooks/*`

Client components render the unified inbox, message view, calendar (month/week/agenda),
compose/reply, and settings. They never import server-only modules; they fetch JSON from
`/api/*` through the helpers in `@/lib/fetcher` and the SWR-backed hooks `useAccounts()` and
`useProviders()`. Each account's `color` is used consistently (left stripe / dot) so the
source of every message and event is obvious at a glance.

## API routes

| Method | Path | Request | Response |
| ------ | ---- | ------- | -------- |
| GET | `/api/providers` | — | `{ providers: { google: boolean, microsoft: boolean } }` |
| GET | `/api/accounts` | — | `AccountsResponse` `{ accounts: AccountPublic[] }` |
| PATCH | `/api/accounts` | `{ id, color }` | `{ account: AccountPublic }` |
| DELETE | `/api/accounts?id=ID` | — | `OkResponse` |
| GET | `/api/connect/[provider]` | — | 302 redirect to the provider consent screen |
| GET | `/api/connect/[provider]/callback?code&state` | — | 302 redirect to `/settings?connected=EMAIL` (or `?error=MSG`) |
| GET | `/api/mail?accountId=all\|ID&limit=25` | — | `MailListResponse` `{ messages, errors }` |
| GET | `/api/mail/message?accountId=ID&id=MSGID` | — | `MailMessageResponse` `{ message }` |
| POST | `/api/mail/send` | `{ accountId, draft: MailDraft, reply?: ReplyContext }` | `OkResponse` |
| GET | `/api/calendar?start=ISO&end=ISO&accountId=all\|ID` | — | `CalendarListResponse` `{ events, errors }` |
| POST | `/api/calendar/events` | `{ accountId, draft: EventDraft }` | `CreateEventResponse` `{ event }` |

## Data flow

**Connecting an account.** The user clicks Connect in Settings → `GET /api/connect/[provider]`
builds the consent URL with `buildAuthUrl()` (storing a `state` value) and redirects to the
provider. After the user consents, the provider redirects back to
`GET /api/connect/[provider]/callback?code&state`. The route exchanges the code
(`exchangeCodeForTokens()`), fetches the profile + capabilities (`fetchProfile()`), and calls
`upsertAccount()`, which **encrypts the tokens** and writes one `Account` row. It then
redirects to `/settings?connected=EMAIL`.

**Reading the unified inbox.** The inbox screen calls `GET /api/mail?accountId=all&limit=25`.
The route loads the selected accounts (decrypting tokens), ensures each has a fresh token via
`getValidAccessToken()`, calls `mailProvider.listMessages()` for each in parallel, merges and
sorts the `UnifiedMessage[]`, and returns them alongside any `AccountError`s. Opening a
message calls `GET /api/mail/message?accountId=ID&id=MSGID`.

**Composing or replying.** The compose UI picks a sending account and posts
`POST /api/mail/send` with a `MailDraft` (and a `ReplyContext` for replies, carrying the
threading headers). The route resolves the provider for that account and calls
`sendMessage()`.

**Calendar and invites.** The calendar view requests
`GET /api/calendar?start=ISO&end=ISO&accountId=all`, which aggregates `listEvents()` across
accounts (again collecting per-account errors). Creating an invite posts
`POST /api/calendar/events` with an `EventDraft`; the provider's `createEvent()` attaches a
Google Meet link, a Teams meeting, or a physical location (with a Google Maps link via
`googleMapsUrl()`), and returns the created `UnifiedEvent`.
