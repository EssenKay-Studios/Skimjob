# Decisions

The decisions that hold today, one short entry each with its why, grouped by topic. Each is **confirmed** (the owner decided or accepted it) or **provisional** (a PM or builder call, owner to confirm; STATUS "Questions for the owner" lists them). The rules are `docs/simplified.md` Part A until S1 makes `docs/design.md` the single spec; this file records the choices behind them.

Update in place: change or delete an entry when a decision changes; never add "was X" notes. History lives in git and `docs/archive/decisions-history.md`.

## Architecture and engine

- **One pnpm monorepo** (engine, content, bots, sim, server, web) so rule changes and their callers land together. *Confirmed.*
- **The engine is pure, deterministic and event-sourced:** seeded RNG only, no clock, state = fold over the log, content as data. It enables replays, the reveal, recaps, fair bots and mass simulation. *Confirmed.*
- **Visibility is fixed per event type in the type system** (`public`, `private`, `reveal`, `secret`). Private and reveal events open at the end of the game; `secret` (Secret-mode ballots) never does. The seed is only in a reveal-only `rngSeeded`. *Confirmed.*
- **`viewFor()` returns a deep copy, and a view's `seq` counts only what that player can see**, so nothing a client or bot holds can change the game or count hidden events. *Confirmed.*
- **Bots are players:** they get only `viewFor()`, emit normal commands, use their own seeded RNG (never the game seed) and rebuild suspicion from the view each time. Personalities are parameter sets in `packages/bots`, not content. *Confirmed.*
- **`GameConfig` holds only settings that change the rules;** session length, deadlines, pauses and bot replacement are the server's. Only resting phases are modelled; `advance` names the deadline that passed. *Confirmed.*
- **Player ids** match `/^[A-Za-z0-9_-]{1,32}$/` and are never `__proto__`/`constructor`/`prototype` (they are record keys). *Confirmed.*
- **Commands are untrusted JSON:** refusal reasons print values with `show()` (never throws, cuts long strings); a meeting slot is at most 64 characters. *Confirmed.*
- **Content overrides** replace numbers only, validated as untrusted JSON; they can't add rooms or roles. `gameCreated` carries the content version and overrides. *Confirmed.*
- **No new runtime dependencies in the engine** without an entry here; `fast-check` is a test-only devDependency. *Confirmed.*

## R7 rules (agreed with the owner, 4 Nov 2026)

Full text: `docs/simplified.md` Part A (section numbers below). Numbers marked [tunable] there are simulator starting values. *All confirmed* unless marked provisional.

- **Design principle:** no role is good or evil and nothing pays anyone to be nice. Every player faces the same temptation (hand in or pocket); the crew's attitude decides how well everyone does. Roles are tools; perks are for the buyer.
- **A1, a round:** pick a room, grab 1 coin up to its limit (fewer coins, less noise), split the coins in secret between the crew duffel and your pocket, lock in. A missed move is the Lobby, 1 coin, handed in. Rooms with player-count minimums: Deposit boxes and Server room 5+, Manager's office 9+.
- **A2, bells, raids, Wanted:** every room has a public 4-bulb alarm bell (except a room the Hacker hides) that coins light up as they ring. The 4th bulb raids the room: the visitors' grabs are seized, the room is taped off for 2 rounds, Wanted +1, a police briefing follows. Wanted 3 is a bust. Cooling: every room −1, then each Rooftop player cools the hottest room by 1. No room has a visitor limit (it would leak secret moves and reward fast lock-ins).
- **A3, the bank:** about 16 coins per player. The game ends when the bank is empty, at a round cap of about 12, or on a bust; the host's session length is divided by the round cap.
- **A4, equal shares:** each round the crew take (hand-ins, shakedown and Priest returns, the kitty) is split equally; the remainder stays on the table as the kitty and pays for the getaway car at the end. The fair share and "N coins went missing" are public, never who. Stashes are private.
- **A5, honesty and winning:** honesty = crew take ÷ coins taken. Below two-thirds at the end the heist fails (sunk by theft: nobody wins, except a Mole or Fixer holding the biggest stash). Otherwise the biggest stash wins; if nobody stole, the whole crew wins together. On a bust only the players on the Rooftop that round escape and the biggest stash among them wins; if nobody was up there, nobody wins. Ties go to fewer shakedowns, then share.
- **A6, meetings:** a regular meeting each time a third of the bank is gone (only these recharge "once between meetings" powers), a police briefing after every raid, one emergency per player. A shakedown opens the target's stash and puts whatever is above the fair share back on the table; coins already spent on perks are not taken.
- **A7, the plan board:** a shared board per round with pledges; nothing is binding. Only the per-round snapshot goes into the game log, as evidence.
- **A8, roles are tools:** about 5-7 roles per game from Lookout, Locksmith, Detective, Auditor, Smooth Talker, Hacker, Electrician, Priest, Mole, Fixer; every role is dealt at random, balanced between eyes (spot theft) and shadows (make it possible). Frequency rule: narrowing suspicion is every round, proving theft or opening blind spots is once between meetings, a big swing is once per game. Cleaner, Bagman and Muscle are cut (with one winner, nobody has a reason to protect anyone else).
- **A9, the black market:** no tokens. Perks cost coins from your own stash, which leave the game; one perk per tier per game (3 items), one purchase per player per round, each single-use, every purchase logged without a name. Laundering is allowed.
- **A10, what goes away from R6:** tokens, the R6 shop and role list, temperament tags, acts and checkpoint targets, fixed 9 rounds, Heat 0-100 and hidden police moments, the gap box, the clean line and payout (6/8).
- **A11, also decided:** the event deck is Lockdown, Shift change, Audit and Inside tip, with a 4-in-10 chance of a card from round 2. Duel is removed (3+ players, bots fill seats). "Learn the game" replaces Quick: single-player, about 5 minutes, scripted, its own PR in S4. The Server room is an ordinary 2-coin room. The Mole and Fixer are dealt like any role.
- **A12, seams for Skimjob Advanced:** R7 builds ten seams (facts public by content, generic trust levels, rulesets as content, registries by id, one "said" event, bots read `viewFor` only, per-role holder/result settings, deal counts from content, roles held by event, motions by id), and no stub code. Advanced only adds (`docs/advanced.md` "Additive only").

