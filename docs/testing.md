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
| Web e2e | `apps/web/e2e/*.spec.ts` | Screens in Chromium at phone and desktop sizes, responsive rules. Size checks wait for the entrance animations to finish first: a box measured mid-animation can come out at 43.99 px. | `pnpm test:e2e` (CI: 6 shards, `--shard=i/6`; ports and clock via `E2E_*` env, see `playwright.config.ts`) |
| Simulation suite | `apps/sim/src/suite/` | The §17.4 targets and role parity over the whole settings matrix, with confidence intervals (below). Manual: long. | `pnpm sim:suite`, or the "Sim suite" workflow |
| Simulator smoke | `scripts/sim-smoke.sh` | 200 all-bot games each at 3/6/12 players (events on, Everything deck) end with no refused bot command. | `bash scripts/sim-smoke.sh [games]` |
| Typecheck | every workspace | Strict TS. New event or command types must fail exhaustive switches. | `pnpm typecheck` |
| Docker image | `Dockerfile` | The production image builds, boots on a fresh volume, serves `/health` and an SPA route, and runs as uid 1000 (CI only; no Docker daemon here). | `docker build -t skimjob .` (docs/deploy.md) |

CI (`.github/workflows/ci.yml`) runs all of these except the simulation suite on every push to `main` and every PR. Deploys are manual-only for now (`deploy.yml`, `docs/deploy.md`).

## Running the suite

Run the suite after any change to rules, numbers or bots. It shows what the change did to balance.

```
pnpm sim:suite                                   # whole matrix, ±2 pp, all CPU cores (hours on a laptop)
pnpm sim:suite -- -p 6 --setups balanced --events on  # one cell
pnpm sim:suite -- --ci 5 --max-games 1000        # quicker and rougher
pnpm sim:suite -- --overrides '{"heat":{"perRound":5}}' --compare docs/balance/baseline.json
pnpm sim:suite -- --help
```

- **Matrix:** player counts 2–12 × setup × events on/off, on the Standard deck (extension.md Build notes "Sim"). Setups (`--setups`): `balanced` (Balanced deal, Exact role list), `random` (Truly random), `possible` and `hidden` (Balanced with that role list); the default is `balanced,random,possible`. `uniqueRoles` and the bot mix stay at their defaults. That makes 66 cells by default.
- **Adaptive:** each cell plays batches of 200 games (`--batch`, at most `--min-games`), starting with at least 400. It stops once every checked rate's 95% interval (Wilson) is within `--ci` (±2 pp), or at `--max-games` (6000). `-n N` plays a fixed N per cell instead.
- **Checks (gates):** only the gated cells, Balanced at 4–12 players, are checked: heist success 55–70%, Heat share of failures 10–20%, comeback ≤ 50%, decided early ≤ 15% and shakedown accuracy (design §17.4), and role parity per player count (docs/roles-v2.md §5, extension.md Build notes "Sim"): win share ÷ fair share 1/n. Since the split gate (PM provisional, 3 Nov) that is two checks: the Team roles' max − min ≤ 0.20 (`TEAM_PARITY_MAX_SPREAD`, provisional until the M2-14 playtests; 0.10 stays the target), and each ★ role's ratio ÷ the Team-role average within 0.9–1.8 (`STAR_BAND`, apps/sim/src/suite/targets.ts; its 95% range divides the ★ interval by the Team-average interval). The all-role max − min is still printed but report-only. Parity stands in for §17.4's "each role within ±5 pp of fair share". Other cells (2–3 players, Truly random, the role-list setups) are reported only and stop at `--min-games`.
- **Reports:** the ending split (success / raid on Heat / missed target), the no-winner and shared-win rates per cell, and a per-role table over all cells: win ÷ fair, the share of wins from success vs failure (★ roles win some failures) and shop tokens earned and spent per seat.
  - A check is **PASS** or **FAIL** only when its whole 95% interval is inside or outside the target. Otherwise it is **inconclusive** (`inconcl.`, more games needed); the point estimate is still printed.
  - Parity's point spread is biased upward by noise: the max − min of many noisy ratios is wide even for a balanced deck. So parity FAILs only when even the closest the per-role intervals allow (`max lo − min hi`) is over 0.10, and PASSes only when the widest (`max hi − min lo`) is within it.
  - A `+` after a cell's game count means it hit `--max-games` (rounded up to whole batches) first. A fixed `-n` run says "Fixed" and has no `+`.
  - Refused bot commands are a FAIL.
