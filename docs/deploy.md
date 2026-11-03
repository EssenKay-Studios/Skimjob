# Deployment (AWS Lightsail)

**Live:** https://skimjob.duckdns.org, on the owner's existing AWS Lightsail box. The box also runs another
production app, **Arcway**, which no Skimjob step may touch. Deploys are manual: build on the Mac, upload, switch
a symlink, restart. Nothing deploys on merge. Host, SSH user and key are in the owner's local `ssh-relay` skill,
never in this (public) repo. The deployed build is in `docs/STATUS.md`.

## What runs

| Piece | Where |
|---|---|
| Service | systemd unit `skimjob` (`/etc/systemd/system/skimjob.service`), system user `skimjob` (nologin), Node 22, listening on `127.0.0.1:3100` only. |
| Code | `/srv/skimjob/releases/<REL>/{server,web}` (root-owned, read-only to the app), `REL` = `YYYYMMDD-HHMMSS-<sha>`. `/srv/skimjob/current` points at the live one. |
| Settings | Non-secret ones in the unit's `Environment=` line (`NODE_ENV=production`, `HOST`, `PORT`, `PUBLIC_ORIGIN=https://skimjob.duckdns.org`, `WEB_DIR=/srv/skimjob/current/web`). Secrets (`DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, all set) in `/etc/skimjob/env`, mode 0640 root:skimjob. Never print or commit them. |
| Database | Postgres 16 on localhost: its own role and database `skimjob`. Migrations run on start and only add. |
| Proxy | nginx: its own site `/etc/nginx/sites-available/skimjob` and shared zones in `/etc/nginx/conf.d/skimjob.conf`; Let's Encrypt certificate (HTTP-01 webroot, renewed by `certbot.timer`). Arcway's `default` site stays the default server. |
| Backups | Weekly `pg_dump -Fc` (root crontab, Sundays 04:41 UTC, `/usr/local/sbin/skimjob-backup`) to `/var/backups/skimjob`, newest 8 kept; Lightsail daily snapshots cover the whole box. |
| One origin | The server serves `WEB_DIR` (hashed `/assets/*` cached a year), the API both bare and under `/api/...` (`stripApiPrefix`), and the game sockets (`/api/games/:id/ws`). Any other `GET` without a file extension gets `index.html`. Unknown `/api/...` and missing files are a JSON 404. |
| Production mode | `NODE_ENV=production`: cookies are `Secure`, the server trusts `X-Forwarded-*` (nginx overwrites `X-Forwarded-For`), the socket Origin check allows only the server's host and `PUBLIC_ORIGIN`, and the dev sign-in stub is off. |

## Deploy an update

Rules on the box: only ever `sudo nginx -t && sudo systemctl reload nginx`; never restart nginx or Postgres;
never `pm2 … all`; never touch Arcway's files, process or database.

