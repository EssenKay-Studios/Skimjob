# Decisions

The decisions that hold today, one short entry each with its why, grouped by topic. Each is **confirmed** (the owner decided or accepted it) or **provisional** (a PM or builder call, owner to confirm; open questions are GitHub issues labelled `owner-decision`). The rules are `docs/design.md`, the single spec; this file records the choices behind them.

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

Full text: `docs/design.md` (the rules spec, frozen in S1); the A-numbers below are the plan's sections in `docs/simplified.md` Part A. Numbers marked [tunable] are simulator starting values. *All confirmed* unless marked provisional.

- **Design principle:** no role is good or evil and nothing pays anyone to be nice. Every player faces the same temptation (hand in or pocket); the crew's attitude decides how well everyone does. Roles are tools; perks are for the buyer.
- **A1, a round:** pick a room, grab 1 coin up to its limit (fewer coins, less noise), split the coins in secret between the crew duffel and your pocket, lock in. A missed move is the Lobby, 1 coin, handed in. Rooms with player-count minimums: Deposit boxes and Server room 5+, Manager's office 9+.
- **A2, bells, raids, Wanted:** every room has a public 4-bulb alarm bell (except a room the Hacker hides, and a taped-off room, whose bell is off: *provisional*, see below) that coins light up as they ring. The 4th bulb raids the room: the visitors' grabs are seized, the room is taped off for 2 rounds, Wanted +1, a police briefing follows. Wanted 3 is a bust. Cooling: every room −1, then each Rooftop player cools the hottest room by 1. No room has a visitor limit (it would leak secret moves and reward fast lock-ins).
- **A3, the bank:** about 16 coins per player. The game ends when the bank is empty, at a round cap of about 12, or on a bust; the host's session length is divided by the round cap.
- **A4, equal shares:** each round the duffel (hand-ins, the kitty, and shakedown and Priest returns set aside since the last split) is split equally; the leftover change is the kitty, carried into the next split, and at the end the kitty and any unsplit duffel pay for the getaway car. The share and "N coins went missing" are public, never who. Stashes are private.
- **A5, honesty and winning:** honesty = coins that reached the duffel ÷ coins taken (a coin counts once: see "Honesty" below). Below two-thirds at the end the heist fails (sunk by theft: nobody wins, except a Mole or Fixer holding the biggest stash). Otherwise the biggest stash wins; if every stash is equal, the whole crew wins together. On a bust only the players on the Rooftop that round escape and the biggest stash among them wins; if nobody was up there, nobody wins. Everyone tied at the top wins (see "Owner decisions, 6 Nov").
- **A6, meetings:** a regular meeting each time a third of the bank is gone (only these recharge "once between meetings" powers), a police briefing after every raid, emergencies from a crew pool (see "Owner decisions, 6 Nov"). A shakedown opens the target's stash and sets whatever is above the share aside in the duffel for the next split; coins already spent on perks are not taken.
- **A7, the plan board:** a shared board per round with pledges; nothing is binding. Only the per-round snapshot goes into the game log, as evidence.
- **A8, roles are tools:** every player gets a role (see "Owner decisions, 6 Nov"), from Lookout, Locksmith, Detective, Auditor, Smooth Talker, Hacker, Electrician, Priest, Mole, Fixer; every role is dealt at random, balanced between eyes (spot theft) and shadows (make it possible). Frequency rule: narrowing suspicion is every round, proving theft or opening blind spots is once between meetings, a big swing is once per game. Cleaner, Bagman and Muscle are cut (with one winner, nobody has a reason to protect anyone else).
- **A9, the black market:** no tokens. Perks cost coins from your own stash, which leave the game; one perk per tier per game (3 items), one purchase per player per round, each single-use, every purchase logged without a name. Laundering is allowed.
- **A10, what goes away from R6:** tokens, the R6 shop and role list, temperament tags, acts and checkpoint targets, fixed 9 rounds, Heat 0-100 and hidden police moments, the gap box, the clean line and payout (6/8).
- **A11, also decided:** the event deck is Lockdown, Shift change, Audit and Inside tip, with a 4-in-10 chance of a card from round 2 (drawn at random every time, see "Owner decisions, 6 Nov"); the host can turn events off. Duel is removed (3+ players, bots fill seats). "Learn the game" replaces Quick: single-player, about 5 minutes, scripted, its own PR in S4. The Server room is an ordinary 2-coin room. The Mole and Fixer are dealt like any role.
- **A12, seams for Skimjob Advanced:** R7 builds ten seams (facts public by content, generic trust levels, rulesets as content, registries by id, one "said" event, bots read `viewFor` only, per-role holder/result settings, deal counts from content, roles held by event, motions by id), and no stub code. Advanced only adds (`docs/advanced.md` "Additive only").

