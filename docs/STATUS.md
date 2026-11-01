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

### Next up (in order)
- Events deck, Duel mode (see below); then a second balance pass with them in.

### Later in M1
12. [x] **Info & vote roles** — done (see above).
13. [x] **Win-condition roles** — done (see above).
14. [ ] **Events deck** — the ten events of design §10, one flipped per round from round 2, off in starter mode.
15. [ ] **Duel mode** — exactly 2 humans, call-outs instead of votes — design §16.1.
16. [ ] **Balance pass 2** — re-run sims with all roles and events; bots learn the new roles minimally.

## Upcoming milestones
- **M2** — playable web prototype (server, minimal UI, chat, ledger) for real playtests.
- **M3** — mobile apps, push notifications, cartoon art direction.
- **M4** — more content (museum, casino, roles, events).

## Notes / half-finished work
- M2 server: a Muscle shakedown window must always run its full server-set length (ending early on cancel leaks via timing). PR #12 review.
- M2 plan: see `docs/m2-plan.md` (14 tasks, M2-1 … M2-14).
- **RNG rule for every later task:** command handlers draw only through the `Draw` that `handleCommand` passes them; `withRng` then appends the reveal-only `rngAdvanced { words }` automatically (see decisions.md). Never read `state.rng` in a handler. `applyEvent` throws for event types not folded yet; each task adds its cases in `reduce.ts`.
- New commands: add a handler to `HANDLERS` in `handle.ts`; return a reason string to reject. Unsupported commands are rejected today.
- **M2 (server):** the server must set `command.player` from the authenticated session and never trust the client's value. Rejection reasons are role-specific ("your role can't pocket loot"), so a forged `player` could probe other players' roles. It must also send `advance { kind: "round", round }` with the round it scheduled.
- **M2 (server) and meetings:** the act's meeting only opens from `awaitingMeeting` (after the act's last round), so if its slot passes mid-act the server sends `openMeeting` again once that round resolves. Only one meeting is open at a time: an `openMeeting` sent while another is open is refused and must be re-sent after it closes. The emergency notice period, window length and "act deadline" for `scheduleMeeting` are the server's. Meeting ids are `act-<n>` and `emergency-<player>`. Any new id or public field must come from public data only (never `log.length`).
- **End of game:** every ending calls `gameEnded(state, events, failure)` (`end.ts`) with the command's events so far. A new ending (events deck, Duel) must do the same.
- **Mole / Driver (task 13, done):** both have `RoleDef`s. Success winners skip roles with `winsOnSuccess: false` (the Mole), so a top-stash Mole never wins a success; the Driver, which has a `winsOnFailure`, still wins a success normally. Any new role that must not win a success sets `winsOnSuccess: false`; don't key it off `winsOnFailure`.
- **Balance (task 16):** with the Mole "on", a quick 200-game run gives success 57/39/28% at 6/9/12p (vs 72/75/61% with the Mole off) and a Mole win rate of 43/61/73% (target 30–40%). Two Moles at 9–12 are strong; bots don't yet hunt Moles.
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
  - **Events deck / Duel mode:** no event types yet (public `eventFlipped`, private Raid rumour / Inside tip results) and no Duel config flag.

## Questions for Karthik
- Role deal: should each non-Rookie role be dealt at most once, with Rookies filling the rest (current, provisional), or can roles repeat in big crews?
- Mole at 9–12 players: is "off" allowed, and does "maybe" mean 1-or-2 (current) or 0/1/2? "On" currently deals 2.
- Heat: OK to round each round's change to a whole number (halves up) and floor Heat at 0? (provisional, decisions.md)
- Fence: may the Fence put this round's pocket straight into the safe (current, provisional), or only loot already in the stash?
- Alibis: should the alibi for round N close when round N+1 starts (forcing it before planning) rather than when N+1 resolves (current, provisional)? And may an alibi name only rooms in play (current)?
- Meetings: OK that the act's meeting opens only after its last round, that a sealed vote is used by the next meeting of either kind (no withdrawing), that you can't vote for yourself, and that clean-target compensation is capped at the Haul? (all provisional, decisions.md)
- A Fence's clean check ignores the safe, so a Fence can hide loot and still be paid compensation as clean — keep this (current, provisional) or count the safe toward the clean check?
- End of game: OK to keep scores to one decimal (Rookie 9 → 10.8), let fully tied leaders share the win, and show the stash ranking on a failed heist as a loss? (all provisional, decisions.md)
- Opportunist bot: moves are simultaneous, so it can't know beforehand that it will be alone; OK that it pockets at a medium rate and only lies about it when nobody turned out to be in its room? (provisional, decisions.md)
- Simulator metrics: OK with the provisional definitions (pocketing bands 10%/40% of loot, shakedown accuracy = not clean, comeback = sole Act 1 leader wins a successful heist, decided early = sole Act 2 leader wins a successful heist with a lead ≥ half the max Act 3 gain)? (decisions.md)
- Balance (2 players): no shakedown can pass with 2 voters (no self-votes), so all-bot 2-player games succeed 45% with half the failures from Heat. OK to treat 2 players as bots-or-Duel only and not tune for it? (docs/balance/balance-1.md)
- Balance (4 players): the Insider can't pocket and is always dealt at 4 players, which adds ~12 pp of success (77% at 4p vs 63% at 3p). Deal the Insider only from 5 players, or accept? (2–4 players share every number, so content can't separate them.)
- Balance (10–12 players): only ~0.4 shakedowns pass per game (votes scatter; a shakedown needs more than half the votes cast), and in a gentler crew one heavy pocketer wins ~50%. Keep the majority rule (humans will coordinate in chat), or let a plurality pass in big crews?
- Balance (Heat): Heat busts are 51% of failures at 2p but 0% at 10–12p, because big crews average out. Numbers can't flatten this; OK to rely on the events deck for Heat swings?
- Balance (Lookout): its extra room helps the crew, not its own score, so it wins 12 pp below fair share at 3p (−4 overall). Give it a small personal edge, or accept?
- Hacker: should a camera loop also blind the Lookout's extra room, or only Security (current, provisional)?
- Smooth talker: OK that the public tally counts one per ballot (so it never names the Smooth talker next to public ballots) while the result counts the double vote (current, provisional)?
- Muscle: may the Muscle cancel their own shakedown (current, provisional)? And OK that the shakedown window opens after every passed shakedown whenever the Muscle is in the role pool (so it never shows one was dealt), adding a short wait to those games?
- Snitch: "holding more than the clean threshold" read as "not clean" (stash ≥ 3 × act), paid every time it happens (current, provisional) — or strictly above, or once per game?
- Blackmailer: should the victim be told they were blackmailed (current: privately, amount only, not by whom)?
- Mole tip-off: a move power at most once per act, added to that round's Heat inside the public total (current, provisional) — or usable at any time as its own hidden Heat bump?
- Driver: on a Heat failure, does "the biggest stash" mean the top of the whole crew including Moles (current, provisional), or only among non-Moles?
