# Status

_Last updated: 1 Nov 2026_

## Current milestone: M1 — Engine + simulator (bank job, starter roles, bots)

Goal: run thousands of all-bot games at 2–12 players and use the results to tune the placeholder numbers in `docs/design.md`.

### Done
- [x] Game design v0.1 (`docs/design.md`)
- [x] Monorepo skeleton (pnpm workspaces, TypeScript, vitest)
- [x] **Core types** — `GameConfig`, `GameState`, `Command`, `GameEvent` (visibility fixed per event type), `PlayerView`, `canSee()`, plus one sample per event/command type in `packages/engine/src/types/`.

### Next up (in order)
2. [ ] **Seeded RNG** + deterministic setup (deal roles, pick rooms by player count) — design §6.2, §8.1. Pick the algorithm and fill `RngState.words`; setup emits `gameCreated`, `rngSeeded`, `roomsSet`, `roleDealt`.
3. [ ] **Content: bank job** — core rooms, extra rooms by player count, Heat formula, checkpoint targets, starter roles (Rookie, Lookout, Insider, Fence) — design §6, §7, §8, §11.5.
4. [ ] **Round loop** — `submitMove`, default moves, resolution order, Haul/Stash/Heat updates, room-mate sightings, Security result — design §5.
5. [ ] **Alibis** — `postAlibi` command + ledger entry — design §5.4.
6. [ ] **Meetings & votes** — scheduling, emergency meeting, sealed votes, quorum, shakedown, clean threshold & compensation, checkpoint order — design §11.
7. [ ] **End of game** — success/fail, ranking, tie-breaks, reveal view — design §3, §13.
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
- Types only so far: no reducer/command handler yet. Room/role *definitions* (yields, Heat, powers) are still to come in task 3; `packages/content` only has the `RoomId`/`RoleId`/`JobId` aliases.
- `samples.ts` has one sample per event and command type, and the compiler enforces it. The `viewFor()` leak tests in task 8 should loop over `sampleEvents`.
- `AbilityUse` covers only Lookout and Fence. Extend it when the other roles land.
- From the PR #1 review, deferred to the task named:
  - **Task 2 (RNG):** `rng` can't be rebuilt from events that don't record draws. Either random-consuming events carry the post-draw RNG state, or replay works from commands. Either way RNG state must never reach a public/private view (it would let players predict draws).
  - **Task 6 (meetings):** say whether a sealed vote applies to an emergency meeting, and whether it can be withdrawn (`voteSealed` has no meeting/act scope yet). Decide whether a regular meeting slot can arrive mid-act (rounds pause, §4.1) or only after the act's last round.
  - **Tasks 10/11 (sim/balance):** §17.4 "config overrides": add a content-overrides field to `GameConfig`, and a `CONTENT_VERSION` in `gameCreated` so old logs replay against the right numbers.
  - **Remaining roles:** replace the Fence-specific `safe`/`safeDepositedThisAct` with a generic per-player role state (once-per-act/game uses, Snitch target, Mole allies). Some abilities happen outside planning (Muscle cancel after the vote passes, Double-cross accept, Duel call-out §16.1), so add a `useAbility` command (§17.2), and Muscle needs a window between `meetingClosed` and `shakedownResolved` (probably a new `Deadline` kind).
  - **Events deck / Duel mode:** no event types yet (public `eventFlipped`, private Raid rumour / Inside tip results) and no Duel config flag.
