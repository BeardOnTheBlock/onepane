# OnePane

**All your email inboxes and calendars in a single pane — local-first, on your own machine.**

OnePane is a local-first, desktop-style web app that unifies multiple email inboxes
and calendars (Google + Microsoft) into one view. No more one-browser-tab-per-account.
Read mail across every account in a single inbox, compose and reply from any of them,
and create calendar invites with a **Google Meet** link, a **Microsoft Teams** meeting,
or a **physical location** linked straight to Google Maps — all without leaving the app.

It runs entirely on your machine. Your data lives in a local SQLite file and your OAuth
tokens are encrypted at rest. Nothing is sent to any third-party server other than
Google's and Microsoft's own APIs.

## Table of contents

- [Why](#why)
- [Features](#features)
- [Privacy and security](#privacy-and-security)
- [Tech stack](#tech-stack)
- [Quickstart](#quickstart)
- [Conferencing and locations](#conferencing-and-locations)
- [Roadmap](#roadmap)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## Why

Your phone already solved this. The default mail and calendar apps on a phone merge
every account you own into one inbox and one calendar — work Gmail, personal Gmail,
an Outlook account, a university Microsoft account — and you stop thinking about which
account a message came from.

The desktop browser never caught up. There you are back to a tab per account, logging
in and out, copying a meeting link from one tab into a compose window in another, and
losing track of which calendar an invite landed on. OnePane brings the phone's unified
experience to the desktop, while keeping every byte of your data on your own machine.

## Features

- **Unified inbox** across all connected accounts, with each account colour-coded by a
  consistent hex colour (a left stripe and a dot) so you always know where a message
  came from.
- **Compose and reply from any account** — pick the sending identity per message; replies
  carry the correct threading headers.
- **Unified calendar** with month, week, and agenda views spanning every connected
  account at once.
- **Create invites with attendees** directly from OnePane.
- **Meetings your way**: attach a **Google Meet** link, a **Microsoft Teams** meeting, or
  a **physical location** that is automatically turned into a Google Maps link.
- **Local-first** — your mail metadata, calendar data, and encrypted OAuth tokens stay in
  a SQLite file on your machine.
- **Pluggable provider architecture** — Google and Microsoft ship in the box; adding a new
  provider is implementing two interfaces and registering them (see
  [`CONTRIBUTING.md`](CONTRIBUTING.md)).

## Privacy and security

- OnePane runs **entirely on your machine**. There is no OnePane server and no account to
  sign up for.
- All state is stored in a local **SQLite** database (`onepane.db` by default), kept inside
  the repo folder and git-ignored.
- OAuth access and refresh tokens are **encrypted at rest with AES-256-GCM** before they are
  written to the database. The encryption key is derived from `ONEPANE_ENCRYPTION_KEY` in
  your `.env`, so a leaked `.db` file alone does not expose usable credentials.
- The only network calls OnePane makes are to **Google's and Microsoft's official APIs**
  (Gmail, Google Calendar, and Microsoft Graph) to read and send your mail and calendar
  data. Nothing is sent to any third-party server.

> If you change `ONEPANE_ENCRYPTION_KEY` after connecting accounts, the stored tokens can
> no longer be decrypted and each account must be re-connected.

## Tech stack

- **Next.js 15** (App Router) and **React 19**
- **TypeScript** (strict mode)
- **Tailwind CSS** with **shadcn/ui** (new-york style)
- **Prisma** with **SQLite**

## Quickstart

```bash
# 1. Clone and install
git clone https://github.com/BeardOnTheBlock/onepane.git
cd onepane
npm install

# 2. Create your local config
cp .env.example .env
```

Generate an encryption key and paste it into `ONEPANE_ENCRYPTION_KEY` in `.env`:

```bash
openssl rand -base64 32
```

Initialise the local database, then start the dev server:

```bash
# 3. Generate the Prisma client and create the SQLite schema
npm run setup     # runs `prisma generate && prisma db push`

# 4. Run it
npm run dev       # http://localhost:6969
```

Open <http://localhost:6969> and go to **Settings**. For each provider you want, create
your own OAuth credentials (one-time, free — the click-by-click walkthrough for Google and
Microsoft is in [`docs/OAUTH_SETUP.md`](docs/OAUTH_SETUP.md)) and paste the **Client ID &
Secret** straight into the **Set up Google/Microsoft** card. They're stored encrypted in the
local database — no `.env` editing required (though you can use `.env` instead if you
prefer). Then hit **Connect**, complete the consent screen, and you're in. You can connect
just one provider to start, and as many accounts as you like.

## Conferencing and locations

How a meeting link is created depends on the account hosting the event:

- **Google Meet** links can be created from **Google** accounts.
- **Microsoft Teams** meetings can be created from **Microsoft work or school** accounts —
  **not** personal `outlook.com` / `hotmail.com` accounts, which the Microsoft Graph API
  does not allow to host Teams meetings.
- **Physical locations** work for **any** account and are linked to **Google Maps** from the
  free-text address you enter.

OnePane detects each account's capabilities when you connect it (`canMeet` for Google,
`canTeams` for Microsoft work/school accounts) and only offers the options that account
actually supports.

## Roadmap

- Full-text search across the unified inbox
- Conversation threading
- Attachment viewing and sending
- Drag-to-create events on the calendar grid
- Multiple calendars per account
- More providers, including generic IMAP/SMTP

## Documentation

- [`docs/OAUTH_SETUP.md`](docs/OAUTH_SETUP.md) — step-by-step Google and Microsoft OAuth setup
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the layers fit together
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — dev setup, the provider abstraction, and conventions

## Contributing

Contributions are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for how to set up the
dev environment, add a new provider, and run the type-check, lint, and build.

## License

[MIT](LICENSE) © 2026 BeardOnTheBlock
