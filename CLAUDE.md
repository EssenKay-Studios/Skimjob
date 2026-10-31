# Skimjob

A social deduction heist game for groups of friends (web + Android/iOS). A crew robs one bank over a session lasting 1 hour to 7 days. Each round, every player secretly picks a room, loots it, and decides how much to hand to the crew's Haul and how much to pocket into their own Stash. The biggest stash wins — but if the heist fails (Heat hits 100 or the final target is missed), nobody wins.

**Pitch:** *Steal from your crew — just don't sink the job.*

## Start of every session

1. Read `docs/STATUS.md` — current milestone, what's done, what's next.
2. Read the relevant sections of `docs/design.md` (the full game design; canonical rules source).
3. Skim `docs/decisions.md` before changing anything that looks like a deliberate choice.
4. Work on **one** task from STATUS.md (or the GitHub issue you were given). Keep sessions scoped.

## End of every session

1. Run tests and typecheck (commands below). Do not leave `main` red.
2. Update `docs/STATUS.md`: tick what's done, add what's next, note anything half-finished.
3. If a rule or design choice changed, update `docs/design.md` **and** add an entry to `docs/decisions.md`.
4. Commit and push.

## Repo layout (pnpm monorepo)

```
packages/engine/   rules, state machine, event log, viewFor() — pure & deterministic
packages/content/  rooms, roles, jobs, events, scaling numbers (data, not logic)
packages/bots/     Agent interface + bot personalities
apps/sim/          CLI simulator and balance reports
apps/server/       (later) authoritative game server, scheduler, chat, push
apps/web/          (later) React browser client
apps/mobile/       (later) React Native / Expo app
docs/              design.md, STATUS.md, decisions.md
```

Dependency direction: `content` ← `engine` ← `bots` ← `sim`/`server`. The engine must never import from bots, sim, or any app.

## Commands

```
pnpm install         # install all workspaces
pnpm test            # run all tests (vitest)
pnpm typecheck       # tsc --noEmit across workspaces
pnpm sim -- --help   # run the simulator (once implemented)
```

## Engine rules (non-negotiable)

- **Deterministic.** All randomness goes through the seeded RNG in the game state. Same seed + same commands = same game. No `Math.random()`, no `Date.now()` inside the engine.
- **No clock.** The engine knows rounds and phases, not wall time. The server/sim calls `advance()` when a deadline passes. Elastic session timing lives outside the engine.
- **Event-sourced.** State = fold over the event log. Ledger, case files, "while you were away" recaps and the end-game reveal are all views over the log.
- **Visibility-scoped.** Every event is tagged `public`, `private:<playerId>`, `reveal`, or `secret:<playerId>` (secret-mode ballots: visible only to the voter, even after the game). `viewFor(state, playerId)` must never leak hidden information. Write a test whenever you add an event type.
- **Content is data.** Numbers, rooms, roles, events live in `packages/content`. If you're hard-coding a number in the engine, it probably belongs in content.
- **Bots are players.** Bots only receive `viewFor()` output and emit the same commands a human client would.
- Every rule in `docs/design.md` that's implemented should have a test that names the design section (e.g. `// design §11.3`).

## Code conventions

- TypeScript, strict mode, ESM. Node 22.
- Tests with vitest, colocated as `*.test.ts`.
- Prefer small pure functions and plain data types over classes.
- No new runtime dependencies in `packages/engine` without a decision-log entry.

## Git

- Author every commit as `karthik24iyer <karthik24iyer@gmail.com>`.
- Never add Claude as author or co-author — no `Co-Authored-By` or `Claude-Session` lines in commit messages.
- Small, focused commits with clear messages. Push to a branch and open a PR for larger changes; trivial doc updates can go to `main`.