### Owner decisions, 4 Nov

- **Raid seizure happens before the split:** seized coins are never pocketed or handed in, so stash = share received + coins pocketed − coins taken back by shakedowns and the Priest − coins spent on perks. *Confirmed (owner, 4 Nov).*
- **End-of-round order:** moves resolve → rings light bulbs → raid check (4th bulb: seize that room's grabs, tape 2 rounds, Wanted +1) → bust check (Wanted 3: the game ends at once, that round's duffel is not split, escapees keep only the stash they already had, the biggest among them wins) → split of the duffel and kitty (only if no bust) → cooling (−1 every room, then each Rooftop player cools the hottest). Raids come before cooling, so the Rooftop can't save a room in the same round and the bell preview stays exact. A police briefing follows a raid. *Confirmed (owner, 4 Nov).*
- **Every bell is always visible,** except a room the Hacker hides. **Loot stays "coins".** **Books mode is dropped** (superseded by Skimjob Advanced). *Confirmed (owner, 4 Nov).*
- **A taped-off room's bell is off** (design §5.3): reset to 0, not shown, nothing can ring it, and neither the Mole nor the Hacker can target it; it reappears at 0 when the room reopens, the Fixer included. From the owner's S2 note "its bell is hidden until it reopens". *Provisional (PM reading, 7 Nov).*

- **Honesty:** a coin counts toward honesty once, when it first reaches the duffel: handed in, or recovered by a shakedown or the Priest. Coins carried in the kitty or re-split are never counted again. Seized coins count neither as "taken" nor as "missing". A stash drops by any coins taken back by a shakedown or the Priest. *Confirmed (owner, 4 Nov).*

- **No backward compatibility:** R7 builds don't replay older game logs; the S5 deploy backs up and clears old games. *Confirmed (owner, 4 Nov).*

### Owner decisions, 6 Nov

- **Shakedown protection** (design §9.7): after a shakedown passes against a player, bailed or not, no other shakedown can target them until the next regular meeting; briefings and emergencies don't lift it. Shown as protected in the UI and the ledger. *Confirmed (owner, 6 Nov).*
- **Bail is a choice** (design §9.6, §12): when a shakedown passes against a Bail holder, before the stash opens, the holder privately chooses to use Bail (the shakedown falls through, the stash stays closed, the ledger says only "a shakedown fell through", Bail spent) or not (the stash opens, Bail kept). A short choice window [tunable]; no answer means don't use; bots decide by policy; one Bail held at a time. *Confirmed (owner, 6 Nov).*
- **Emergency meetings are a crew pool by crew size** (design §9.3): 1 for 3–6 players, 2 for 7–12 [tunable, in content]. Any player may spend one, only after a round's result is shown and before the next round's planning starts; nothing recharges the pool; the caller is named publicly. *Confirmed (owner, 6 Nov).*
- **Every player gets a role; any role may repeat** (design §11.3): roles dealt = number of players (3–12), up to 10 distinct; at 11–12 players the extra seats get a repeated role, any role (the Mole and Fixer included), eyes and shadows within one, at most two copies. Counts come from content (seam 8). Each holder has their own uses and charges (seam 9); each Mole or Fixer copy wins under its own handler; the Exact role list shows counts; the case board flags a role claimed more often than dealt; §21 gates win rates per role, copies counted per seat. *Confirmed (owner, 6 Nov).*
- **Everyone tied at the top wins** (design §8): no tie-break, so a game can have any number of winners; on a successful heist the whole crew wins when every stash is equal (an honest player who bought a perk ends lower and doesn't win). The same holds among escapees on a bust and among the Mole and Fixer holders on a heist sunk by theft (a tie with a player who can't win still goes to them). *Confirmed (owner, 6 Nov).*
- **Event cards are drawn at random every time** (design §13): any card of the deck, repeats allowed, so the deck never runs out. *Confirmed (owner, 6 Nov).*
- **The remaining design readings are accepted as written** (design §3–§14: short bank, missed move, raids and Wanted, the bust, meetings and voting, role readings, the shop, events, Learn the game) and §21's targets as starting targets for S5. *Confirmed (owner, 6 Nov).*