### Owner decisions, 4 Nov

- **Raid seizure happens before the split:** seized coins are never pocketed or handed in, so stash = fair share received + coins pocketed − coins taken back by shakedowns and the Priest − coins spent on perks. *Confirmed (owner, 4 Nov).*
- **End-of-round order:** moves resolve → rings light bulbs → raid check (4th bulb: seize that room's grabs, tape 2 rounds, Wanted +1) → bust check (Wanted 3: the game ends at once, that round's duffel is not split, escapees keep only the stash they already had, the biggest among them wins) → split of the duffel and kitty (only if no bust) → cooling (−1 every room, then each Rooftop player cools the hottest). Raids come before cooling, so the Rooftop can't save a room in the same round and the bell preview stays exact. A police briefing follows a raid. *Confirmed (owner, 4 Nov).*
- **Every bell is always visible,** except a room the Hacker hides. **Loot stays "coins".** **Books mode is dropped** (superseded by Skimjob Advanced). *Confirmed (owner, 4 Nov).*

### Provisional readings (PM, 4 Nov), owner to confirm

- **Crew take and honesty:** the kitty carry-over is counted once, in the round it was handed in, not again when re-split. Seized coins count neither as "taken" nor as "missing". Shakedown and Priest returns raise the crew take, and so honesty. "N coins went missing" = coins taken (excluding seized) − coins handed in that round, never negative.
- **Advanced drops the Inside tip card** (roles are public there), leaving three event cards (`docs/advanced.md`).

## Balance

- **Targets are set in S1 and tuned once in S5** on the Sim suite workflow, never babysat in chat: heist success, raid and bust rates and Rooftop stalls, each role's win rate within a band, the share of all-honest wins, perks not deciding games. `docs/balance/baseline.json` is the comparison baseline; re-run after any rule, number or bot change. *Confirmed.*
- **A check passes or fails only when its whole 95% interval is in or out of the target;** otherwise it is inconclusive. *Confirmed.*

## Social layer

- **Votes:** group-scheduled live windows; sealed votes for absentees; hidden while voting and revealed after by default (prevents bandwagoning). The Check ballot perk works in Secret mode (the one exception to secret ballots). *Confirmed.*
- **A meeting slot locks once more than half of the human seats back it;** bots only back, never propose. *Confirmed.*
- **Lock-in marks and presence are public** (who has locked in, never what; online dot and last seen). **Rounds end early once everyone has locked in,** after a short grace set once per preset. *Confirmed;* grace lengths per preset (1h 10 s, 3h 30 s, 1d 2 min, 3d 5 min, 1w 5 min) *provisional*.
- **Discussion can happen anywhere** (in-app chat and DMs, WhatsApp, in person); verified evidence cards keep facts trustworthy. Secret-mode ballots are never shareable. *Confirmed.*
- **No player elimination;** getting caught costs coins, never the seat (essential for week-long games). *Confirmed.*

## Server and timing

