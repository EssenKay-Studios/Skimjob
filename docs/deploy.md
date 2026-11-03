# Deployment (Fly.io)

**Not live; deploys are manual-only** until the owner picks a host (Fly or Lightsail; decision 10A). Nothing
deploys on merge. The Fly setup below is ready: running the workflow by hand deploys app `skimjob`, region `bom`
(Mumbai), one machine, at https://skimjob.fly.dev.

For playtests the deployment is as small as it can be: one Fly machine (shared-cpu-1x, 512 MB) runs the game
server, which also serves the built web app, and keeps its database (PGlite, real Postgres compiled to WASM,
in-process) on a 1 GB Fly volume. No separate database yet. The `pg` path still works: set `DATABASE_URL` and
the same server uses real Postgres instead (below).

## How a deploy happens

1. Push or merge to `main`.
2. `.github/workflows/ci.yml` runs (typecheck, tests, e2e, sim smoke, and a Docker image build that boots the
   image and checks `/health` and an SPA route). It doesn't deploy.
3. To deploy, run the workflow by hand: GitHub → Actions → **Deploy** → Run workflow (`.github/workflows/deploy.yml`,
   `workflow_dispatch` only). It runs only on `main` and only if CI passed for that commit (a push run; the job
   checks through the Actions API and stops otherwise). Then it deploys that commit:
   - installs `flyctl` (`superfly/flyctl-actions/setup-flyctl`) and uses the `FLY_API_TOKEN` repo secret;
   - creates the app if it's missing (`flyctl apps create skimjob --org personal`, "already exists" is fine);
   - creates the volume `skimjob_data` (1 GB, `bom`) if it's missing;
   - `flyctl deploy --remote-only --ha=false` (Fly's builders build the `Dockerfile`; `--ha=false` keeps it to
     one machine, because PGlite lives on one volume);
   - smoke-tests `https://skimjob.fly.dev/health` and `/join/smoke`.

`FLY_API_TOKEN` is given only to the flyctl steps, never job-wide, and the third-party actions
(`actions/checkout`, `superfly/flyctl-actions/setup-flyctl`) are pinned to full commit SHAs; bump them by hand.

Deploys run one at a time (`concurrency: deploy-fly`). Each deploy stops the old machine and starts the new one
on the same volume, so there are ~10–30 s of downtime. Open sockets drop (clients have to reconnect);
the scheduler catches up on boot, so a deadline that passed during the gap fires right after.

Repo variables (Settings → Secrets and variables → Actions → **Variables**) override the defaults:
`FLY_APP` (if `skimjob` were ever taken, pick a free name; the URL becomes `https://<name>.fly.dev` and
`PUBLIC_ORIGIN` follows it) and `FLY_ORG` (default `personal`).

## What runs

