# Status

_Last updated: 31 Oct 2026_

## Current milestone: M1 — Engine + simulator (bank job, starter roles, bots)

Goal: run thousands of all-bot games at 2–12 players and use the results to tune the placeholder numbers in `docs/design.md`.

### Done
- [x] Game design v0.1 (`docs/design.md`)
- [x] Monorepo skeleton (pnpm workspaces, TypeScript, vitest)

### Next up (in order)
1. [ ] **Core types** — `GameConfig`, `GameState`, `Command`, `GameEvent` (with visibility), `PlayerView` in `packages/engine`.
2. [ ] **Seeded RNG** + deterministic setup (deal roles, pick rooms by player count) — design §6.2, §8.1.
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
_None yet._
