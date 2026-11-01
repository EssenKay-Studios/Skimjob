# Status

_Last updated: 1 Nov 2026_

## Current milestone: M1 — Engine + simulator (bank job, starter roles, bots)

Goal: run thousands of all-bot games at 2–12 players and use the results to tune the placeholder numbers in `docs/design.md`.

### Done
- [x] Game design v0.1 (`docs/design.md`)
- [x] Monorepo skeleton (pnpm workspaces, TypeScript, vitest)
- [x] **Core types** — `GameConfig`, `GameState`, `Command`, `GameEvent` (visibility fixed per event type), `PlayerView`, `canSee()`, plus one sample per event/command type in `packages/engine/src/types/`.
- [x] **Seeded RNG** + deterministic setup — sfc32 in `packages/engine/src/rng.ts`; `setupEvents(config)` / `createGame(config)` emit `gameCreated`, `rngSeeded`, `roomsSet`, `roleDealt` ×N, `rngAdvanced`; `applyEvent`/`replay` fold the setup events. Dealing rules are in `packages/content/src/setup.ts` (room tiers moved to `jobs.ts` in task 3). Design §6.2, §8.1.
- [x] **Content: bank job** — `BANK_JOB` (`packages/content/src/jobs.ts`): room defs (loot, Heat pressure, Deposit-box capacity, Security/Server-room info), room tiers, Heat numbers, checkpoint targets; starter role defs in `roles.ts`. Engine helpers in `packages/engine/src/job.ts`: `jobById`, `roomsInPlay`, `roomDef`, `roomLoot`, `roundHeatDelta`, `clampHeat`, `checkpointTarget`. Design §6, §7, §8, §11.5.

- [x] **Round loop** — `handleCommand(state, command)` (`handle.ts`) returns `{ ok, state, events }` or `{ ok: false, reason }` and never throws for bad input. `submitMove` (changeable until the deadline, checked and normalised in `checkMove`), default moves, `advance { round }` → `resolveRound` (`round.ts`) in the §5.2 order: yields + Deposit-box capacity, splits, Fence safe, Heat (rounded, clamped once), sightings, Security / Lookout / Server room, public summary, raid at Heat 100. Insider can't pocket. `createGame` now opens round 1. Design §5, §6, §7, §8.

- [x] **Alibis** — `postAlibi { player, room }` → public `alibiPosted` for the latest resolved round (`resolvedRound`), one per player per round, any room in play (can be a lie), open until the next round resolves. The round deadline now names its round (`advance { kind: "round", round }`), so a retried or late one is refused. Design §5.4.

- [x] **Meetings & votes** — `proposeMeeting` / `acceptMeeting` (majority locks the slot), server `scheduleMeeting`, `callEmergency` (one per player per game), `advance { openMeeting / closeMeeting }`, `castVote` / `sealVote`, vote-visibility modes, quorum and majority, shakedown (Fence safe untouched), clean threshold and compensation (`JobDef.shakedown`), meeting → shakedown → checkpoint (+15 Heat if missed, clamped, raid at 100) → next act, and the final meeting before the final check (`gameEnded` success / failed `target`). Code in `meeting.ts`. Design §11, §4, §3.

- [x] **End of game** — `gameEnded` now carries the ranking (`role`, `score`, `stash`, `safe`, shakedowns, handed in) and winners in all three endings (round raid, checkpoint-penalty raid, final check). Role scoring (Rookie ×1.2, Insider Haul surplus, Fence safe counted), tie-breaks, joint winners, "best of the losers" ranking on failure, and `RoleDef.winsOnFailure` for later roles. Code in `end.ts`. Design §3, §8, §13.

- [x] **`viewFor()`** — `viewFor(state, playerId)` (`view.ts`) returns the `PlayerView`: own role/stash/safe/move/ballots, other seats, public state (phase, round, act, rooms, Haul, Heat, scheduled meeting, pending emergency, proposals), the ledger (typed public-only), the case file (typed private/secret-only) and, after the game, the reveal from `canSee(…, true)`. `seq` numbers what the player can see, not the full log. `eventsSince(view, seq)` is the "while you were away" input. Leak tests loop over every sample event and over scripted games at 2/5/9/12 players in all three vote modes. Design §13, §17.2, §11.2.

