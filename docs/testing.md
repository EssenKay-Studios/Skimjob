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
| Web e2e | `apps/web/e2e/*.spec.ts` | Screens in Chromium at phone and desktop sizes, responsive rules. Size checks wait for the entrance animations to finish first: a box measured mid-animation can come out at 43.99 px. | `pnpm test:e2e` |
| Simulation suite | `apps/sim/src/suite/` | The §17.4 targets and role parity over the whole settings matrix, with confidence intervals (below). Manual: long. | `pnpm sim:suite`, or the "Sim suite" workflow |
| Simulator smoke | `scripts/sim-smoke.sh` | 200 all-bot games each at 3/6/12 players (events on, Mole "maybe") end with no refused bot command. | `bash scripts/sim-smoke.sh [games]` |
| Typecheck | every workspace | Strict TS. New event or command types must fail exhaustive switches. | `pnpm typecheck` |
| Docker image | `Dockerfile` | The production image builds, boots on a fresh volume, serves `/health` and an SPA route, and runs as uid 1000 (CI only; no Docker daemon here). | `docker build -t skimjob .` (docs/deploy.md) |

CI (`.github/workflows/ci.yml`) runs all of these except the simulation suite on every push to `main` and every PR. A green run on `main` deploys to Fly (`deploy.yml`, `docs/deploy.md`).

## Running the suite

Run the suite after any change to rules, numbers or bots. It shows what the change did to balance.

```
pnpm sim:suite                                   # whole matrix, ±2 pp, all CPU cores (hours on a laptop)
pnpm sim:suite -- -p 6 --mole maybe --events on  # one cell
pnpm sim:suite -- --ci 5 --max-games 1000        # quicker and rougher
pnpm sim:suite -- --overrides '{"heat":{"perRound":5}}' --compare docs/balance/baseline.json
pnpm sim:suite -- --help
```

- **Matrix:** player counts 2–12 × saboteur setting (off / maybe / on, skipping a setting that deals exactly like another at that size) × events on/off. `uniqueRoles` and the bot mix stay at their defaults. That makes 50 cells today.
- **Adaptive:** each cell plays batches of 200 games, starting with at least 400. It stops once every checked rate's 95% interval (Wilson) is within `--ci` (±2 pp), or at `--max-games` (6000). `-n N` plays a fixed N per cell instead.
- **Checks:** each cell is checked for heist success 55–70%, saboteur win rate 30–40% (where one can be dealt), Heat share of failures 10–20%, comeback ≤ 50% and decided early ≤ 15% (design §17.4). Role parity is checked per player count and saboteur setting (docs/roles-v2.md §5): win share ÷ fair share 1/n, with max − min ≤ 0.10. Each check prints PASS or FAIL. A `?` means the 95% interval crosses the target, so more games could flip it. A `+` after a cell's game count means it hit `--max-games` first. Refused bot commands are a FAIL. `--strict` exits 1 on any FAIL.
- **Output:** the report goes to `sim-output/suite.json` (`--out`, or `--no-files`), and the same text is printed. `--json` prints the JSON instead.
- **Compare:** `--compare <report.json>` prints each rate's change in pp. A `*` marks a move bigger than both intervals together. It also lists checks that changed verdict and parity spreads. Content overrides don't change the seeds, so a rule change replays the same deals and bot dice, and the deltas are the change, not noise. `docs/balance/baseline.json` is a committed moderate run (±5 pp, 200–400 games per cell). Refresh it when a balance pass lands.
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
