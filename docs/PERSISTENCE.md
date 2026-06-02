# Keep OnePane running (persistence)

By default OnePane runs only while a `npm run dev` (or `npm run start`) process is
open — close the terminal and `http://localhost:6969` stops responding. If you want
OnePane always available in the background and automatically started when you log in,
install it as a service.

## macOS (launchd) — recommended

OnePane ships a one-command installer that registers a launchd **LaunchAgent**. It
builds a production bundle, runs it on port `6969`, restarts it if it crashes, and
starts it automatically at login.

```bash
cd ~/onepane
npm run service:install
```

That will:

- run `npm install`, `npm run setup`, and `npm run build`,
- write `~/Library/LaunchAgents/com.onepane.server.plist`,
- load it so OnePane is live at <http://localhost:6969> immediately and on every login.

> **Stop any `npm run dev` first.** The dev server and the service both use port
> `6969`; the installer warns you if the port is already busy.

### Managing the service

```bash
npm run service:status     # is it loaded / listening? shows recent logs
npm run service:logs       # tail the live log (~/Library/Logs/onepane.log)
npm run service:restart    # restart the running service
npm run service:rebuild    # rebuild after pulling changes, then restart
npm run service:uninstall  # stop it and remove the login item (data is kept)
```

The log lives at `~/Library/Logs/onepane.log`. Your accounts and data
(`prisma/onepane.db`) are never touched by install/uninstall.

### What gets installed

- `scripts/onepane.plist.template` → rendered into your LaunchAgents folder with the
  absolute paths to this project and your `node` binary (so it works under launchd's
  minimal environment).
- `scripts/onepane-run.sh` → the launcher the agent runs; it `cd`s into the project,
  picks up an nvm-managed `node` if present, builds once if needed, and execs
  `npm run start`.

`RunAtLoad` + `KeepAlive` mean it starts at login and is respawned if it ever exits.

## Linux (systemd user service)

Create `~/.config/systemd/user/onepane.service`:

```ini
[Unit]
Description=OnePane
After=network.target

[Service]
WorkingDirectory=%h/onepane
ExecStart=/usr/bin/env bash -lc 'npm run start'
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
```

Then build once and enable it (and `loginctl enable-linger $USER` to keep it running
after you log out):

```bash
cd ~/onepane && npm run build
systemctl --user daemon-reload
systemctl --user enable --now onepane
loginctl enable-linger "$USER"
```

## Any OS (pm2)

[pm2](https://pm2.keymetrics.io/) is a cross-platform Node process manager:

```bash
npm run build
npm i -g pm2
pm2 start npm --name onepane -- run start
pm2 save
pm2 startup   # prints a command to run so pm2 resurrects on boot
```

## Production vs dev

The service runs a **production** build (`next start`), which is faster and more
stable than `next dev` and does not watch files. After you pull or make code changes,
rebuild and restart with `npm run service:rebuild`.
