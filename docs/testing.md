# Testing

**The rule:** every bug fix adds a scenario or an invariant that would have caught it, and it goes in the same PR as the fix.

All tests are seeded and deterministic. Nothing reads the wall clock (the server takes a `fakeClock`) and nothing needs the network.

## Layers

| Layer | Where | What it guards | Run |
|---|---|---|---|
| Unit / rule tests | `packages/*/src/*.test.ts`, `apps/*/src/*.test.ts` | One rule or helper each. Rule tests name their design section (`// design §11.3`). | `pnpm test` |
| QA tests | `*.qa.test.ts` | Adversarial and edge cases per feature (written by QA for each PR). | `pnpm test` |
| Engine properties | `packages/engine/src/invariants.prop.test.ts` | Invariants under random configs and command streams (below). | `pnpm test` or `npx vitest run packages/engine/src/invariants.prop.test.ts` |
| Server scenarios | `apps/server/src/scenarios.int.test.ts` | Named end-to-end stories over the real HTTP + WebSocket API on PGlite. | `pnpm test` (`pnpm test:pg` for real Postgres) |
| Web e2e | `apps/web/e2e/*.spec.ts` | User journeys in Chromium at phone and desktop sizes, responsive rules; every test title carries one feature tag. Size checks wait for the entrance animations to finish first: a box measured mid-animation can come out at 43.99 px. | `pnpm test:e2e` (CI: 6 shards by spec file, `node scripts/scope.mjs --shard i/6`, see "Shards" below; ports and clock via `E2E_*` env, see `playwright.config.ts`) |
| Simulation suite | `apps/sim/src/suite/` | The balance targets and role parity over the whole settings matrix, with confidence intervals (below). Manual: long. | `pnpm sim:suite`, or the "Sim suite" workflow |
| Simulator smoke | `scripts/sim-smoke.sh` | 200 all-bot games each at 3/6/12 players (events on, Everything deck) end with no refused bot command. | `bash scripts/sim-smoke.sh [games]` |
| Typecheck | every workspace | Strict TS. New event or command types must fail exhaustive switches. | `pnpm typecheck` |
| Dead code | every workspace | `knip` fails on unused files, exports and dependencies (`knip.json`; zero today, keep it so). | `pnpm knip` |
| Theme tokens | `apps/web/src` (`.css`, `.ts`, `.tsx`), `scripts/theme-lint.mjs` | No raw colours, fonts, shadows or radii outside `theme.css` (CLAUDE.md UI rules). One lint for the whole app; it replaces the per-module token tests. | `pnpm lint:theme` |
| Feature coverage | `apps/web/e2e/features.json` | Every e2e test has exactly one feature tag, every tag has a test, every screen, panel or feature module reaches an entry. | `node scripts/scope.mjs --check` |

Tests that check the R6 rules (Heat, loot, tokens) are replaced in S3 by tests of the R7 rules.

## Scoped tests

A PR waits only for the tests of what it touched; `main` is tested in full after every merge. CI (`.github/workflows/ci.yml`) and `pnpm test:scoped` use the same decision, `scripts/scope.mjs`, so what you run locally is what CI runs. Nothing deploys from CI; releases go to Lightsail by hand (`docs/deploy.md`).

**Feature tags and `features.json`.** Every e2e test title carries exactly one feature tag (`@board`, `@move`, `@meeting`, `@chat`, `@shop`, `@reveal`, `@lobby`, `@auth`, `@host`, `@caseboard`, `@plan`; new ones arrive with their feature). `apps/web/e2e/features.json` maps only **entry points** to tags: the web screens and top-level panels, and the engine and server modules that implement a feature (`packages/engine/src/meeting.ts` is `@meeting`, `apps/server/src/chat.ts` is `@chat`). An entry can list several tags, or `"*"` for a shared module (`live.ts`, `store.ts`, `db.ts`, ...) whose change, or a change to anything it imports, runs everything.

**From a diff to a run.** For each changed file the script follows the import graph (workspace packages included) up to the entry points that depend on it, stopping at each, and runs the union of their tags. A shared module (`api.ts`, `router.ts`, `useGame.ts`, the UI kit) reaches several entries, so it runs everything. A file that reaches no entry, or 3+ tags, runs everything too, and so does a file that a `"*"` module imports (bots, which `live.ts` uses, included). A deleted or renamed spec runs nothing; a deleted source file runs everything (its importers changed too, but nothing is left to follow).

