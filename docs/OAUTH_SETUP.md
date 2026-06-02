# OAuth setup

OnePane connects to your accounts using OAuth 2.0. You create your own OAuth credentials
with Google and/or Microsoft, and OnePane uses them to run the consent flow locally.
Because the credentials are yours, no third party ever sees your tokens — they are stored,
encrypted, only on your machine.

**Two ways to provide the Client ID & Secret** (pick one):

- **In the app (recommended).** Run OnePane, open **Settings → Set up Google/Microsoft**, and
  paste the Client ID & Secret there. They are stored **encrypted in the local database** —
  never in a file or the repo. No restart needed.
- **In `.env`.** Set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (and/or the Microsoft pair),
  then restart `npm run dev`. The `.env` file is git-ignored.

You only need to set up the provider(s) you actually want to use. OnePane shows a working
"Connect" button for a provider once its credentials are present (from either source).

The steps below cover creating the credentials; where they go is your choice above.

- [Google](#google-gmail--google-calendar--google-meet)
- [Microsoft](#microsoft-outlook-mail--calendar--teams)
- [Troubleshooting](#troubleshooting)

---

## Google (Gmail + Google Calendar + Google Meet)

### 1. Create a Google Cloud project

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Open the project picker (top bar) and click **New Project**. Name it something like
   `OnePane` and create it.
3. Make sure the new project is selected in the project picker.

### 2. Enable the APIs

In the selected project, enable both APIs (APIs & Services → Library, search and **Enable**):

- **Gmail API**
- **Google Calendar API**

### 3. Configure the OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**.
2. Choose **User type: External** and click **Create**.
3. Fill in the required fields (app name, your support email, developer contact email).
4. On the **Scopes** step, add the scopes OnePane requests. **These only appear in the
   picker after you've enabled the Gmail API and Google Calendar API (previous step)** — if
   the list shows only `openid`/`email`/`profile`, go back and enable both APIs, or use the
   **"Manually add scopes"** box and paste the URLs below.
   - `https://www.googleapis.com/auth/gmail.modify` — read, send, archive, delete (to Trash),
     labels, and drafts (everything a mail client does except permanent deletion)
   - `https://www.googleapis.com/auth/calendar` — full read/write across your calendars + events

   (OnePane also requests the standard `openid`, `email`, and `profile` scopes to read your
   address and name. These two scopes are Google "restricted" scopes; in **Testing** mode you,
   as a listed test user, can use them and simply click past the "unverified app" screen.)
5. On the **Test users** step, **add your own Google account** as a test user. While the app
   is in "Testing" mode, only listed test users can connect — which is exactly what you want
   for a personal, local-first tool.
6. Save through to the end.

### 4. Create an OAuth client ID

1. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. **Application type: Web application.**
3. Under **Authorized redirect URIs**, add exactly:

   ```
   http://localhost:6969/api/connect/google/callback
   ```

4. Click **Create**. Copy the **Client ID** and **Client secret**.

### 5. Put the values in `.env`

```dotenv
GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-client-secret"
```

Google Meet links can be created from any Google account, so every connected Google
account is Meet-capable automatically.

---

## Microsoft (Outlook Mail + Calendar + Teams)

OnePane talks to Microsoft via the **Microsoft Graph** API and uses the `common` tenant so
that **both** work/school **and** personal Microsoft accounts can connect.

### 1. Register an application

1. Go to the [Microsoft Entra admin center](https://entra.microsoft.com).
2. Navigate to **Identity → Applications → App registrations → New registration**.
3. **Name:** `OnePane`.
4. **Supported account types:** choose
   **"Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant)
   and personal Microsoft accounts (e.g. Skype, Xbox)"**. This is what allows both account
   kinds to connect.
5. **Redirect URI:** select platform type **Web** and enter exactly:

   ```
   http://localhost:6969/api/connect/microsoft/callback
   ```

6. Click **Register**. On the overview page, copy the **Application (client) ID**.

### 2. Create a client secret

1. In the app registration, go to **Certificates & secrets → Client secrets → New client
   secret**.
2. Give it a description and an expiry, then **Add**.
3. **Copy the secret Value immediately** (not the Secret ID) — it is shown only once.

### 3. Add API permissions

Go to **API permissions → Add a permission → Microsoft Graph → Delegated permissions**, and
add each of these:

- `User.Read`
- `Mail.ReadWrite` (read, write, move, delete, and draft mail)
- `Mail.Send`
- `Calendars.ReadWrite`
- `OnlineMeetings.ReadWrite`
- `offline_access` (so OnePane receives a refresh token and can stay connected)

For a personal Microsoft tool these delegated permissions consent themselves on first
sign-in; you do not need an admin to grant consent.

### 4. Put the values in `.env`

```dotenv
MICROSOFT_CLIENT_ID="your-application-client-id"
MICROSOFT_CLIENT_SECRET="your-client-secret-value"
MICROSOFT_TENANT="common"
```

Keep `MICROSOFT_TENANT=common` so both work/school and personal accounts can sign in.

Microsoft Teams meetings can only be hosted by **work or school** accounts. OnePane detects
this when you connect (by probing the Graph organization endpoint) and offers the Teams
option only for accounts that support it; personal `outlook.com` accounts get email,
calendar, and physical-location invites, just not Teams.

---

## Troubleshooting

### `redirect_uri_mismatch` (or AADSTS50011)

The redirect URI registered with the provider must match what OnePane sends, **character for
character**. Confirm the registered URI is exactly one of:

- `http://localhost:6969/api/connect/google/callback`
- `http://localhost:6969/api/connect/microsoft/callback`

Common mistakes: a trailing slash, `https` instead of `http` for localhost, a different
port, or registering the app's home page instead of the `.../callback` path. If you run
OnePane on a non-default port or host, update `APP_URL` in `.env` **and** the registered
redirect URI to match.

### Account connects but stops working after an hour ("no refresh token")

Access tokens are short-lived; OnePane refreshes them using a stored **refresh token**. If
the provider never returned one, you will see an error asking you to re-connect.

- **Google:** OnePane requests `access_type=offline` and `prompt=consent`, which forces a
  refresh token. If you previously authorised without it, **re-connect** the account from
  Settings (or remove the app's access at
  <https://myaccount.google.com/permissions> and connect again) to receive one.
- **Microsoft:** make sure the **`offline_access`** delegated permission is added (step 3
  above). Without it, Graph never issues a refresh token. Add it, then re-connect.

### "Teams unavailable" / no Teams option for a Microsoft account

This is expected for **personal** Microsoft accounts (`outlook.com`, `hotmail.com`,
`live.com`). Microsoft Graph does not allow them to host Teams meetings, so OnePane hides
the option. Use a **work or school** Microsoft account to create Teams meetings, or attach a
physical location or a Google Meet link from a Google account instead.

### Google blocks sign-in with "access denied" / app not verified

While your Google project is in **Testing** mode, only accounts listed as **Test users** on
the OAuth consent screen can connect. Add the Google account you are signing in with to the
test users list (step 3 above). You do not need to publish or verify the app for personal,
local use.

### Changing the encryption key invalidates connected accounts

If `ONEPANE_ENCRYPTION_KEY` changes after accounts are connected, their stored tokens can no
longer be decrypted. Re-connect each account from Settings to store freshly-encrypted
tokens.