| Piece | Where |
|---|---|
| Image | `Dockerfile`: build stage (`node:22-bookworm-slim`, pnpm 10.28) runs `pnpm fetch`, `pnpm install --offline --frozen-lockfile`, `vite build` (web), `esbuild` (server → one `dist/main.js`, workspace packages inlined), `pnpm deploy --prod` (prod `node_modules` only). Runtime stage is `node:22-alpine` with just those. |
| User | The entrypoint (`apps/server/docker-entrypoint.sh`) starts as root only to create `/data/pglite` and `chown` it to `node` (a fresh Fly volume is root-owned), then `su-exec`s the server as `node` (uid 1000). |
| Config | `fly.toml` `[env]`: `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=8080`, `PUBLIC_ORIGIN=https://skimjob.fly.dev`, `WEB_DIR=/app/web`, `PGLITE_DIR=/data/pglite`. Secrets (none yet) go in `fly secrets set`. |
| One origin | The server serves `WEB_DIR` (hashed `/assets/*` cached a year, everything else revalidated), the API both bare and under `/api/...` (the client's prefix, `stripApiPrefix`), and the game sockets (`/api/games/:id/ws`). Any other `GET` without a file extension gets `index.html` (client routes like `/join/:code`, `/lobby/:id`, `/game/:id`). Unknown `/api/...` and missing files are a JSON 404. |
| Production mode | `NODE_ENV=production`: cookies are `Secure`, the server trusts Fly's `X-Forwarded-*`, the socket Origin check allows the server's own host and `PUBLIC_ORIGIN` only (no Vite dev origins), and the dev sign-in stub is off even if `DEV_LOGIN=1` is set. |
| Health | Fly checks `GET /health` every 30 s (it runs `select 1`). |
| Always on | `min_machines_running = 1`: the scheduler only ticks while the machine runs, so round and meeting deadlines would otherwise fire late (on the next visit, when Fly wakes it). Set it to 0 to save money if games are idle for days; the server catches up on boot. |
| Memory | PGlite is tuned for the small machine (`PGLITE_CONF` in `apps/server/src/db.ts`: 16 MB shared buffers, 64 MB WAL cap): ~175–250 MB steady. The very first boot on a fresh volume runs `initdb` and peaks at ~600–700 MB; `swap_size_mb = 512` covers that once. |

URLs: https://skimjob.fly.dev (game), https://skimjob.fly.dev/health, dashboard https://fly.io/apps/skimjob,
logs `flyctl logs -a skimjob`.

## Run the production build locally

```
pnpm --filter @skimjob/web build && pnpm --filter @skimjob/server build
NODE_ENV=production PORT=8080 PUBLIC_ORIGIN=http://localhost:8080 WEB_DIR=$PWD/apps/web/dist \
  PGLITE_DIR=/tmp/skimjob-pglite node apps/server/dist/main.js
```

Or with Docker: `docker build -t skimjob . && docker run --rm -p 8080:8080 -v skimjob-data:/data -e PUBLIC_ORIGIN=http://localhost:8080 skimjob`.
(Chrome treats `localhost` as secure, so the `Secure` cookie works there over plain http; a LAN IP won't — use `pnpm dev` for LAN play.)

## Roll back

- **Quickest:** `flyctl releases -a skimjob --image` lists releases with their image; redeploy an older one with
  `flyctl deploy -a skimjob --image registry.fly.io/skimjob:deployment-<id> --ha=false`.
- **Through git:** revert the bad commit on `main` (`git revert <sha>`, push). CI runs; then run Deploy by hand (Actions → Deploy → Run workflow).
- Database migrations only add (see `apps/server/migrations/`); an older image runs fine on a newer schema as
  long as that stays true. If a migration ever has to change or drop something, note the rollback in its PR.
- **Data:** Fly snapshots volumes daily (kept 5 days). `flyctl volumes snapshots list <volume-id>` and
  `flyctl volumes create skimjob_data --snapshot-id <id> -r bom` restore one onto a new volume (then destroy
  the old volume so the machine picks up the new one).

## Switch to managed Postgres later

1. Create a database (Fly Managed Postgres in `bom`, or any Postgres 16+) and get its connection string.
2. `flyctl secrets set -a skimjob DATABASE_URL='postgres://…'` — this restarts the machine; on boot the server
   sees `DATABASE_URL`, connects with `pg` and runs the migrations. `PGLITE_DIR` is then ignored.
3. PGlite data does not move by itself. If the playtest games matter, copy them first: stop traffic,
   `flyctl ssh console -a skimjob`, dump the tables from PGlite (e.g. a small script with
   `@electric-sql/pglite`'s `dumpDataDir` or `COPY … TO STDOUT`) and load them into the new database.
4. With real Postgres the machine no longer needs the volume, so you can run more than one machine — but the
   server still assumes **one process** (per-game lock, scheduler tick), so keep it to one until that changes.
   Then remove `[mounts]` from `fly.toml` and destroy the volume.

## Cost (Fly pricing, Nov 2026; check https://fly.io/docs/about/pricing/)

- Machine: shared-cpu-1x 512 MB running all month is $3.69 in the cheapest regions; Mumbai is somewhat more
  (regional pricing), so expect roughly **$4–5/month**.
- Volume: 1 GB × $0.15 = **$0.15/month** (billed while it exists, even with the machine stopped).
- Snapshots: first 10 GB free. Shared IPv4/IPv6 and the `*.fly.dev` certificate are free; no dedicated IPv4.
- Traffic: playtests send very little (one small JSON view per change per player); outbound from India is
  $0.12/GB on granular pricing, so cents.
- Fly has no free tier for new organisations: the org needs a card.
- Saving: `min_machines_running = 0` stops the machine when nobody's connected (pay only for running time and
  the volume), at the price of late deadlines (see "Always on").
