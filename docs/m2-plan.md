# Milestone 2 plan: playable web prototype (local only)

> **Owner update (1 Nov):** the web app is the launch product — fully responsive on phones, tablets and laptops, installable as a PWA. Every UI task (M2-5 … M2-11, M2-14) must be checked at 360, 390, 768, 1024 and 1280 px. Native apps (M3) will use Flutter. See decisions.md.

_Planner, 1 Nov 2026. Inputs: CLAUDE.md, STATUS.md, design.md §4.1/§11–§15/§17.5/§18, decisions.md, ui-style.md, engine + bots APIs._

Goal: friends on one LAN/laptop can create a game, invite people by link, fill seats with bots,
play 9 rounds with meetings, chat, and see the ledger, case file and reveal. No deployment,
no push, no mobile (M3). M1 tasks 12–16 (roles, events deck, Duel) carry on in parallel; M2
code must handle any engine event type through exhaustive switches so new types fail typecheck.

## Environment (checked here)
- **Postgres 16 binaries are installed** (`/usr/lib/postgresql/16/bin`, `psql`), cluster down.
  `initdb` + `pg_ctl` into a temp dir works, but we run as **root**, so it must run as the
  `postgres` user (`su postgres -c ...`). Verified: start, query, stop.
- **Docker:** client only, no daemon (`/var/run/docker.sock` missing). Can't use it here; fine for Karthik.
- **Registry works:** `embedded-postgres` 18.6.0-beta.19 (beta, PG 18, refuses root), `pg-mem` 3.0.14
  (partial SQL), `@electric-sql/pglite` 0.5.14 (real Postgres in WASM, in-process).
- **Playwright 1.63** global, Chromium in `/opt/pw-browsers` (`PLAYWRIGHT_BROWSERS_PATH` set,
  downloads disabled). Pin `@playwright/test@1.63.x` so it matches the installed browsers.
- Node 22.23, pnpm 10.28.
- **Google OAuth** needs a client id/secret from Karthik: build a dev-login stub behind the same interface.

## 1. Tech choices
- **Server: Fastify** (`apps/server`). Boring, typed, `inject()` makes route tests easy without a port.
- **WebSockets: `@fastify/websocket`** (wraps `ws`). Same process and cookie as HTTP; no Socket.IO.
- **DB driver: `pg`** with plain parameterised SQL behind a tiny `Db { query(sql, params) }`. No ORM.
- **Tests and zero-setup dev: PGlite** (devDependency, and the fallback when `DATABASE_URL` is unset).
  It's real Postgres, has the same `query()` shape, needs no root or daemon. Rejected `pg-mem` (partial SQL).
- **Real Postgres for `pnpm dev`:** `scripts/db.sh start|stop` (local `pg_ctl` into `.pgdata/`) plus
  a `docker-compose.yml` for Karthik's machine. One test job runs the store tests against it.
- **Migrations:** numbered `apps/server/migrations/NNN_*.sql` with a ~30-line runner and a
  `schema_migrations` table. No migration library.
- **Sessions:** random token in an httpOnly, SameSite=Lax cookie (`@fastify/cookie`); the DB stores the
  token's SHA-256. No JWT.
- **Google sign-in:** hand-written OAuth code flow (PKCE + state) with `fetch`; the id_token comes straight
  from Google's token endpoint over TLS, so no JWKS library. It sits behind
  `AuthProvider` with a `dev` provider (only when `DEV_LOGIN=1`).
- **Validation:** small hand-written checks of the message envelope; the engine already rejects bad
  commands and never throws. No zod.
- **Web: Vite + React 19 + TypeScript** (`apps/web`). Plain CSS with the ui-style.md tokens in
  `theme.css`, no Tailwind or UI kit. No router library (5 routes, switch on `location.pathname`) and no
  state library (one `useGame()` hook over the socket).
- **Art:** inline React SVG components drawn by agents per ui-style.md (2D cel-shaded look, ink outlines,
  seeded wobble). No WebGL, no image assets. Fonts Pangolin + Inter self-hosted woff2 (OFL).
- **Testing:** vitest for everything (server via `inject()` + real WS clients on PGlite; web pure helpers);
  **one Playwright E2E** (`apps/e2e`): two browser contexts plus bots play a short game to the reveal.
- **Clock:** the server owns time through an injected `Clock` (real or fake), so scheduler tests are instant.

## 2. Tasks

**Server rules for every task:** `command.player` always comes from the session's seat, never the
client. Rejection reasons go only to the sender. A client only ever receives its own `viewFor()`
(never the raw log, the seed, or full-log indexes). Commands for a game run one at a time (per-game
async lock, single process). Never send `seq` outside its owner's view (evidence cards).