| Changed | Runs |
|---|---|
| Docs only | Typecheck, knip, all unit tests |
| Any code | Typecheck, knip and the theme-token lint (whole repo); unit, property and server tests of the changed packages and the packages that depend on them; the e2e tags from the graph |
| A unit test file | That package's unit tests only. A changed spec runs its own tag |
| Engine, content or bots | Also the engine package (property tests, `viewFor` leak scrub) and a 50-game sim smoke at 3/6/12 players |
| Server | Also `@lobby @host` |
| Config (`package.json`, lockfile, `tsconfig*`, vitest or playwright config, `.github/`, `scripts/`), `features.json`, the scoping script, any non-source file | **Everything** (the full tier) |

**The full tier** (all unit tests, all e2e on 6 shards, the 200-game sim smoke) runs on every push to `main` and nightly, and for the PRs in the last row. If it fails after a merge, merging stops until a fix-forward PR is green; that PR adds the test, and the `features.json` mapping, that would have caught it in the scoped tier.

**The gate.** The always-on **CI ok** job depends on every other job and passes when each passed or was skipped on purpose; branch protection and the merge gate (`docs/pipeline/verdicts.sh`, which needs every check-run on the head green and a `CI ok` check-run that completed with success: missing, pending, skipped or neutral is a no) rely on it.

**Adding a feature.** Give each new screen, panel or feature module an entry in `features.json`, tag its specs, and run `node scripts/scope.mjs --check` (CI runs it). QA's adversarial specs go in `<feature>.qa.spec.ts` under the same tag.

**Shards.** CI splits the e2e specs over 6 jobs by file, heaviest first onto the lightest shard (`node scripts/scope.mjs --shard i/6`), using `apps/web/e2e/shard-weights.json` (seconds per spec file from a local run; a file without an entry counts 60). Playwright's own `--shard` slices by test count, which put the slow full-game tests (`@fast-clock` and the 15-minute bot games) and the skipped per-project tests in a few shards: 23 min against 2 min on a main run. Locally the shards are within 1% of each other. CI caches the pnpm store (`setup-node`'s `cache: pnpm`) and the Playwright browser download (`actions/cache`, keyed on the Playwright version; the system libraries are still installed each run). After adding or reworking slow specs, refresh the weights: run `npx playwright test --reporter=json` in `apps/web`, sum each file's test durations.

## Precheck

`pnpm precheck` is the one command to run before every push (builder and QA, `docs/pipeline/common.md`). It runs what CI would fail on, so a push is green the first time:

1. In parallel: `pnpm typecheck`, `pnpm knip`, `pnpm lint:theme` and `node scripts/scope.mjs --check` (feature tags and `features.json` entries).
2. `pnpm test:scoped` (the tests the diff needs, as in "Scoped tests").
3. Playwright `--repeat-each=3` on the e2e specs the branch adds or changes against `origin/main` (`changedPaths()` and `SPEC` from `scripts/scope.mjs`), so a flaky new spec fails here, not on the PM's merge.

It stops at the first failing step, and does nothing at all when only `.md` files changed. Locally Playwright runs up to 4 workers per run, and always starts its own servers: a port already in use makes the run fail loudly rather than test another agent's server (`playwright.config.ts`).

**Theme-token lint.** `scripts/theme-lint.mjs` checks every `.css`, `.ts` and `.tsx` file under `apps/web/src` except `theme.css` and tests: no raw colour (`#hex`, `rgb()`, `hsl()`, ...), `font-family`/`font` only a `--font-*` token or `inherit`, and `border-radius`, `box-shadow` and `text-shadow` only `var(--...)`, `0`, `none` or `inherit`. `scripts/theme-lint.baseline.json` holds the number of violations per file that predate the lint; it can only go down (a file over its count, or any count for a file not listed, fails). When you clean a file up, run `node scripts/theme-lint.mjs --update` to lower it. The baseline only shrinks: reviewers reject a PR whose baseline diff adds a file or raises a number (`--update` does not stop it). S4 removes entries as it replaces the R6 screens. New styles use or add a `theme.css` token.

