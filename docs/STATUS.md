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

### Next up (in order)
8. [ ] **`viewFor()`** + leak tests for every event type — design §17.2.
9. [ ] **Bots** — Agent interface, suspicion model, Honest/Opportunist/Greedy/Cautious/Random — design §17.3.
10. [ ] **Simulator CLI** — batches, seeds, player counts 2–12, bot mixes, CSV/JSON output, balance metrics report — design §17.4.
11. [ ] **First balance pass** — run sims, record findings in `docs/decisions.md`, update numbers in content + design doc.

### Later in M1 (after the above works)
- Remaining roles (Hacker, Smooth talker, Muscle, Blackmailer, Snitch, Driver, Mole), events deck, Duel mode (2 humans).

## Upcoming milestones
- **M2** — playable web prototype (server, minimal UI, chat, ledger) for real playtests.
- **M3** — mobile apps, push notifications, cartoon art direction.
- **M4** — more content (museum, casino, roles, events).

## Notes / half-finished work
- **RNG rule for every later task:** command handlers draw only through the `Draw` that `handleCommand` passes them; `withRng` then appends the reveal-only `rngAdvanced { words }` automatically (see decisions.md). Never read `state.rng` in a handler. `applyEvent` throws for event types not folded yet; each task adds its cases in `reduce.ts`.
- New commands: add a handler to `HANDLERS` in `handle.ts`; return a reason string to reject. Unsupported commands are rejected today.
- **M2 (server):** the server must set `command.player` from the authenticated session and never trust the client's value. Rejection reasons are role-specific ("your role can't pocket loot"), so a forged `player` could probe other players' roles. It must also send `advance { kind: "round", round }` with the round it scheduled.
- **M2 (server) and meetings:** the act's meeting only opens from `awaitingMeeting` (after the act's last round), so if its slot passes mid-act the server sends `openMeeting` again once that round resolves. Only one meeting is open at a time: an `openMeeting` sent while another is open is refused and must be re-sent after it closes. The emergency notice period, window length and "act deadline" for `scheduleMeeting` are the server's. Meeting ids are `act-<n>` and `emergency-<player>`. Any new id or public field must come from public data only (never `log.length`).
- **End of game:** every ending calls `gameEnded(state, events, failure)` (`end.ts`) with the command's events so far. A new ending (events deck, Duel) must do the same.
- **Mole / Driver:** give them a `RoleDef` with `winsOnFailure` (Mole `{ reasons: ["heat", "target"], needsTopStash: false }`, Driver `{ reasons: ["heat"], needsTopStash: true }`). The Mole "wins only if the heist fails", so it must also be kept out of the success winners — add that when the Mole's `RoleDef` lands (today a top-scoring Mole would win a successful heist).
- **Task 8 (`viewFor`):** `GameState.meeting.votes` holds every ballot, including hidden and secret ones; only `me.vote` may come from it. `me.sealedVote` is the player's own. Ballots of others reach a view only through the ledger (Open mode, and `meetingClosed.ballots` outside Secret mode).
- Moles can be dealt (by the Mole setting) but have no powers yet, and two Moles are not yet told about each other (§8.1) — add a private "your fellow Mole" event with the Mole role.
- Roles with no `RoleDef` (the Mole, for now) play with no power and may pocket.
- `samples.ts` has one sample per event and command type, and the compiler enforces it. The `viewFor()` leak tests in task 8 should loop over `sampleEvents`.
- Visibility has four kinds: `public`, `private`, `reveal`, `secret`. `secret` never opens up, even after the game (Secret-mode ballots, §11.2). `voteCast`/`voteSealed` use `secretTo()` in Secret mode; task 8 builds `reveal.log` from `canSee(..., true)` so other players' secret ballots are dropped.
- `AbilityUse` covers only Lookout (`rooms`, 1 to `extraRooms`) and Fence. Extend it when the other roles land. Lockdown (closed rooms) arrives with the events deck; today "closed" means "not in play for this crew size".
- From the PR #1 review, deferred to the task named:
  - **Tasks 10/11 (sim/balance):** §17.4 "config overrides": add a content-overrides field to `GameConfig` (validated: configs are untrusted JSON), and a `CONTENT_VERSION` in `gameCreated` so old logs replay against the right numbers. Task 3 prepared the seam: engine helpers take a `JobDef`, and only `jobById` and `validateConfig`'s job check read the `JOBS` table.
  - **Remaining roles:** replace the Fence-specific `safe`/`safeDepositedThisAct` with a generic per-player role state (once-per-act/game uses, Snitch target, Mole allies). Some abilities happen outside planning (Muscle cancel after the vote passes, Double-cross accept, Duel call-out §16.1), so add a `useAbility` command (§17.2), and Muscle needs a window between `meetingClosed` and `shakedownResolved` (probably a new `Deadline` kind).
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