### M2-1 Server skeleton and game store (M)
- `apps/server`: Fastify app factory `buildServer({ db, clock, auth })`, `/health`, config from env.
- `Db` interface; `pg` and PGlite adapters; migration runner; `scripts/db.sh`; `docker-compose.yml`.
- Tables: `users`, `sessions`, `games` (status lobby/running/ended, settings jsonb, config jsonb,
  invite code, host), `seats` (player id, user id or null for bots, nickname, bot personality,
  last-seen seq), `game_events` (game id, idx, event jsonb), `deadlines`.
- `GameStore`: create, append events in one transaction, load = `replay(events)`; in-memory cache.
- Refs: §17.2, §17.5. **Accept:** a bot game from `runBotGame` saved event by event and reloaded gives
  an identical state; migrations are idempotent; tests run on PGlite and (if `DATABASE_URL`) real PG.

### M2-2 Identity, invites and lobby API (M)
- `AuthProvider` interface; guest sign-in = invite link + nickname (creates a guest user + session);
  `dev` provider stub for "Sign in with Google" when no client id is set.
- Routes: create game (host picks settings: session length, vote visibility, Mole, starter mode, DM
  notices on/off), get lobby, join by invite code, leave, add/remove bot (personality), start.
- Start: server makes player ids (`/^[A-Za-z0-9_-]{1,32}$/`), seed from `crypto.randomBytes`,
  `GameConfig`, `validateConfig`, `createGame`, then persists.
- Refs: §15 setup, §16, STATUS "Player ids". **Accept:** 2–12 seats enforced; only the host can
  start/add bots; a used or unknown invite code is a clean 4xx; nicknames are free text, ids aren't.

### M2-3 Live game channel and server bots (M)
- `GET /games/:id/ws` authenticated by cookie; maps the session to the seat.
- Client → `{ cmd }` with any `player` field overwritten; reply `{ ok }` or `{ rejected, reason }` to that
  socket only. After each change, push every connected seat its fresh `viewFor` (whole view; small).
- Bot seats: `createBot` agents run after each change (and after deadlines) through the same command path.
- Refs: §17.2, §17.3, STATUS M2 notes. **Accept:** a forged `player` acts as the sender; a test plays
  a full game over sockets and checks each socket only ever got events `canSee` allows it; bots make no
  refused commands.

### M2-4 Scheduler and elastic timing (M)
- Session-length presets → round length and meeting window (§4.1 table) plus a **"Quick (15 min)"** preset for
  playtests and tests; numbers in one config module.
- Deadlines persisted in `deadlines`; a 1 s tick sends due `advance { kind: "round", round }`,
  `openMeeting`, `closeMeeting`; `scheduleMeeting` at the act deadline if nobody locked a slot; re-send
  `openMeeting` after the act's last round / after another meeting closes (STATUS notes); emergency notice
  period; rounds paused while a meeting is open.
- Refs: §4.1, §11.1. **Accept:** with a fake clock an all-bot game finishes in every vote mode; killing and
  rebuilding the server mid-round resumes from the DB without a double or skipped deadline.

### M2-5 Web shell, style foundation, lobby screens (M)
- `apps/web` Vite app, dev proxy to the server; `theme.css` tokens (ui-style §2), fonts, `<SketchFrame>`
  (seeded wobbly SVG border, hatched shadow, tape), buttons (§5), blob avatars with initials.
- Screens: landing (create game / sign in), invite page (nickname), lobby (seats, bots, settings, start).
- Refs: ui-style §1–§5, §10. **Accept:** create → copy invite link → second browser joins → host adds
  bots → start lands both on the game route; works at 390 px and 1280 px.

### M2-6 Game screen thin slice (M) — first playable build
- HUD: round/act, phase, countdown, Haul vs next target, Heat number; seats with "move submitted" marks.
- Move panel: room list (loot, Heat hint), split slider, Lock it in; default move shown if missed.
- Alibi button; plain ledger and case-file lists; a one-line text for every event type (exhaustive switch,
  in a pure `describeEvent()` with tests); game-over panel with the ranking.
- Playwright E2E (`apps/e2e`): host + one guest + bots play a Quick game to the end and see the ledger.
- Refs: §5, §5.4, §13. **Accept:** a human can finish a game against bots in the browser; E2E green.

### M2-7 Meetings and voting UI (M)
- Propose a slot (time picker → ISO slot), accept proposals, see the locked slot; emergency button (one per game).
- Vote dialog: shakedown target or skip, change until close, sealed vote; tallies per vote-visibility mode.
- Shakedown result, clean compensation and checkpoint made/missed shown in the ledger and as a banner.
- Refs: §11.1–§11.5, ui-style "Vote window". **Accept:** Hidden/Open/Secret each show only what the mode
  allows (test against the view); E2E extended with one vote.

### M2-8 Chat: crew, DMs, evidence cards (M)
- Server-side only (not engine events): `chat_messages` table; crew chat; DMs delivered to the two players;
  others get a `dmNotice { from, to, at }` when the host setting is on (default on). Length and rate limits.