### Owner decisions, 7 Nov (S2 mockups)

The approved S2 mockups (linked from `docs/STATUS.md`) are the S4 reference.

- **Money words** (design §2, §20.5): **Duffel** (the crew bag being split), **Share** (your equal cut of every split so far, the fair share; one round's split is "this round's cut"), **Pocket** (coins you skimmed), **Stash** (your private total; the biggest wins), **Kitty** (leftover change carried into the next split), in the spec and on every screen. "Table" is gone: honesty = coins that reached the duffel ÷ coins taken; returned coins are set aside in the duffel for the next split; at the end the kitty and unsplit duffel pay for the getaway car. Wording only; no rule changed. *Confirmed (owner, 7 Nov).*
- **The case board** (design §15.4) is one Leads list, newest first, each lead combining the facts about one thing in one round (⚠ warnings, bells, raids, shakedowns, Wanted, missing coins, anonymous purchases); private pins on a whole lead or a single fact, kept across rounds; a suspect card naming the most likely liar with a one-line reason, from the pinned facts when 2+ are pinned, otherwise from all leads, using only that player's `viewFor`. It replaces the Rounds/Players/Rooms views. *Confirmed (owner, 7 Nov).*
- **The plan board** (design §10): distinct icons for a room claim and a power claim; a per-player ledger line under the avatars, linked both ways with the head pop-up; few words, "i" InfoTips instead of explanations. *Confirmed (owner, 7 Nov).*
- **UI** (design §15.6): board motion (siren on a taped room with its bell hidden, Vault door, Office screen and lamp, Lobby camera), all off under reduced motion; avatars shrink to fit their room; a drawn icon per role, used everywhere; a Terms glossary in the "This game" rulebook; "Grab" is the coin control's label. Captions on the mockup artboards and the icon key under the rulebook artboard are review notes, not product UI. *Confirmed (owner, 7 Nov).*

### Readings (PM, 4 and 6 Nov)

- **Missing:** "N coins went missing" = coins taken (excluding seized) − coins handed in that round, never negative. *Confirmed (owner, 6 Nov).*
- **Copies of a role on the same target in one round** (design §11.4, PM, 6 Nov): the uses resolve one after another from a seeded seat; effects that add up stack (two Mole rings are two rings); a use that finds nothing left to act on because the other copy already did it has no effect and is not spent (the second Priest learns 0). *Confirmed (owner, 6 Nov).*
- **Advanced drops the Inside tip card** (roles are public there), leaving three event cards (`docs/advanced.md`). *Confirmed (owner, 6 Nov).*

## Balance

- **Targets are set in S1 (`docs/design.md` §21, accepted by the owner, 6 Nov, as starting targets) and tuned once in S5** on the Sim suite workflow, never babysat in chat: heist success, raid and bust rates and Rooftop stalls, each role's win rate within a band, the share of whole-crew wins, perks not deciding games. `docs/balance/baseline.json` is the comparison baseline; re-run after any rule, number or bot change. *Confirmed.*
- **A check passes or fails only when its whole 95% interval is in or out of the target;** otherwise it is inconclusive. *Confirmed.*

## Social layer

- **Votes:** group-scheduled live windows; sealed votes for absentees; hidden while voting and revealed after by default (prevents bandwagoning). The Check ballot perk works in Secret mode (the one exception to secret ballots). *Confirmed.*
- **A meeting slot locks once more than half of the human seats back it;** bots only back, never propose. *Confirmed.*
- **Lock-in marks and presence are public** (who has locked in, never what; online dot and last seen). **Rounds end early once everyone has locked in,** after a short grace set once per preset. *Confirmed;* grace lengths per preset (1h 10 s, 3h 30 s, 1d 2 min, 3d 5 min, 1w 5 min) [tunable] *confirmed (owner, 6 Nov)*.
- **Discussion can happen anywhere** (in-app chat and DMs, WhatsApp, in person); verified evidence cards keep facts trustworthy. Secret-mode ballots are never shareable. *Confirmed.*
- **No player elimination;** getting caught costs coins, never the seat (essential for week-long games). *Confirmed.*

## Server and timing

- **Node + Fastify + Postgres (`pg`), PGlite** for tests and zero-setup dev; plain SQL, add-only numbered migrations, no ORM. Replay inputs are `json`, not `jsonb` (key order must survive). *Confirmed.*
- **One server process** (per-game lock, in-memory rate limits, scheduler). *Confirmed.*
- **Sign-in:** invite link + nickname (guests may host), plus Google for a persistent identity (on when both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set). *Confirmed.* Also confirmed (owner, 6 Nov): the redirect URI from env (`GOOGLE_REDIRECT_URL`, else `PUBLIC_ORIGIN` + `/api/auth/google/callback`), never the Host header; the account's seat is kept on a same-game clash; display name `name` → `given_name` → "Crook"; scopes `openid profile` (no email: a player is keyed by Google's stable `sub`, which is enough for game history and future leaderboards; email only if notifications need it later); `prompt=select_account`.
- **Scheduler reconciles, never schedules by events:** `planDeadlines` lists what the state calls for, one rule per kind in `DEADLINE_RULES`; a restart changes no due time; refused deadlines are dropped, other failures retried with backoff. *Confirmed.*
- **No timing leaks:** a view is pushed only when it changed; bots act only when their own view changed. *Confirmed.*
- **Preset timings** (1 hour to 1 week) and the auto-meeting presets are server data; tune after playtests. *Confirmed.*
- **Host controls** (#54), *confirmed (owner, 6 Nov)*: players can still act while paused (only the clocks stop); Extend per preset (1h 2 min, 3h 5 min, 1d 30 min, 3d 1 h, 1w 2 h), no cap; replace a seat with a bot only after 2 missed rounds in a row, never the host's seat, default Opportunist, handed back by the host or the seat's player; lobby kick of any non-host seat.
- **Notes** (case-board seen marks, suspicion board) live outside the engine log, over REST (`apps/server/src/notes.ts`), and R7's case-board pins, tags and notes stay there too: private, editable any time, never part of the game record or the reveal. *Confirmed (owner, 6 Nov).*
- **Chat** is server-only, plain text, random UUID ids, 500 characters, 8 per 10 s; DM notices on by default; bots don't chat. *Confirmed.*
- **One origin:** the server serves the built web app, the API (a leading `/api` is stripped) and the sockets, so a client route must not equal an API `GET` route. `NODE_ENV=production` means secure cookies, trusted proxy and no dev stub. *Confirmed.*

## Web and UI

- **Web-first launch:** the browser app is the product, responsive from 360 to 1280 px, ≥ 44 px targets for mouse and touch, no hover-only interaction, safe-area insets, installable as a PWA. Native apps come later in **Flutter** as thin clients. *Confirmed.*
- **One look everywhere:** the hand-drawn notebook style (`docs/ui-style.md`) from the shared kit and `theme.css` tokens only; style from CityRT, never its logo, name or art. *Confirmed.*
- **React + Vite, no router, state or UI library;** committed woff2 fonts (Pangolin, Inter); our own sketch-frame generator; `/dev/gallery` shows every component and is dev-only. *Confirmed.*
- **Art:** our own SVG bank cutaway in side view, stacked layout on phones, gumdrop crooks. *Confirmed.*
- **The web app imports engine and content for types, names and numbers only;** no game logic runs in the browser beyond reading the view. *Confirmed.*
- **Part B presentation** (one screen, info on everything, "This game" rulebook, the case board with trust levels and ⚠ flags, Tips on by default per user) is agreed in `docs/simplified.md` Part B; the S2 mockups are approved (see "Owner decisions, 7 Nov" above). *Confirmed.*

## Ops and deploy

- **Hosting: AWS Lightsail,** https://skimjob.duckdns.org, on the owner's box, shared with another app (Arcway) that no Skimjob step may touch. systemd service, releases with a `current` symlink, nginx, Postgres, weekly `pg_dump`. Built on the Mac and uploaded by hand; nothing deploys from CI. Runbook: `docs/deploy.md`. *Confirmed.*
- **The repo is public,** so nothing secret or connection detail is ever committed. *Confirmed.*
- **CI is scoped** (C3, `docs/testing.md` "Scoped tests"): `scripts/scope.mjs` follows the import graph from each changed file to the entry points in `apps/web/e2e/features.json` and runs only their e2e tags, the unit tests of changed packages and their dependents, and a 50-game sim smoke for engine, content or bots changes; anything it can't place (config, `.github/`, `scripts/`, `features.json`, a module that reaches no entry or 3+ tags, deleted source files, `apps/sim`) runs the full tier. A docs-only PR runs the typecheck, knip and all unit tests. Every push to `main` and a nightly run execute the full tier (all e2e on 6 balanced shards, the 200-game sim smoke). The always-on **CI ok** job is the one required check. *Confirmed.*
- **Feature tags** (C3): every e2e test title carries exactly one tag from `features.json`; R6 specs are tagged by what they exercise; `scope.mjs --check` enforces tags and entries. A changed test file runs only its own package's unit tests or its own tag. The two `@smoke` specs come with the first R7 screens. *Provisional (C3, PR #146).*
- **Actions are pinned** to full commit SHAs with the tag as a comment (#115). *Confirmed.*
- **R7 is built straight on `main`** with no integration branch, flags or kept R6 path; the live game has no real players. Replace, don't add; docs say only what is true now; no placeholders for Advanced. *Confirmed.*
- **Out of scope for R7:** Skimjob Advanced (`docs/advanced.md`, additive only), the recruited Mole, M3 and M4, the parked M2-14 and M2-15. *Confirmed.*

## Pipeline and git

- **Everything goes through a PR; only the PM merges,** with `docs/pipeline/merge.sh` once the SHA-bound gate (`verdicts.sh`) passes: an APPROVE review naming the reviewed head, a QA PASS naming the current head, only QA-test commits after the review, green CI with a successful `CI ok` check-run, a clean merge state, clean authorship. Any API error fails closed. *Confirmed.*
- **The gate scripts use only the GitHub REST API** (`gh api`), so the pipeline runs from the Mac and from cloud sessions where GraphQL is blocked. *Confirmed.*
- **Commits are authored as karthik24iyer <karthik24iyer@gmail.com>, with no AI attribution lines;** the gate refuses them. *Confirmed.*
- **Tasks, follow-ups and owner questions are GitHub issues** (milestone "R7 Simplified", the private R7 board); rules and decisions stay in the repo. Builders and QA don't edit STATUS or this file: they put "Closes #N", `## Decisions` and `## Follow-ups` in the PR body, the PM folds decisions in and creates the follow-up issues. *Confirmed (owner, 4 Nov).*
- **Testing speed:** run `pnpm typecheck` and `pnpm test:scoped` (the same scope as CI), push once; never skip or disable a test. *Confirmed.*