- [x] **Bots** — `packages/bots`: the `Agent` interface (`act(view) → PlayerCommand[]`, own view only), personalities Honest / Opportunist / Greedy / Cautious / Random as parameter sets (`PERSONALITIES`), the suspicion model (`suspicion(view)`: shortfalls vs alibis, sightings, Security/Lookout, Server room, shakedown results), moves with Lookout/Fence powers, cover-up alibis, meeting proposals/acceptance, emergency calls and votes; each bot has its own seeded RNG. `runBotGame(config, agents)` plays a game to the end with a stand-in scheduler. `viewFor` now returns a deep copy, so a view can't change the game. Design §17.3.

- [x] **Simulator CLI** — `pnpm sim -- --help` (`apps/sim`, node built-ins only): N all-bot games per player count (one count, a range 2–12 or a list), weighted bot mix, seed, job, role pool, starter mode, Mole setting, vote mode, content overrides (inline JSON or a file). Writes `games.csv`, `players.csv`, `games.json`, `summary.json` to `sim-output/` (gitignored) and prints the §17.4 metrics by player count. `GameConfig.contentOverrides` (validated untrusted JSON; numbers only) is read by the engine via `jobFor`/`rolesFor` and by bots via the public `gameCreated`, which now also carries `contentVersion`. Design §17.4.

- [x] **First balance pass** — content 0.2.0: checkpoints 7/15/24, Deposit boxes +10 Heat, Teller line 4, Insider 0.3 per surplus loot; bot fixes (Heat avoidance, vote thresholds). Success 82% → 65% overall (45/63/77/69/67/70/60% at 2/3/4/6/8/10/12p). Summary in `docs/balance/balance-1.md`, findings in decisions.md. Design §6.2, §7, §8, §11.5, §17.4.

- [x] **Info & vote roles** — Hacker (loop Security's cameras, once per act), Smooth talker (double vote; plain public tally), Muscle (`useAbility` cancel in a public shakedown window, once per game), Blackmailer (role guess, steal 3, once per act), Snitch (secret target, +10 when it's shaken down not clean). Generic `roleState` per player, `useAbility`, `advance { resolveShakedown }`. All five join the default pool (content 0.3.0). Design §8, §11.2, §11.3.