## Running the suite

Run the suite after any change to rules, numbers or bots. It shows what the change did to balance.

```
pnpm sim:suite                                   # whole matrix, ±2 pp, all CPU cores (hours on a laptop)
pnpm sim:suite -- -p 6 --setups balanced --events on  # one cell
pnpm sim:suite -- --ci 5 --max-games 1000        # quicker and rougher
pnpm sim:suite -- --compare docs/balance/baseline.json
pnpm sim:suite -- --help
```

- **Matrix:** player counts 3–12 × setup × events on/off, with setups (`--setups`) such as `balanced` (Balanced deal, Exact role list) and `random` (Truly random). The matrix is rebuilt for the R7 rules in S3 and tuned in S5.
- **Adaptive:** each cell plays batches of 200 games (`--batch`, at most `--min-games`), starting with at least 400. It stops once every checked rate's 95% interval (Wilson) is within `--ci` (±2 pp), or at `--max-games` (6000). `-n N` plays a fixed N per cell instead.
- **Checks (gates):** the S5 balance gates (heist success, raid and bust rates, role win rates within a band, the share of whole-crew wins, perks not deciding games) are set in S1 and wired in S3. Cells outside the gated set are reported only and stop at `--min-games`.
- **Reports:** the ending split, the no-winner and shared-win rates per cell, and a per-role table over all cells (win ÷ fair share).
  - A check is **PASS** or **FAIL** only when its whole 95% interval is inside or outside the target. Otherwise it is **inconclusive** (`inconcl.`, more games needed); the point estimate is still printed.
  - Parity's point spread is biased upward by noise: the max − min of many noisy ratios is wide even for a balanced deck. So parity FAILs only when even the closest the per-role intervals allow (`max lo − min hi`) is over 0.10, and PASSes only when the widest (`max hi − min lo`) is within it.
  - A `+` after a cell's game count means it hit `--max-games` (rounded up to whole batches) first. A fixed `-n` run says "Fixed" and has no `+`.
  - Refused bot commands are a FAIL.
- **Exit codes:** 0 ok. 1 = `--strict` and at least one confirmed FAIL. 2 = bad input: arguments, a missing or malformed `--compare` baseline or shard file, an unwritable `--out`. These are all checked before any game runs. 3 = the run itself broke.
- **Caveats:** the intervals are nominal. They are not adjusted for adaptive stopping, which stops on interval width rather than on the estimate, so the effect is small. Nor are they adjusted for running 250+ checks, so expect a few confirmed FAILs by chance when a true rate sits right on a bound.
- **Output:** the report goes to `sim-output/suite.json` (`--out`, or `--no-files`), and the same text is printed. `--json` prints the JSON instead.
- **Compare:** `--compare <report.json>` prints each rate's change in pp. A `*` marks a move bigger than both intervals together. It also lists checks that changed verdict and parity spreads, and notes when the two runs used different seeds or sampling settings. Content overrides don't change the seeds, so a rule change replays the same deals and bot dice, and the deltas are the change, not noise. `docs/balance/baseline.json` is a committed full run (±2 pp, 400–6000 games per cell, from the "Sim suite" workflow). Refresh it when a balance pass lands (S5).
- **Deterministic:** every game's seed is `<seed>/<cell>/<n>p/<index>`. The report is byte-identical for any `--workers` or `--shard` split (`suite/determinism.test.ts` checks this with real worker threads). `pnpm sim -- --workers N` also gives the same records for any N.
- **Shards:** `--shard i/n` runs only some cells (split by estimated cost) and writes `sim-output/suite-shard-i-of-n.json`. `pnpm sim:suite -- merge <shards...>` combines them into exactly the report one run would give, and takes `--compare` and `--strict`.
- **On GitHub:** Actions → "Sim suite" → Run workflow (`.github/workflows/sim-suite.yml`, manual only). It runs N shards on separate runners and merges them. It compares with the baseline, puts the text in the run summary and uploads `suite-report` (JSON + text) as an artifact. Inputs: shards, ±pp, max games, overrides JSON, extra options, strict.
- **Cost:** a game takes about 8 ms per player on one core. The default full run is roughly 100–300k games, so use the workflow (10 shards finish in well under an hour) or a narrower matrix locally. Most of a game's time is `viewFor`'s deep copy of the view for every bot.

