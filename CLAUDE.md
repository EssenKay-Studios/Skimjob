# Skimjob

A social deduction heist game for groups of friends (web + Android/iOS). A crew robs one bank over a session lasting 1 hour to 7 days. Each round, every player secretly picks a room, grabs coins there (more coins ring more of the room's alarm bell) and drags each coin into the crew duffel or their own pocket. The duffel is split equally among everyone; the pocket is yours alone. The bank holds a fixed pile of coins and the game ends when it is empty, at the round cap, or on a bust. Alarm bells that fill up bring a police raid and raise Wanted (3 stars is a bust). If less than two-thirds of the coins taken reached the duffel, the heist fails and nobody wins; otherwise every player tied for the biggest stash wins (the whole crew, when every stash is equal).

**Pitch:** *Steal from your crew — just don't sink the job.*

## Start of every session

1. Read `docs/STATUS.md` — where things stand and the standing engineering notes. Tasks, follow-ups and owner questions are GitHub issues (R7 board and milestone, linked from STATUS).
2. Read the rules: `docs/design.md` is the single rules spec (R7 Simplified). `docs/simplified.md` is the R7 plan and how it is run.
3. Skim `docs/decisions.md` before changing anything that looks like a deliberate choice.
4. Work on **one** task: the GitHub issue you were given. Keep sessions scoped.

## End of every session

1. Run `pnpm precheck` (commands below) before every push; CI runs the same checks and the scoped set, and must be green, and the full tier runs on `main` after the merge (`docs/testing.md`).
2. Don't edit `docs/STATUS.md` or `docs/decisions.md` in a feature PR: put "Closes #N" (your issue) in the PR body, provisional rule calls under `## Decisions` and new follow-ups under `## Follow-ups`; the PM folds decisions into `docs/decisions.md` (in its own docs PR) and creates issues from the follow-ups. If a rule changed, update `docs/design.md` in the PR.
3. Commit to your branch, push it and open a PR (`docs/pipeline/common.md`).

## Repo layout (pnpm monorepo)

```
packages/engine/   rules, state machine, event log, viewFor() — pure & deterministic
packages/content/  rooms, roles, perks, events, numbers (data, not logic)
packages/bots/     Agent interface + bot personalities
apps/sim/          CLI simulator and balance reports
apps/server/       authoritative game server, scheduler, chat, push
apps/web/          React browser client
apps/mobile/       (later) Flutter app (Android/iOS) — talks to the server; no engine copy
docs/              design.md (the rules spec), simplified.md (the R7 plan), advanced.md (later paid version), STATUS.md, decisions.md, testing.md, deploy.md, ui-style.md, pipeline/, archive/
```

Dependency direction: `content` ← `engine` ← `bots` ← `sim`/`server`. The engine must never import from bots, sim, or any app.

## Commands

```
pnpm install         # install all workspaces
pnpm test            # run all tests (vitest)
pnpm test:scoped     # only the tests your diff needs (same logic as CI)
pnpm precheck        # before every push: typecheck, knip, theme-token lint, test:scoped, new e2e specs x3
pnpm lint:theme      # raw colours, fonts, shadows, radii outside theme.css
pnpm knip            # unused files, exports and dependencies (CI fails on any)
pnpm typecheck       # tsc --noEmit across workspaces
pnpm sim -- --help   # run the simulator (once implemented)
```

## Engine rules (non-negotiable)

- **Deterministic.** All randomness goes through the seeded RNG in the game state. Same seed + same commands = same game. No `Math.random()`, no `Date.now()` inside the engine.
- **No clock.** The engine knows rounds and phases, not wall time. The server/sim calls `advance()` when a deadline passes. Elastic session timing lives outside the engine.
- **Event-sourced.** State = fold over the event log. The ledger, case board, "while you were away" recaps and the end-game reveal are all views over the log.
- **Visibility-scoped.** Every event is tagged `public`, `private:<playerId>`, `reveal`, or `secret:<playerId>` (secret-mode ballots: visible only to the voter, even after the game). `viewFor(state, playerId)` must never leak hidden information. Write a test whenever you add an event type.
- **Content is data.** Numbers, rooms, roles, events live in `packages/content`. If you're hard-coding a number in the engine, it probably belongs in content.
- **Bots are players.** Bots only receive `viewFor()` output and emit the same commands a human client would.
- Every implemented rule should have a test that names its spec section (e.g. `// design §5.3`).

## UI rules (non-negotiable for every page, panel and component)

- **One look everywhere:** the hand-drawn cartoon notebook style in `docs/ui-style.md` (cream paper, wobbly ink outlines, hatched shadows, tape, Pangolin headings + Inter body, clay-orange accent, springy motion). No screen may fall back to plain/default UI.
- **Build from the shared kit only:** `apps/web` theme tokens (`theme.css`) and shared components (`SketchFrame`, buttons, avatars, …). No raw colours, fonts, shadows or radii outside `theme.css`; add a token or component instead.
- **New component → add it to `/dev/gallery`** so the whole kit stays visible in one place.
- **Responsive web is the launch product:** check every UI change at 360, 390, 768, 1024 and 1280 px — no horizontal overflow, touch targets ≥ 44 px, safe-area insets, no hover-only interactions. Reviewers screenshot and look.
- **Style only from CityRT** — never copy its logo, name or artwork.

## Code conventions

- TypeScript, strict mode, ESM. Node 22.
- Tests with vitest, colocated as `*.test.ts`.
- Prefer small pure functions and plain data types over classes.
- **Minimal change.** Every change is the smallest that fully delivers its task. Delete what it supersedes in the same PR. No speculative abstractions, options, config, flags, shims, fallbacks or commented-out code (the cleanup rules in `docs/simplified.md`). Quality is not negotiable: tests for every rule including edge cases, design citations, the UI rules and the notebook look.
- No new runtime dependencies in `packages/engine` without a decision-log entry.

## Git

- Author every commit as `karthik24iyer <karthik24iyer@gmail.com>`.
- Never add Claude as author or co-author — no `Co-Authored-By` or `Claude-Session` lines in commit messages.
- Small, focused commits with clear messages. **Everything goes through a PR, docs included; never push to `main`.** Only the PM merges, with `docs/pipeline/merge.sh <PR>` once the gate passes (`docs/pipeline/HANDOFF.md`).