- [x] **Win-condition roles** — Driver (wins a success normally; a Heat failure with the top stash) and Mole (`tipOff` move power, +10 Heat once per act, hidden in the round's Heat; wins only failed heists, never a success, where the best non-Mole wins via `RoleDef.winsOnSuccess`; two Moles get a private `moleAllies`). Driver joins the default pool (content 0.4.0). `powerOf(config, role)` replaces the repeated role lookups. Bots: Moles tip off now and then and never vote for a fellow Mole; the sim's Mole win rate is per game. Design §3, §8, §8.1, §8.2.

- [x] **Events deck** — the ten §10 cards as content (`EVENTS`, content 0.5.0), one public `eventFlipped` per round from round 2 (seeded draw, no repeats), off in starter mode / with `eventsEnabled: false`. Effects in `packages/engine/src/deck.ts`: Heat cards and room surges in the round's numbers, Power cut (no sightings / Security / Lookout), Lockdown (closed room refused), public per-room Audit, private Raid rumour and Inside tip, Double-cross (private offers, `answerDoubleCross`, swap at §5.2 step 1 only if both accept). Bots avoid the closed room and answer offers. Sim `--events`. Design §10, §5.2.

- [x] **Duel mode** — `GameConfig.duel` (exactly 2 players; in `gameCreated`), no meetings or votes, `callOut` once per player per act (private until the act's last round resolves, then public `callOutResolved` before the checkpoint): a caught opponent hands over everything they pocketed that act, a wrong call pays 5 × act (`JobDef.duel`, content 0.6.0, overridable). Meeting-only roles aren't dealt. Bots call out on a visible shortfall; sim `--duel`. Design §16.1.

- [x] **Second balance pass** — content 0.7.0: Police patrol +5, Shift change Vault Heat ×1.5, Mole tip-off +6; event numbers overridable (`contentOverrides.events`); bots read event cards and tip-offs in the Heat (`packages/bots/src/heat.ts`), Muscle/Snitch/Blackmailer habits. Default config (events, Mole maybe): success 56% → 66%, Heat share of failures 40% → 26%, Mole win 50% → 34%. Summary in `docs/balance/balance-2.md`. Design §7, §8, §10, §17.4.

### Next up (in order)
- M1 done; M2 per `docs/m2-plan.md`.

- [x] **Owner answers (1 Nov)** — content 0.8.0: alibi phase between rounds (`phase: alibis`, `advance { kind: "alibis", round }`, public `alibisClosed`, view `alibiRound`); ⅓-plurality shakedowns at 9–12; Insider from 5 players; Mole "on" = 1 at 9–12 ("maybe" = 0 or 1 from 5); event-card Heat × min(1, crew ÷ 5); the clean check counts the Fence safe; cards repeat; `GameConfig.uniqueRoles` (default true). Teller line 3, Manager's office 4. Design §5.4, §6.2, §8.1, §10, §11.2, §11.3, §15; decisions.md "Owner answers, 1 Nov".

### Later in M1
12. [x] **Info & vote roles** — done (see above).
13. [x] **Win-condition roles** — done (see above).
14. [x] **Events deck** — done (see above).
15. [x] **Duel mode** — done (see above).
16. [x] **Balance pass 2** — done (see above).

## Upcoming milestones
- **M2** — playable web prototype (server, minimal UI, chat, ledger) for real playtests.
- **M3** — mobile apps, push notifications, cartoon art direction.
- **M4** — more content (museum, casino, roles, events).

## Milestone 2 — playable web prototype (local only)

Plan and acceptance criteria: `docs/m2-plan.md`. Runs alongside M1 task 16 (balance pass 2, another branch).

1. [x] **M2-1 Server skeleton and game store** — `apps/server`: `buildServer({ db, clock })` (Fastify, `/health`), `loadConfig(env)`, `Db` (`query`/`exec`/`transaction`) with `pg` and PGlite adapters, migration runner (`migrations/NNN_*.sql`, `schema_migrations`, one transaction, advisory lock), schema v1 (`users`, `sessions`, `games`, `seats`, `game_events`, `deadlines`), `GameStore` (`create` lobby game, `start` with config + setup events, `append` all-or-none, `load` = `replay`, in-memory cache, `withGameLock`), `Clock` / `fakeClock`. `scripts/db.sh start|stop|status|url`, `docker-compose.yml`, `pnpm dev`, `pnpm test:pg`. Design §17.2, §17.5.
2. [x] **M2-2 Identity, invites and lobby API** — sessions (random token in an httpOnly SameSite=Lax cookie, SHA-256 in the DB, 30 days, injected clock), guest sign-in (`POST /auth/guest`, or joining by invite with a nickname), `AuthProvider` (redirect + `state` + PKCE verifier) with the `dev` stub (`DEV_LOGIN=1`: `/auth/dev/start?hint=Name`), `/me`, logout. Lobby: `POST /games` (host settings), `GET /games/:id`, `GET /invites/:code`, `POST /invites/:code/join`, `POST /games/:id/leave`, `POST/DELETE /games/:id/bots`, `POST /games/:id/start` (ids `p1…pN`, `randomBytes` seed, `validateConfig`, `store.start`). `playerIdOf(db, game, user)` is the only source of `command.player`. Design §15, §16.
3. [ ] **M2-3** Live game channel and server bots.
4. [ ] **M2-4** Scheduler and elastic timing.
5. [ ] **M2-5** Web shell, style foundation, lobby screens.
   - [x] **M2-5a** `apps/web` (Vite + React 19): dev proxy `/api` → server, `theme.css` tokens, self-hosted Pangolin + Inter, `<SketchFrame>` (seeded wobbly SVG ink, hatched shadow, grain, edge burn, tape, punch holes, line boil), buttons (primary / secondary / small / toggle / ghost / back / premium / danger-armed), blob avatars with initials, chips, text field, toasts, wordmark, landing screen (create / join with invite code / sign in, no API calls yet), `/dev/gallery`. `pnpm web`, `pnpm test:e2e` (Playwright smoke test). ui-style §1–§6, §9, §10.
   - [ ] **M2-5b** Invite page (nickname), lobby (seats, bots, settings, start) and wiring the landing to M2-2's lobby API; then the M2-5 acceptance (two browsers, bots, start lands on the game route).
6. [ ] **M2-6** Game screen thin slice (first playable build).
7. [ ] **M2-7** Meetings and voting UI.
8. [ ] **M2-8** Chat: crew, DMs, evidence cards.
9. [ ] **M2-9** Art: bank cutaway, room icons, avatars.
10. [ ] **M2-10** Ledger, case file and "While you were away".
11. [ ] **M2-11** End-of-game reveal.
12. [ ] **M2-12** Google sign-in (needs Karthik's client id).
13. [ ] **M2-13** Host controls and resilience.
14. [ ] **M2-14** Playtest pass.

### M2 notes
- **Database:** no `DATABASE_URL` means PGlite in `.pglite/` (`PGLITE_DIR=memory` for in-memory). Tests use a fresh in-memory PGlite per file; with `DATABASE_URL` set (`pnpm test:pg` starts `scripts/db.sh`) they use real Postgres, one throwaway schema per test database. A fresh PGlite takes a few seconds here, so share one per test file.
- **Store contract (M2-2…M2-4):** run each command as `store.withGameLock(id, async () => { const s = await store.load(id); const r = handleCommand(s, cmd); if (r.ok) await store.append(id, r.events); })`. `append` folds with `applyEvent`, writes at `idx = log.length` (the `(game_id, idx)` key refuses a second writer) and drops the cache entry if the write fails. `games.status` follows the state (`running` → `ended`).
- **Never send** `games.config` (has the seed) or `game_events.idx` (counts hidden events) to a client.
- `buildServer({ db, clock, auth, store })`: `auth` is the redirect providers (`[devAuthProvider()]` with `DEV_LOGIN=1`; M2-12 adds Google with the same interface, keyed `users.external_id = "google:<sub>"`). Pass one shared `store` so the socket (M2-3) and the lobby use the same lock and cache. M2-3 adds `@fastify/websocket` (`@skimjob/bots` is already a runtime dependency).
- **Lobby (M2-2):** refusals are `{ error }` (`HttpError`); a game you're not seated in is 404. Host settings live in `games.settings` (`LobbySettings`, `settings.ts`); `sessionLength` is a preset id (`quick`, `1h` … `1w`) that M2-4 gives timings; `dmNotices` is for M2-8. Settings can't be changed after create yet. Bot seats: `bot_personality` set, name `Bot · <name>`, `isBot: true` in the config; M2-3 runs `createBot` for them by personality.
- `deadlines` is keyed `(game_id, key)` with the system command to send as `json`; M2-4 decides the key format (the schema comment suggests `round:3`, `openMeeting:act-1`).

## Notes / half-finished work
- **Alibi phase (owner answers, 1 Nov):** every round that doesn't end the game resolves into `phase: { kind: "alibis", round }`; moves for the next round are refused until the server sends `advance { kind: "alibis", round }` (named, refused if repeated or stale; refused while a meeting is open, re-send after). After an act's last round it leads to `awaitingMeeting` (Duel: call-outs + checkpoint). M2-4 must schedule this deadline (short) after each round; M2-3's bots post alibis on `view.alibiRound !== null`. Scripted tests that aren't about alibis use `handleThroughAlibis` (`packages/engine/src/alibis.testkit.ts`).
- **`uniqueRoles` (owner answers, 1 Nov):** a `GameConfig` field (absent = true). The lobby's `LobbySettings` (M2-2) doesn't offer it yet; add it with the other host settings (M2-5b/M2-13).
- **Web (M2-5a, done):** frames are drawn by `<SketchFrame>` / `<FrameArt>` (`apps/web/src/components/`); give every frame a stable `seed` so it looks the same on every render. Fill/ink come from `--fr-fill` / `--fr-ink`. `<SketchDefs>` must stay mounted once (App). The landing buttons only toast for now: M2-5b wires them to the lobby API. The bank doodle on the landing is placeholder art for M2-9. Playwright projects run at 390×844 and 1280×800 on port 5179; `e2e/responsive*.spec.ts` set their own viewports (360–1280, with and without touch) and guard the web-first rules (no overflow, ≥44 px targets, gutters, contrast). Add every new screen to their route lists.
- M2 server: a Muscle shakedown window must always run its full server-set length (ending early on cancel leaks via timing). PR #12 review.
- M2 plan: see `docs/m2-plan.md` (14 tasks, M2-1 … M2-14).
- **RNG rule for every later task:** command handlers draw only through the `Draw` that `handleCommand` passes them; `withRng` then appends the reveal-only `rngAdvanced { words }` automatically (see decisions.md). Never read `state.rng` in a handler. `applyEvent` throws for event types not folded yet; each task adds its cases in `reduce.ts`.
- New commands: add a handler to `HANDLERS` in `handle.ts`; return a reason string to reject. Unsupported commands are rejected today.
- **M2 (server):** the server must set `command.player` from the authenticated session and never trust the client's value. Rejection reasons are role-specific ("your role can't pocket loot"), so a forged `player` could probe other players' roles. It must also send `advance { kind: "round", round }` with the round it scheduled.
- **M2 (server) and meetings:** the act's meeting only opens from `awaitingMeeting` (after the act's last round), so if its slot passes mid-act the server sends `openMeeting` again once that round resolves. Only one meeting is open at a time: an `openMeeting` sent while another is open is refused and must be re-sent after it closes. The emergency notice period, window length and "act deadline" for `scheduleMeeting` are the server's. Meeting ids are `act-<n>` and `emergency-<player>`. Any new id or public field must come from public data only (never `log.length`).
- **End of game:** every ending calls `gameEnded(state, events, failure)` (`end.ts`) with the command's events so far. A new ending (events deck, Duel) must do the same.
- **Mole / Driver (task 13, done):** both have `RoleDef`s. Success winners skip roles with `winsOnSuccess: false` (the Mole), so a top-stash Mole never wins a success; the Driver, which has a `winsOnFailure`, still wins a success normally. Any new role that must not win a success sets `winsOnSuccess: false`; don't key it off `winsOnFailure`.
- **Balance (task 16, done):** see `docs/balance/balance-2.md`. Still open: Mole without events 43–59% at 6–12p, 2–4p Heat busts, events on + Mole off at 6–12p succeeds 78–84%, the sim doesn't report call-outs. New bot Heat logic is in `packages/bots/src/heat.ts`.
- **Balance (task 11, done):** `pnpm sim -- -n 1000 -p 2,3,4,6,8,10,12` takes about 2 minutes. Scripted rule tests pin the 0.1.0 numbers with `V01_NUMBERS` (`packages/engine/src/v01-numbers.testkit.ts`); new scripted tests can do the same. Open after pass 1: 2p (no shakedowns pass) at 45%, 4p at 77%, few shakedowns pass at 10–12p, Heat busts fade with crew size, bot shakedown accuracy ~84%. A gentler mix (honest 2, opportunist 3, greedy 1, cautious 2) succeeds 79%. Rerun after the events deck and new roles land.
- **Bots → simulator (task 10, done):** build on `runBotGame` / `createBots` in `packages/bots` (zero refused commands is a test requirement). A quick look at 50 games per size, mixed crews (Honest, Opportunist, Cautious, Greedy): success about 90–100% at 4–12 players (target 55–70%), Heat raids almost never (bots lay low well before 100), 70–95% of shakedowns catch loot; all-Greedy crews mostly miss the final target; 2-player games never pass a shakedown (one vote each can't make a majority, §16). These are the bots' numbers, not tuned yet: task 11. Bots don't seal votes or chat.
- **Player ids** must match `/^[A-Za-z0-9_-]{1,32}$/` and not be `__proto__`/`constructor`/`prototype` (`validateConfig`). The M2 server generates them; display names stay free text.
- **Views:** bots and clients get only `viewFor()`, which returns a deep copy (nothing shared with the state). A view's `seq` is the position among the events that player can see during the game (ledger and case file share it, gap-free), so a "last seen" cursor is per player and stable for the whole game; `reveal.log` numbers its own stream. Never send a full-log index to a client (it counts hidden events). A new state field that a view should show must be added to `viewFor` by hand, and the scrub in `view.leak.test.ts` must hide it if it's private. An Informant (§11.2) would be granted others' secret ballots in `viewFor`, not `canSee`.
- Every dealt role has a `RoleDef` now. Read powers with `powerOf(config, role)` (and defs with `roleDefIn(rolesFor(config), role)`), never by hand; an id with no definition plays with no power and may pocket.
- `samples.ts` has one sample per event and command type, and the compiler enforces it. `view.test.ts` loops over `sampleEvents`, so a new event type is covered automatically; if it can take more than one visibility, add the extra variants to `samples` there. New event types from later tasks (events deck) should also appear in the scripted games of `view.leak.test.ts`.
- Visibility has four kinds: `public`, `private`, `reveal`, `secret`. `secret` never opens up, even after the game (Secret-mode ballots, §11.2). `voteCast`/`voteSealed` use `secretTo()` in Secret mode; `reveal.log` comes from `canSee(..., true)`, so other players' secret ballots are dropped.
- **Role powers (task 12):** move powers are `AbilityUse` (Lookout, Fence, Hacker `loopCameras`, Blackmailer `blackmail`); powers used outside planning go through `useAbility` (`InstantAbility`, today only the Muscle's `cancelShakedown`). The Mole's tip-off is a move power (`tipOff`). Per-player uses live in `PlayerState.roleState` (`usedThisAct` reset each act, `usedThisGame`, `target`, `allies`). `abilityResolved.ability` is a `ResolvedAbility`. Lockdown (closed rooms) arrives with the events deck; today "closed" means "not in play for this crew size".
- **Shakedown window (task 12):** a passed shakedown becomes `shakedownPending` (phase and public event) whenever the role pool holds the Muscle; the server must send `advance { kind: "resolveShakedown", meetingId }` when its (short, server-set) window ends. Every new ending or shakedown path must go through `afterVote` in `meeting.ts`. Scripted tests that don't want the window use `rolePool: [...STARTER_ROLES]`.
- **Default pool is now 10 roles** (content 0.4.0, with the Driver): the sim's default runs deal them, so balance-1 numbers no longer describe a default run (task 16 re-runs).
- From the PR #1 review, deferred to the task named:
  - ~~Tasks 10/11: content overrides and `CONTENT_VERSION` in `gameCreated`~~ — done in task 10. New job/role numbers that should be tunable must be added to `ContentOverrides` and `validateOverrides`.
  - ~~**Remaining roles:** generic per-player role state, `useAbility`, Muscle window~~ — done in task 12. Double-cross accept (events deck) and Duel call-out (§16.1) can use `useAbility` too.
  - ~~**Events deck:** event types~~ — done in task 14. ~~**Duel mode:** no Duel config flag yet~~ — done in task 15.

- **Events deck (task 14, done):** a new card is a `EventDef` in `packages/content/src/events.ts`; a new effect *kind* needs one function in `deck.ts` (step-1 player effects go in `cardEffects`, round-number effects in `roundJob`/`cardHeat`). Any new place that starts a round must use `startRound(state, round, draw)` (it flips the card). Event numbers are in `ContentOverrides.events` (task 16). Balance (task 16): run the sim with `--events`; a quick 200-game run raised the Heat-bust share of failures at 4–6p from 8/12% to 47/30% (Police patrol, Shift change). Bots ignore Audit reports, Inside tips and offers beyond a coin flip.

- **Duel mode (task 15, done):** the act's end in Duel is `endOfDuelAct` (`duel.ts`), called by `closeAlibis` (`round.ts`) when the act's last round's alibis close; any new end-of-act step must go there as well as in `afterVote` (both use `checkpoint()` in `meeting.ts`). M2: the server never sends `openMeeting`/`scheduleMeeting` in Duel games. Balance (task 16): the sim doesn't report call-outs yet (count, caught share, loot moved); bots call out only on a visible shortfall.

## Questions for Karthik
- M2 lobby: OK that one invite link per game works for anyone until the game starts (then 410), the host can't leave the lobby, and new bots default to the Opportunist personality? (provisional, decisions.md)
- Web: OK that the browser calls the server under `/api/...` (the dev proxy strips it), and with the landing copy and "skimjob" wordmark (coin over the i, mask mark)? See `/dev/gallery` and decisions.md (M2-5a).
- Heat: OK to round each round's change to a whole number (halves up) and floor Heat at 0? (provisional, decisions.md)
- Fence: may the Fence put this round's pocket straight into the safe (current, provisional), or only loot already in the stash?
- Alibis: may an alibi name only rooms in play (current)?
- Meetings: OK that the act's meeting opens only after its last round, that a sealed vote is used by the next meeting of either kind (no withdrawing), that you can't vote for yourself, and that clean-target compensation is capped at the Haul? (all provisional, decisions.md)
- End of game: OK to keep scores to one decimal (Rookie 9 → 10.8), let fully tied leaders share the win, and show the stash ranking on a failed heist as a loss? (all provisional, decisions.md)
- Opportunist bot: moves are simultaneous, so it can't know beforehand that it will be alone; OK that it pockets at a medium rate and only lies about it when nobody turned out to be in its room? (provisional, decisions.md)
- Simulator metrics: OK with the provisional definitions (pocketing bands 10%/40% of loot, shakedown accuracy = not clean, comeback = sole Act 1 leader wins a successful heist, decided early = sole Act 2 leader wins a successful heist with a lead ≥ half the max Act 3 gain)? (decisions.md)
- Balance (2 players): no shakedown can pass with 2 voters (no self-votes), so all-bot 2-player games succeed 45% with half the failures from Heat. OK to treat 2 players as bots-or-Duel only and not tune for it? (docs/balance/balance-1.md)
- Hacker: should a camera loop also blind the Lookout's extra room, or only Security (current, provisional)?
- Smooth talker: OK that the public tally counts one per ballot (so it never names the Smooth talker next to public ballots) while the result counts the double vote (current, provisional)?
- Muscle: OK that the shakedown window opens after every passed shakedown whenever the Muscle is in the role pool (so it never shows one was dealt), adding a short wait to those games?
- Snitch: "holding more than the clean threshold" read as "not clean" (stash + safe ≥ 3 × act), paid every time it happens (current, provisional) — or strictly above, or once per game?
- Mole tip-off: a move power at most once per act, added to that round's Heat inside the public total (current, provisional) — or usable at any time as its own hidden Heat bump?
- Driver: on a Heat failure, does "the biggest stash" mean the top of the whole crew including Moles (current, provisional), or only among non-Moles?
- Double-cross: do the swapped roles take effect for the round being resolved (current) or from the next round? And may a Mole be offered a swap (current: yes; the other Mole is told its ally changed)?
- Raid rumour: compare stashes without the Fence safe, break ties at random, and lose the 3 to the cops (current, provisional)? Power cut: should the Server room still count pockets (current)?
- Duel call-outs: may a call take more than the stash holds (current: capped; the Fence safe is never touched), and a wrong call cost more than the caller's stash (current: capped)?
- Duel roles: OK to leave the meeting-only roles (Smooth talker, Muscle, Snitch) out of the deal in Duel mode (current, provisional)?
- Big-crew votes (9–12): when more than half the votes skip, the meeting skips even if the top target has ⅓ (provisional, decisions.md "Owner answers, 1 Nov") — right?
- Heat at 3–4 players: with event Heat scaled, Heat busts are still 45% / 34% of failures (40% / 22% even with card Heat at 0): the rest is Vault pressure in small crews and the Shift change lure. Accept, or tune further? 4p succeeds 76% (target 55–70%).
