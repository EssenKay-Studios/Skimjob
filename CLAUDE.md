# Skimjob

A social deduction heist game for groups of friends (web + Android/iOS). A crew robs one bank over a session lasting 1 hour to 7 days. Each round, every player secretly picks a room, loots it, and decides how much to hand to the crew's Haul and how much to pocket into their own Stash. The biggest stash wins — but if the heist fails (Heat hits 100 or the final target is missed), nobody wins.

**Pitch:** *Steal from your crew — just don't sink the job.*

## Start of every session

1. Read `docs/STATUS.md` — current milestone, what's done, what's next.
2. Read the relevant sections of `docs/design.md` (the full game design; canonical rules source) and, for roles, tokens and the shop, `docs/extension.md` (the R6 spec; it wins on conflict).
3. Skim `docs/decisions.md` before changing anything that looks like a deliberate choice.
4. Work on **one** task from STATUS.md (or the GitHub issue you were given). Keep sessions scoped.

## End of every session

1. Run typecheck and the tests relevant to your change (commands below); CI runs the full suite and must be green.
2. Don't edit `docs/STATUS.md` or `docs/decisions.md` in a feature PR: put `## Decisions` and `## STATUS updates` sections in the PR body; the PM folds them in (in its own docs PR). If a rule changed, update `docs/design.md` in the PR.
3. Commit to your branch, push it and open a PR (`docs/pipeline/common.md`).

## Repo layout (pnpm monorepo)

```
packages/engine/   rules, state machine, event log, viewFor() — pure & deterministic
packages/content/  rooms, roles, jobs, events, scaling numbers (data, not logic)
packages/bots/     Agent interface + bot personalities
apps/sim/          CLI simulator and balance reports
apps/server/       authoritative game server, scheduler, chat, push
apps/web/          React browser client
apps/mobile/       (later) Flutter app (Android/iOS) — talks to the server; no engine copy
docs/              design.md, extension.md (R6 rules), STATUS.md, decisions.md, deploy.md, pipeline/, archive/
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
- No new runtime dependencies in `packages/engine` without a decision-log entry.

## Git

- Author every commit as `karthik24iyer <karthik24iyer@gmail.com>`.
- Never add Claude as author or co-author — no `Co-Authored-By` or `Claude-Session` lines in commit messages.
- Small, focused commits with clear messages. **Everything goes through a PR, docs included; never push to `main`.** Only the PM merges, with `docs/pipeline/merge.sh <PR>` once the gate passes (`docs/pipeline/HANDOFF.md`).