- **Exit codes:** 0 ok. 1 = `--strict` and at least one confirmed FAIL. 2 = bad input: arguments, a missing or malformed `--compare` baseline or shard file, an unwritable `--out`. These are all checked before any game runs. 3 = the run itself broke.
- **Caveats:** the intervals are nominal. They are not adjusted for adaptive stopping, which stops on interval width rather than on the estimate, so the effect is small. Nor are they adjusted for running 250+ checks, so expect a few confirmed FAILs by chance when a true rate sits right on a bound.
- **Output:** the report goes to `sim-output/suite.json` (`--out`, or `--no-files`), and the same text is printed. `--json` prints the JSON instead.
- **Compare:** `--compare <report.json>` prints each rate's change in pp. A `*` marks a move bigger than both intervals together. It also lists checks that changed verdict and parity spreads, and notes when the two runs used different seeds or sampling settings. Content overrides don't change the seeds, so a rule change replays the same deals and bot dice, and the deltas are the change, not noise. `docs/balance/baseline.json` is a committed full run (since the R6 balance pass: ±2 pp, 400–6000 games per cell, from the "Sim suite" workflow). Refresh it when a balance pass lands.
- **Deterministic:** every game's seed is `<seed>/<cell>/<n>p/<index>`. The report is byte-identical for any `--workers` or `--shard` split (`suite/determinism.test.ts` checks this with real worker threads). `pnpm sim -- --workers N` also gives the same records for any N.
- **Shards:** `--shard i/n` runs only some cells (split by estimated cost) and writes `sim-output/suite-shard-i-of-n.json`. `pnpm sim:suite -- merge <shards...>` combines them into exactly the report one run would give, and takes `--compare` and `--strict`.
- **On GitHub:** Actions → "Sim suite" → Run workflow (`.github/workflows/sim-suite.yml`, manual only). It runs N shards on separate runners and merges them. It compares with the baseline, puts the text in the run summary and uploads `suite-report` (JSON + text) as an artifact. Inputs: shards, ±pp, max games, overrides JSON, extra options, strict.
- **Cost:** a game takes about 8 ms per player on one core. The default full run is roughly 100–300k games, so use the workflow (10 shards finish in well under an hour) or a narrower matrix locally. Most of a game's time is `viewFor`'s deep copy of the view for every bot (decisions.md, R4a).

## Engine properties

`invariants.prop.test.ts` uses fast-check with a fixed seed. Each run picks a config (2–12 players, every vote mode and Mole setting, events, starter mode, Duel, `uniqueRoles` absent/true/false) and a "tape" of numbers that drives the commands: mostly valid player commands that fit the phase, malformed or hostile ones, and scheduler deadlines (right and wrong), including each round's alibi deadline (§5.4). When the tape runs out, only deadlines pass until the game ends. After every step it checks:

- `handleCommand` never throws, and states are deep-frozen, so a mutation anywhere throws. A refusal has a reason. A command for an unseated player is always refused.
- Loot is conserved: Haul + stashes + safes = loot split from rooms + Snitch payouts − Raid-rumour losses. Nothing goes negative or fractional.
- Heat is a whole number in 0..max, and the game is over once it reaches max.
- The game never gets stuck: until it ends, a deadline the scheduler would send is accepted, and every game ends.
- The phase agrees with `meeting` / `pendingShakedown`, and alibis are open in the alibi phase only. In Duel there is never a meeting.
- The deal follows §8.1, `replay(config, log)` equals the state, and running the same commands again gives the same log.
- `viewFor` doesn't leak. The ledger and case file are exactly what `canSee` allows, others show only public fields, and the seed stays hidden until the reveal. If you change anything a player can't see (others' roles, stashes, moves, ballots, the RNG, hidden events), that player's view stays byte-identical.
- At the end, the ranking matches the final stashes and is sorted by score.

The default is 45 games (about 10 s). To fuzz harder locally:

```
FC_RUNS=500 FC_SEED=777 npx vitest run packages/engine/src/invariants.prop.test.ts
```

A failure prints the broken invariant, the config and `seed`/`path`. Re-run with that `FC_SEED` to reproduce it. Very long runs can print a harmless vitest `onTaskUpdate` RPC timeout.

**When you add something to the engine:**
- A new event that moves loot: add it to `lootFlow` (or to the transfers that cancel out).
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
- Duel.
- 12 players with every role.
- The heist fails by Heat.
- The heist fails by target.
- Hostile socket input.

People are played by bot logic or a small script, over their own sockets. Every story checks:

- **The reveal.** The engine's outcome, everyone ranked, the ranking matching the stashes, and every role shown.
- **`assertCleanSocket`, for every message the socket got.** These rules apply:
  - The socket gets only its own views.
  - The ledger is public and the case file is its own.
  - Every event is in the real log.
  - Others show only public fields.
  - Nothing appears before the reveal: no seed, `rngSeeded` or RNG words, and never `idx` or `config`.
  - Replies only answer that socket's own commands.

Until M2-4 lands, `nextDeadline` (round, alibi, meeting and shakedown deadlines in `runBotGame`'s order) stands in for the scheduler and sends deadlines through `app.live.system`. Once M2-4 lands, drive time with the fake clock instead.

Add a story when you fix a server bug, or when a feature changes how a game flows (scheduler, chat, host controls).

## Hostile command values

`commands.hostile.test.ts` takes, in states across every phase (and Duel), a command of every type that the engine accepts there, then replaces each field in turn (nested objects and lists such as `move`, `ability`, `vote`, `deadline` and `rooms` as well as their leaves) with hostile values: objects with no string form (`{"toString":null}`), prototype keys (`__proto__`, `constructor`, `toString`, …), values of the wrong type, over-long strings, `undefined`, or the field left out (except the optional `move.ability`). Each must be refused (not thrown) and leave the state unchanged, every field must have been tried against an accepted command, and every command type the engine handles (`COMMAND_TYPES`) must be in the list. Refusal reasons print command values with `show()` (`check.ts`), never `String()` or a raw template string, and cut strings over 40 characters short. Add the fields of any new command type to `baseCommands`.

## Known bugs pinned by tests

None open. (Fixed: the engine threw on values with no string form such as `{"toString":null}`; see above.)