## Engine properties

`invariants.prop.test.ts` uses fast-check with a fixed seed. Each run picks a config (players, every vote mode, events on/off) and a "tape" of numbers that drives the commands: mostly valid player commands that fit the phase, malformed or hostile ones, and scheduler deadlines (right and wrong). When the tape runs out, only deadlines pass until the game ends. After every step it checks:

- `handleCommand` never throws, and states are deep-frozen, so a mutation anywhere throws. A refusal has a reason. A command for an unseated player is always refused.
- Loot is conserved across the Haul, stashes and safes. Nothing goes negative or fractional.
- Every open bell is a whole number below its size, a taped-off room has no bell, Wanted equals the raids so far, and the game is over once Wanted reaches the bust line (design §5).
- The game never gets stuck: until it ends, a deadline the scheduler would send is accepted, and every game ends.
- The phase agrees with `meeting` / `pendingShakedown`, and alibis are open in the alibi phase only.
- The deal follows the design, `replay(config, log)` equals the state, and running the same commands again gives the same log.
- `viewFor` doesn't leak. The ledger is exactly what `canSee` allows, others show only public fields, and the seed stays hidden until the reveal. If you change anything a player can't see (others' roles, stashes, moves, ballots, the RNG, hidden events), that player's view stays byte-identical.
- At the end, the ranking matches the final stashes and is sorted by score.

The default is 45 games (about 10 s). To fuzz harder locally:

```
FC_RUNS=500 FC_SEED=777 npx vitest run packages/engine/src/invariants.prop.test.ts
```

A failure prints the broken invariant, the config and `seed`/`path`. Re-run with that `FC_SEED` to reproduce it. Very long runs can print a harmless vitest `onTaskUpdate` RPC timeout.

**When you add something to the engine:**
- A new event that moves coins: add it to `lootFlow` (or to the transfers that cancel out).
- A new command: add it to `playerCommand` (valid shapes) and `garbageCommand` (bad ones).
- A new hidden state field: add it to `scrub`.
- A new deadline: add it to `nextDeadlines`.

## Server scenarios

`scenarios.int.test.ts` has one test per story:

- Host creates a game, guests join by invite, bots fill the seats, then a full game plays to the reveal.
- Disconnect and reconnect mid-meeting.
- Two tabs for one seat.
- Idle people get default moves.
- Server restart mid-round.
- Emergency meeting during its notice period.
- 12 players with every role.
- The crew is busted (Wanted 3); only the Rooftop gets away.
- The heist fails by target.
- Hostile socket input.

People are played by bot logic or a small script, over their own sockets. Every story checks:

- **The reveal.** The engine's outcome, everyone ranked, the ranking matching the stashes, and every role shown.
- **`assertCleanSocket`, for every message the socket got.** These rules apply:
  - The socket gets only its own views.
  - The ledger is public.
  - Every event is in the real log.
  - Others show only public fields.
  - Nothing appears before the reveal: no seed, `rngSeeded` or RNG words, and never `idx` or `config`.
  - Replies only answer that socket's own commands.

Add a story when you fix a server bug, or when a feature changes how a game flows (scheduler, chat, host controls).

## Hostile command values

`commands.hostile.test.ts` takes, in states across every phase, a command of every type that the engine accepts there, then replaces each field in turn (nested objects and lists such as `move`, `ability`, `vote`, `deadline` and `rooms` as well as their leaves) with hostile values: objects with no string form (`{"toString":null}`), prototype keys (`__proto__`, `constructor`, `toString`, …), values of the wrong type, over-long strings, `undefined`, or the field left out (except the optional `move.ability`). Each must be refused (not thrown) and leave the state unchanged, every field must have been tried against an accepted command, and every command type the engine handles (`COMMAND_TYPES`) must be in the list. Refusal reasons print command values with `show()` (`check.ts`), never `String()` or a raw template string, and cut strings over 40 characters short. Add the fields of any new command type to `baseCommands`.