0. **Check for games in progress** on the box, and warn their players. A restart drops sockets for a few seconds
   (clients reconnect; the scheduler catches up on deadlines that passed). A game whose log holds event types removed
   since the deployed build won't replay, so finish those first (`git log -p <deployed sha>..main --
   packages/engine/src/types/events.ts`).
   ```sh
   sudo runuser -u postgres -- psql -d skimjob -Atc \
     "select g.id, g.updated_at, count(s.*) from games g join seats s on s.game_id = g.id
      where g.status = 'running' group by g.id order by g.updated_at desc"
   ```
   A paused, bots-only smoke-test game stays in the list; ignore it (the app can't end it). There is no broadcast to players; tell the hosts of those games directly (and, from builds with #54, they can
   pause first).
1. **Build on the Mac** from a fresh clone of `main`, in a scratch folder (not `/tmp`), Node 22, pnpm 10.28:
   ```sh
   export PATH=/opt/homebrew/opt/node@22/bin:$PATH CI=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
   mkdir -p ~/Documents/Misc/.skimjob-deploy && cd ~/Documents/Misc/.skimjob-deploy
   git clone -q --branch main https://github.com/EssenKay-Studios/Skimjob.git src && cd src
   pnpm install --frozen-lockfile
   pnpm --filter @skimjob/web build && pnpm --filter @skimjob/server build
   pnpm --filter @skimjob/server deploy --prod --legacy ../out
   find -L ../out/node_modules -name '*.node'      # must print nothing (no native add-ons)
   ```
2. **Make the tarball:**
   ```sh
   REL=$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)
   mkdir -p ../pkg/$REL/server
   cp -R ../out/package.json ../out/node_modules ../pkg/$REL/server/
   cp -R apps/server/dist apps/server/migrations ../pkg/$REL/server/
   cp -R apps/web/dist ../pkg/$REL/web
   COPYFILE_DISABLE=1 tar --no-xattrs -czf ../skimjob-$REL.tgz -C ../pkg $REL
   ```
3. **Upload** with `scp` to the box's `/tmp/` (connection details: `ssh-relay` skill).
4. **Unpack** on the box (same `REL`), root-owned and read-only to the app:
   ```sh
   sudo tar --no-same-owner --no-same-permissions -xzf /tmp/skimjob-$REL.tgz -C /srv/skimjob/releases/
   rm -f /tmp/skimjob-$REL.tgz
   sudo chown -R root:root /srv/skimjob/releases/$REL
   sudo find /srv/skimjob/releases/$REL -type d -exec chmod 0755 {} +
   sudo find /srv/skimjob/releases/$REL -type f -exec chmod 0644 {} +
   ```
5. **Switch the symlink** (atomic):
   ```sh
   sudo ln -sfn /srv/skimjob/releases/$REL /srv/skimjob/current.new
   sudo mv -T /srv/skimjob/current.new /srv/skimjob/current
   ```
6. **Restart:** `sudo systemctl restart skimjob`.
7. **Verify:**
   - `curl -s localhost:3100/health` returns `{"ok":true}`;
   - `journalctl -u skimjob -n 20 --no-pager` shows `database: Postgres` (and any migrations applied);
   - from the Mac, `https://skimjob.duckdns.org/health` and `/join/smoke` return 200;
   - Arcway is still healthy and its process didn't restart (its check is in the `ssh-relay` skill).
8. **Roll back** if anything fails: point `current` at the previous release and restart. Only roll back to a release
   with the same event schema: `applyEvent` (`packages/engine/src/reduce.ts`) throws on any event type it doesn't know,
   so games logged on the newer build may fail to load on an older one (38002fd lacks #55's `policeCause` and
   `votesStolen`, and migration 008). Across a schema change, prefer fixing forward.
   ```sh
   sudo ln -sfn /srv/skimjob/releases/<previous> /srv/skimjob/current.new
   sudo mv -T /srv/skimjob/current.new /srv/skimjob/current
   sudo systemctl restart skimjob
   ```
9. **Keep the newest 3 releases** (never delete the one `current` points at):
   `ls -1d /srv/skimjob/releases/* | head -n -3 | xargs -r sudo rm -rf; readlink /srv/skimjob/current`.
10. **Clean up** on the Mac: `rm -rf ~/Documents/Misc/.skimjob-deploy`.

Logs and status: `journalctl -u skimjob -f`, `systemctl status skimjob`, `systemd-analyze security skimjob`;
nginx logs are shared with Arcway. Restore a backup: `sudo runuser -u postgres -- pg_restore --clean -d skimjob <file>`.

## Hardening (summary)
- **Service:** unprivileged `skimjob` user with no shell, password, sudo or SSH; no capabilities, `NoNewPrivileges`,
  `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`/`PrivateDevices`, kernel/cgroup/clock protections,
  `SystemCallFilter=@system-service`, `RestrictAddressFamilies` (INET, INET6, UNIX), `UMask=0077`, no writable
  paths. Limits: `MemoryMax=350M`, `MemoryHigh=300M`, `CPUQuota=100%`, `TasksMax=64`; V8 heap 256 MB.
  `systemd-analyze security` scores 1.7 (OK).
- **nginx:** TLS 1.2/1.3 only with modern ciphers; HSTS, `nosniff`, `X-Frame-Options: DENY`, a strict CSP
  (`form-action` also allows `https://accounts.google.com`), Referrer- and Permissions-Policy; `server_tokens off`;
  1 MB body limit; per-IP rate limits (auth 5 r/s, API 20 r/s, 20 connections incl. WebSockets, 429 on excess);
  `X-Forwarded-For` overwritten with the client address so it can't be spoofed.