- Evidence card: the player names an entry of **their own** case file; the server re-reads it from their
  `viewFor`, copies `type` + payload **without `seq`**, marks it verified. Typed claims stay unverified.
- Chat feed UI (ui-style "Chat"), unread badge; game events inline as small toasts.
- Refs: §12.1, §12.2. **Accept:** tests: a DM never reaches a third socket (only the notice); notices off
  sends nothing; a forged or someone else's case-file entry is refused; a shared card has no `seq`.

### M2-9 Art: bank cutaway, room icons, avatars (L)
- SVG cutaway of First National Bank (Rooftop / Security + Office / Lobby / Vault, extra rooms as wings
  when in play), room icons, masked crew figures and avatars, drawn by agents in the ui-style look.
- Rooms are the move picker's hit areas (hover lift, selected pin). Heat thermometer and Haul meter.
  Time of day follows the round (day → night); Heat tints the sky.
- The board shows **only what the view knows**: your own room and who you saw there; claimed rooms from
  alibis are marked as claims. Never infer others' positions.
- Refs: §18, ui-style "Applying this to Skimjob". **Accept:** every room in `BANK_JOB` has art; a view-only
  test confirms figures come from the case file/alibis; reduced-motion respected.

### M2-10 Ledger, case file and "While you were away" (M)
- Manila case-file sheet: public rows, private rows with lock/highlighter, rounds grouped.
- Recap: per-seat last-seen seq stored server-side; `recap(eventsSince(view, lastSeen))` → 2–4 lines, pure and
  tested; marked seen when dismissed.
- Suspicion board: private trusted/unsure/suspicious tag + note per player, stored per seat.
- Refs: §12.3, §13. **Accept:** recap tests for a quiet round, a meeting, a shakedown and a checkpoint; the
  board is never sent to anyone else.

### M2-11 End-of-game reveal (M)
- Stamp (JOB DONE / BUSTED), ranking podium (roles, stash, safe, score, winners; VOID wash on failure).
- Timeline scrub round by round from `reveal.log`: real rooms and splits, stash over time, abilities.
- Refs: §3, §13, ui-style "End-of-game reveal". **Accept:** all three endings render; Secret-mode ballots
  stay hidden; the timeline matches the log for a seeded game.

### M2-12 Google sign-in (S, needs Karthik's client id)
- `google` `AuthProvider`: code flow with PKCE and state, `GOOGLE_CLIENT_ID/SECRET`, redirect
  `http://localhost:<port>/auth/google/callback`; user keyed by `sub`; "My games" list.
- A guest who signs in keeps their seats (link the guest user). Dev stub stays for tests.
- Refs: owner decision. **Accept:** stub and real provider share one test suite (real one mocked at fetch);
  bad state/nonce refused.

### M2-13 Host controls and resilience (M)
- Host: pause/resume (shifts all deadlines), extend the current round, kick in lobby, replace an inactive
  player with a bot (offered after 2 missed rounds in a row) and hand the seat back.
- Reconnect with backoff; stale tab refresh; "game not found / not your game" pages; quiet hours deferred to M3
  (they gate notifications).
- Refs: §15, §4.1. **Accept:** tests for pause across a deadline, extend, and replace/return; E2E survives a reload.

### M2-14 Playtest pass (M)
- `docs/playtest.md`: how to run locally (`pnpm dev`, LAN URL for phones), presets, known limits.
- Play Quick and 1-hour games with 3 contexts + bots; fix what breaks; a "report a problem" link that copies
  game id, round and client version (never the seed before the end).
- Update STATUS.md (M2 done, findings, M3 next), decisions.md for every choice made in M2.
- **Accept:** a 1-hour game with 2 humans + 4 bots completes without a server error; all tests, typecheck, E2E green.

Order rationale: 1–4 give a working server playable by bots; 5–6 make it playable by people (thin slice);
7–8 add the social layer; 9–11 are look and payoff; 12 waits on Karthik; 13–14 harden for a real playtest.

## 3. Questions for Karthik
1. **Google OAuth client id/secret** (Web application, redirect `http://localhost:5173/auth/google/callback`
   and your LAN IP if phones join). *Default:* dev-login stub until provided; M2-12 runs last.
2. **Local Postgres on your machine:** Docker or a native install? *Default:* `docker-compose.yml` for you;
   PGlite fallback when `DATABASE_URL` is unset, so `pnpm dev` works with nothing installed.
3. **Playtest presets:** OK to add a "Quick (15 min)" preset (about 1.5 min rounds, 2 min meetings) next to the
   §4.1 lengths? *Default:* yes, playtest/dev only.
4. **Guests:** may guests (nickname only, no Google) host games, or only join? *Default:* anyone can host.
5. **Bot names:** themed names ("Bot · Riya") with a visible bot badge? *Default:* yes, always marked as bots.
6. **Mascot** for the recap narrator (ui-style suggests a masked raccoon). *Default:* masked raccoon.