- **Node + Fastify + Postgres (`pg`), PGlite** for tests and zero-setup dev; plain SQL, add-only numbered migrations, no ORM. Replay inputs are `json`, not `jsonb` (key order must survive). *Confirmed.*
- **One server process** (per-game lock, in-memory rate limits, scheduler). *Confirmed.*
- **Sign-in:** invite link + nickname (guests may host), plus Google for a persistent identity (on when both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set). *Confirmed.* Provisional, owner to confirm (#53): the redirect URI from env (`GOOGLE_REDIRECT_URL`, else `PUBLIC_ORIGIN` + `/api/auth/google/callback`), never the Host header; the account's seat is kept on a same-game clash; display name `name` → `given_name` → "Crook"; scopes `openid profile` (no email); `prompt=select_account`.
- **Scheduler reconciles, never schedules by events:** `planDeadlines` lists what the state calls for, one rule per kind in `DEADLINE_RULES`; a restart changes no due time; refused deadlines are dropped, other failures retried with backoff. *Confirmed.*
- **No timing leaks:** a view is pushed only when it changed; bots act only when their own view changed. *Confirmed.*
- **Preset timings** (1 hour to 1 week) and the auto-meeting presets are server data; tune after playtests. *Confirmed.*
- **Host controls** (#54), provisional, owner to confirm: players can still act while paused (only the clocks stop); Extend per preset (1h 2 min, 3h 5 min, 1d 30 min, 3d 1 h, 1w 2 h), no cap; replace a seat with a bot only after 2 missed rounds in a row, never the host's seat, default Opportunist, handed back by the host or the seat's player; lobby kick of any non-host seat.
- **Notes** (case-board seen marks, suspicion board) live outside the engine log, over REST (`apps/server/src/notes.ts`), if that code survives the C and S4 clean-up. *Provisional.*
- **Chat** is server-only, plain text, random UUID ids, 500 characters, 8 per 10 s; DM notices on by default; bots don't chat. *Confirmed.*
- **One origin:** the server serves the built web app, the API (a leading `/api` is stripped) and the sockets, so a client route must not equal an API `GET` route. `NODE_ENV=production` means secure cookies, trusted proxy and no dev stub. *Confirmed.*

## Web and UI

- **Web-first launch:** the browser app is the product, responsive from 360 to 1280 px, ≥ 44 px targets for mouse and touch, no hover-only interaction, safe-area insets, installable as a PWA. Native apps come later in **Flutter** as thin clients. *Confirmed.*
- **One look everywhere:** the hand-drawn notebook style (`docs/ui-style.md`) from the shared kit and `theme.css` tokens only; style from CityRT, never its logo, name or art. *Confirmed.*
- **React + Vite, no router, state or UI library;** committed woff2 fonts (Pangolin, Inter); our own sketch-frame generator; `/dev/gallery` shows every component and is dev-only. *Confirmed.*
- **Art:** our own SVG bank cutaway in side view, stacked layout on phones, gumdrop crooks. *Confirmed.*
- **The web app imports engine and content for types, names and numbers only;** no game logic runs in the browser beyond reading the view. *Confirmed.*
- **Part B presentation** (one screen, info on everything, "This game" rulebook, the case board with trust levels and ⚠ flags, Tips on by default per user) is agreed in `docs/simplified.md` Part B; mockups in S2 need the owner's approval. *Confirmed.*

## Ops and deploy

- **Hosting: AWS Lightsail,** https://skimjob.duckdns.org, on the owner's box beside Arcway, which no Skimjob step may touch. systemd service, releases with a `current` symlink, nginx, Postgres, weekly `pg_dump`. Built on the Mac and uploaded by hand; nothing deploys from CI. Runbook: `docs/deploy.md`. *Confirmed.*
- **The repo is public,** so nothing secret or connection detail is ever committed. *Confirmed.*
- **CI:** typecheck and tests, 6 e2e shards (with a fast-clock server), sim smoke; docs-only PRs (every path `*.md`) skip e2e and sim smoke. The scoped test setup comes in step C3. *Confirmed.*
- **R7 is built straight on `main`** with no integration branch, flags or kept R6 path; the live game has no real players. Replace, don't add; docs say only what is true now; no placeholders for Advanced. *Confirmed.*
- **Out of scope for R7:** Skimjob Advanced (`docs/advanced.md`, additive only), the recruited Mole, M3 and M4, the parked M2-14 and M2-15. *Confirmed.*

## Pipeline and git

- **Everything goes through a PR; only the PM merges,** with `docs/pipeline/merge.sh` once the SHA-bound gate (`verdicts.sh`) passes: an APPROVE review naming the reviewed head, a QA PASS naming the current head, only QA-test commits after the review, green CI, a clean merge state, clean authorship. Any API error fails closed. *Confirmed.*
- **The gate scripts use only the GitHub REST API** (`gh api`), so the pipeline runs from the Mac and from cloud sessions where GraphQL is blocked. *Confirmed.*
- **Commits are authored as karthik24iyer <karthik24iyer@gmail.com>, with no AI attribution lines;** the gate refuses them. *Confirmed.*
- **Builders and QA don't edit STATUS or this file;** they put `## Decisions` and `## STATUS updates` in the PR body and the PM folds them in. *Confirmed.*
- **Testing speed:** run only the specs you touched, push once, let CI run the full suite; never skip or disable a test. *Confirmed.*