- **Postgres:** role `skimjob` is least-privilege (no superuser, createdb, createrole or replication; 20
  connections); `CONNECT` is revoked from `PUBLIC` on both the Skimjob and Arcway databases, so neither app can
  reach the other's data.
- **Host:** port 3100 is bound to localhost; the Lightsail firewall allows 22, 80 and 443 only; a 1 GB swapfile
  (`vm.swappiness=10`). The `skimjob` user can't read Arcway's config or any TLS private key, and Arcway's user
  can't read `/etc/skimjob/env`.

## Google sign-in

Optional. Without it the landing page hides "Sign in with Google" and everyone plays with a nickname (guests);
`DEV_LOGIN=1` still gives the dev stub outside production. The server turns Google on when **both**
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set (one without the other refuses to start). The flow is
OpenID Connect, authorization code + PKCE (S256), with `state` and `nonce`; the ID token is checked against
Google's published keys (issuer, audience = the client id, expiry, nonce). Users are keyed by Google's `sub`
(`users.external_id = "google:<sub>"`); only the `openid profile` scopes are asked for (no email).

**Status:** the owner's OAuth client exists with both redirect URIs registered
(`http://localhost:5173/api/auth/google/callback` and `https://skimjob.duckdns.org/api/auth/google/callback`).
Google is **on** in production: both variables are set in `/etc/skimjob/env`.

1. Google Cloud console → APIs & Services → **OAuth consent screen**: app name "Skimjob", user type External,
   scopes `openid` and `profile`. While it's in "Testing", add the playtesters' Google accounts as test users (or
   publish it).
2. APIs & Services → **Credentials** → **OAuth client ID**, type **Web application**. The sign-in routes are
   `/api/auth/google/start` and `/api/auth/google/callback` (Vite's `/api` proxy reaches them in dev; production
   serves the same path). **Authorized redirect URIs** (Google wants an exact match):
   - Lightsail: `https://skimjob.duckdns.org/api/auth/google/callback`;
   - local `pnpm dev` (Vite on 5173): `http://localhost:5173/api/auth/google/callback`;
   - local production build on 8080 (if used): `http://localhost:8080/api/auth/google/callback`.
3. Copy the client id and secret. **Never commit them.**
   - Lightsail: `sudoedit /etc/skimjob/env` (keep it 0640 root:skimjob), add `GOOGLE_CLIENT_ID=…` and
     `GOOGLE_CLIENT_SECRET=…`, then `sudo systemctl restart skimjob`. `PUBLIC_ORIGIN` already gives the callback
     `https://skimjob.duckdns.org/api/auth/google/callback`; no `GOOGLE_REDIRECT_URL` needed.
   - Local: export them in your shell (not in a file in the repo), then `pnpm dev`:
     `GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… pnpm dev`. Outside production with no `PUBLIC_ORIGIN` the
     callback defaults to `http://localhost:5173/api/auth/google/callback`. LAN IPs don't work: Google only allows
     `http://` for `localhost`.
4. Check: the server logs `Google sign-in: on (callback …)` at boot, `GET /api/auth/providers` lists `google`,
   and the landing page shows "Sign in with Google".

`GOOGLE_REDIRECT_URL` overrides the callback (it must end in `/api/auth/google/callback`). The server still
answers the bare `/auth/google/...` paths, but Google only ever sees the `/api` one.
A guest who signs in with a Google account that's new here keeps their user, nickname and seats. Signing in to an
account that already exists switches to it and brings the guest's seats and host roles along. If the guest and the
account sit in the same game, the account keeps its own seat (and takes the host role); the guest's seat is dropped
from a lobby, and in a started game it stays as a quiet player nobody signs in as. Signed in, the landing page
lists "My games" (`GET /api/me/games`). To turn Google off, remove both variables and restart.

## Run the production build locally

```
pnpm --filter @skimjob/web build && pnpm --filter @skimjob/server build
NODE_ENV=production PORT=8080 PUBLIC_ORIGIN=http://localhost:8080 WEB_DIR=$PWD/apps/web/dist \
  PGLITE_DIR=memory node apps/server/dist/main.js
```

(Chrome treats `localhost` as secure, so the `Secure` cookie works there over plain http; a LAN IP won't — use `pnpm dev` for LAN play.)

