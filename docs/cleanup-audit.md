# R7 code cleanup audit (step C1)

*4 Nov 2026 · step C1 of `docs/simplified.md` ("C — clean the code"). Deletes nothing. Base: `origin/main` at `f4ee6b1`. This file is deleted again at S5.*

## Owner summary (one page)

**What this is.** Before any R7 code is written, every file in the repo was sorted into four lists: dead now, cut by R7 regardless, replaced later by S3/S4, and keep. A dead-code checker (`knip`) now runs with `pnpm knip`; it is not in CI yet (that is C3).

**The numbers.** The code is about **67,000 lines** (source, tests, CSS, e2e, config; docs excluded), and about half of it (~34,700) is tests.

| List | What | About how many lines | Gone by |
|---|---|---|---|
| 1. Dead now | 10 exports and 3 types unused anywhere (the `V013_NUMBERS` test helper among them), 1 duplicate, 63 exports used only inside their own file | ~105 | C2d |
| 2. Cut by R7 regardless | Duel and 2-player games; 11 R6-only roles; 5 dropped event cards; the Server room's "pocket count"; the Quick/starter *mode*; the old saboteur setting | **~7,800** (≈2,000 code, ≈5,800 tests), plus up to ~1,500 test lines merged in C2e | C2a–C2e |
| 3. Replaced in S3/S4 | Heat, loot and splits, acts and checkpoints, tokens and the R6 shop, police moments, the R6 ledger/case file/suspicion board, R6 reveal parts, the R6 UI panels | ~24,900 | the S3/S4 PR that replaces each |
| 4. Keep | RNG, event log, visibility and `viewFor`, meetings and voting, chat, server, lobby, auth, scheduler, host controls, UI kit, art, sim harness | ~34,600 (some to trim in S3) | stays |

**After C2** (five PRs, one cut feature each: Duel, Quick mode, cut roles, dropped events, test merges) the repo should be about **58,000 lines** (−14%), the game still runs as R6 minus the cut features, and `knip` reports nothing. The big shrink comes in S3/S4, which replace list 3 instead of adding beside it; the expected size after S4 is roughly 45,000–50,000 lines.

**What will be gone after C2:** Duel mode (2-player call-outs), the Inside Man, Getaway Driver, Fence, Blackmailer, Forger, Muscle, Snitch, Bagman, Cleaner, Mastermind and Embezzler; the Quiet night, Payday, Power cut, Raid rumour and Double-cross cards; the Server room's power; the old saboteur ("mole") setting migration; 3 whole test files, and the duplicate test cases C2e confirms.

**Risks to watch** (details at the end):
1. **Quick is two things.** It is a game mode (Starter deck, no shop, no events), which R7 cuts in C2b, and the 15-minute session length that every e2e full game and many server tests use. A 15-minute session is still a valid R7 host choice (the session length is divided by the round cap), so the preset stays, relabelled "15 min"; its id `quick` is renamed in S3a.3 with the timing table. Learn the game (S4.10) replaces the mode.
2. **Starter deck shrinks** to Rookie + Lookout once Bagman, Cleaner and Inside Man go, so Quick and starter-mode games are mostly Rookies until S3a.6. Playable, but dull.
3. **The Balanced deal loses all its Wildcards and its second lone wolf.** Every Wildcard role (Getaway Driver, Fence, Blackmailer, Forger) and the Embezzler are cut. The deal already caps each draw at its pool size, so it still deals: Team players plus at most one Mole. Tests and sim cells that expect a Wildcard or two lone wolves change in C2c.
4. **Games need 3+ players.** `MIN_PLAYERS` goes from 2 to 3 with Duel (C2a). The C2a dry run showed this is the biggest cost: 105 of its 158 failing unit tests were 2-player fixtures ("a game needs 3–12 players"), in 47 test files.
5. **The shakedown window stays** (the Shield still uses it after the Muscle goes); it goes in S3a.7 with the Shield.
6. **Biggest C2 cost found by the dry run:** moving every 2-player test to 3 players (47 test files) when Duel goes.

---

## Method

1. **knip 6.44** added as a root dev dependency, `knip.json` at the root, script `pnpm knip`. Each workspace has its real entry points: package `src/index.ts` (with `includeEntryExports` for engine, content and bots, so a re-export nobody imports is reported), `apps/sim` CLI and worker, `apps/server` `main.ts` and `build.mjs`, `apps/web` `main.tsx`, Vite and Playwright configs (picked up by knip's plugins), every `*.test.ts`, every e2e `*.spec.ts` and the art harness. Types and interfaces that are used in their own file (the members of the `GameEvent` union, for example) are not reported (`ignoreExportsUsedInFile` for types only), which removed ~100 lines of noise; values exported but used only in their own file are still reported.
2. **knip result (default mode):** 0 unused files, 0 unused dependencies, 0 unlisted dependencies, **73 unused exports, 3 unused exported types, 1 duplicate export**. With `ignoreExportsUsedInFile: true` for everything, 10 exports (counting the `MeetingName` type re-export) and 3 types are unused anywhere at all (list 1a); the other 63 are used only in their own file (list 1b).
3. **knip `--production`** (tests excluded) also run as a cross-check: 8 test-only files (the testkits and `samples.ts`, all expected) and ~170 exports used only by tests. Those are mostly helpers exported for their unit tests and are not dead; they are not listed, except where the code they test is cut.
4. **By hand:** every workspace read area by area (file headers, the role, event, perk and job content, the deal, the deadline rules, settings, bot decision code, sim args and suite, every web screen, gallery page and e2e spec, the CI workflows and scripts). Cut-feature reach was measured by grep over identifiers (`duel`, `callOut`, the 11 role ids, the 5 card ids, `pocketCount`, `V01_NUMBERS`, …); line counts below are `wc -l` for whole files and estimates (±30%) for parts of mixed files.
5. Test-duration data was not collected (the cloud box has 2 cores and the brief forbids running the full suite); slow-test notes come from what the tests do (full games, 12 seats, property runs).

**C2 PR key (by feature, PM decision on review):** each C2 PR removes one cut feature from every package it touches, so typecheck and all tests pass after each PR on its own. **C2a** Duel and 2-player games · **C2b** Quick/starter mode · **C2c** cut roles and the `mole?` setting · **C2d** dropped events, the Server room power, the v0.1 testkit leftovers and list 1 · **C2e** test consolidation. They land in this order. File lists and dry-run results: "C2 slices" below.

---

## C2 slices (by feature) and dry runs

PM decision on review: C2 is split **by feature, not by package**. Each slice removes its feature from engine, content, bots, sim, server, web, e2e, tests and fixtures together, so `pnpm typecheck` and every unit test pass after each PR alone. Order: C2a → C2b → C2c → C2d → C2e. Symbols are named, never line ranges.

Dry runs were done in a scratch worktree from `origin/main` that was never pushed and was then discarded. A **full** dry run deletes the slice, makes its edits and runs typecheck plus the unit tests. A **type-level** dry run removes the slice's types and ids and records every file the compiler flags, which is the complete list of files that must change. Role ids are plain strings, so the compiler can't see them; their users were listed by grep instead.

### C2a — Duel and 2-player games (full dry run)

- **Delete:** `packages/engine/src/duel.ts`, `duel.test.ts`, `duel.qa.test.ts`.
- **Edit, source (14):**
  - engine `index.ts`, `handle.ts` (`callOut` handler, `MEETING_COMMANDS`, the Duel guard), `round.ts` (`endOfDuelAct` branch), `reduce.ts` (`callOutMade`, `callOutResolved`), `setup.ts` (`isDuel`, `duel` validation and the `gameCreated.duel` field, the Duel shop branch, the `needsMeetings` filter), `overrides.ts` (`duel` key), `reveal.ts` (call-out lines and `SHOWN` entries);
  - engine types: `types/events.ts` (`CallOutMade`, `CallOutResolved`, `GameCreated.duel`), `types/commands.ts` (`callOut`), `types/config.ts` (`duel`, `ContentOverrides.duel`), `types/samples.ts`;
  - content `jobs.ts` (`DuelRules`, `duel`), `perks.ts` (`SHOP_RULES.duel`, `duelThird`), `roles.ts` (`needsMeetings` and its 7 uses), `setup.ts` (`MIN_PLAYERS` 2 → 3);
  - bots `bot.ts` (`wantsCallOut`, the duel branches), `read.ts` (`isDuel`, `needsMeetings` check), `claims.ts`;
  - sim `crew.ts` (`duel: options.duel`), `args.ts` (`--duel`), `index.ts`, `suite/matrix.ts`;
  - server `live.ts` (`callOut` in `PLAYER_COMMANDS`);
  - web `game/describeEvent.ts` (call-out lines, " (Duel)"), `game/away.ts` (`OWN_ACTIONS`), `game/meeting.ts` (`hasMeetings`), `screens/Game.tsx` (its two uses).
- **Edit, tests (27):**
  - engine `claims.test`, `claims.qa`, `commands.hostile`, `crew.test`, `crew.qa`, `crew-r2b.test`, `crew-r2b.qa`, `extension.test`, `extension.qa`, `invariants.prop` (`duelConfig` arbitrary, the Duel invariant), `owner-decisions.qa`, `reveal.test`, `types/types.qa`, `view.leak` (`playDuel`, the `callOutMade` junk event);
  - content `content.test`;
  - bots `claims.qa`, `run.test`;
  - sim `args.test`;
  - server `scenarios.int` (the Duel scenario), `scheduler.qa` (`label`), `store.test` (the Duel cell);
  - web `board.qa`, `claim.qa`, `describeEvent.test`, `meeting.test`;
  - plus `duel: false` lines stripped from fixtures.
- **Result:** typecheck ok (all workspaces); 55 files changed, −1,144/+20 lines. Unit tests (engine, content, bots, sim, web unit; the property test excluded for time): **57 of 104 files pass, 47 fail (158 tests)**. 105 of the failures are the expected `invalid game config: a game needs 3–12 players` from 2-player fixtures. The rest are sim `-p 2` / `--duel` arg tests and suite cells at 2 players. Not yet green: **C2a must also move every 2-player fixture to 3 players** in those 47 files. The largest are `view.qa` (30), `round.test` (14), `meeting.test`, `end.test` (11 each), `setup.qa`, `bots/run.test` (8 each). Expected values that depend on crew size (Heat shares, targets ×players) need recomputing, not just the count changing. Server tests weren't run.
- **Only e2e can catch:** any spec that starts a 2-seat game (`setupGame.ts` default seat counts) and the lobby's start button at 2 seats.

### C2b — Quick/starter mode (type-level dry run)

- **Remove `GameConfig.starterMode`:** the compiler flags **72 files**, 4 of them source: engine `setup.ts`, `crew.ts`, `deck.ts`; server `lobby.ts`; sim `crew.ts`; web `GalleryExtension.tsx`. Almost all the rest are test fixtures that set `starterMode: false` (mechanical).
- **By grep, 91 files** mention `starterMode`, `QUICK_NOTE`, "Quick games" or "Quick 15". Beyond the compiler list, that adds:
  - server `settings.ts` (`starterMode`, "starter mode needs eventsEnabled false"), `settings.extension.qa`, `lobby.test`, `host*.test`;
  - web `DeckSettings.tsx` (`QUICK_NOTE`, `effectiveDeck`, the lock), `components/Extension.tsx`, `game/extension.ts` (`hasShop`), `extension.test`, `components/extension.qa`;
  - e2e `extension.spec.ts` ("Quick locks Starter"), `extension.qa.spec.ts` ("Quick games have no tokens and no shop").
- **Relabel** "Quick 15 min" to "15 min" in `screens/Lobby.tsx`, `components/MyGames.tsx` and the e2e `getByRole("button", { name: "Quick 15 min" })`. The id `quick` (`api.ts`, `settings.ts` `SESSION_LENGTHS`, `timing.ts`) is renamed in S3a.3.
- **Only e2e can catch:** full games on the 15-minute preset now deal the Standard deck with events and a shop (`game.spec`, `game.qa` 12 seats, `overflow.qa`, `reveal.spec`); watch their run time.
- Unit tests not run.

### C2c — cut roles and the `mole?` setting (type-level dry run)

- **`mole?`:** removing `GameConfig.mole` flags **38 test files and engine `setup.ts`** (validation, and `rolePoolFor`'s "off" filter):
  - engine `alibi*`, `claims*`, `lockin*`, `overrides`, `roles`, `round*`, `setup*`, `view.test`, `view.qa`;
  - bots `bots.qa`, `claims.qa`, `crewseed*`, `embezzler.qa`, `hunch`, `lockin.qa`, `run.test`, `testkit.ts`;
  - server `store*`, `chat.evidence.qa`;
  - web `away*`, `board*`, `casefile.render`, `claim.qa`, `extension`, `hud`, `meeting`, `records`, `GalleryExtension.tsx`.

  Stripping the literal `mole: "off"` from 39 fixtures fixes most of them mechanically. 6 still need hand edits (`setup.test`, `setup.qa`, `view.qa`, `bots.qa`, `bots/run.test`, `store.qa`: computed or asserted `mole` values). **Behaviour change:** `mole: "off"` removed every Wildcard and Lone wolf from the pool, so those fixtures must instead set an explicit Team-only `rolePool`, or their expected deals change. Server `settings.ts` `LEGACY_MOLE` goes in the same PR.
- **Cut role ids** (strings, so grep): **24 source files** and **67 test files**.
  - Source: content `roles.ts`, `setup.ts`, `index.ts`; engine `accomplices.ts` (except `holdsDirty`), `crew.ts`, `meeting.ts`, `overrides.ts`, `reduce.ts`, `reveal.ts`, `round.ts`, `setup.ts`, `types/events.ts`, `types/reveal.ts`, `types/samples.ts`; bots `bot.ts`, `claims.ts`, `suspicion.ts`; web `describeEvent.ts`, `extension.ts`, `meeting.ts`, `reveal.ts`, `GalleryExtension.tsx`, `GalleryReveal.tsx`, `Meetings.tsx`.
  - Testkit keys: `V01_NUMBERS.roles.insideMan` and `.fence`, `V06_NUMBERS.roles.fence`, `V015_NUMBERS.roles.fence`.
  - Removing the `RolePower` kinds makes the compiler find the remaining handlers.
- Unit tests not run.

### C2d — dropped events, Server room power, testkit leftovers, list 1 (type-level dry run)

- **Remove** the 5 `EVENTS` entries, the `heat`/`blackout`/`raidRumour`/`doubleCross` effect kinds, the `DoubleCrossOffered`/`Answered`/`Resolved`, `RaidRumourHit` and `PocketCount` events, the `answerDoubleCross` command, and `RoomInfo` `"pocketCount"` (the Server room becomes `info: "none"`). The compiler flags **28 files**:
  - source: engine `deck.ts`, `overrides.ts`, `reduce.ts`, `reveal.ts`, `round.ts`, `types/samples.ts`; bots `bot.ts`, `heat.ts`, `perks.ts`, `suspicion.ts`; server `live.ts`; web `away.ts`, `describeEvent.ts`, `hud.ts`;
  - tests: engine `deck.test`, `deck.qa`, `evidence.test`, `extension.test`, `invariants.prop`, `owner-decisions.qa`, `reveal.test`, `reveal.qa`, `round.test`, `round.qa`, `types.qa`, `view.leak`; bots `run.test`; server `chat.evidence.qa`.
- **Grep finds 38 files** naming the card ids (adding string uses in content tests and the web gallery).
- **Testkit keys:** `V06_NUMBERS.events.quietNight` and `V015_NUMBERS.events.quietNight`; delete `V013_NUMBERS` (symbol). Plus list 1a and 1b.
- Unit tests not run.

### C2e — test consolidation

The candidates in the test audit, each verified by reading both files. No dry run (it changes no product code).

**What the dry runs prove:** the feature split is the right shape; the compiler-flagged lists above are complete for type-level removals. **What they don't:** that C2b–C2d go green. Only C2a was run to tests, and its remaining work, moving 2-player fixtures to 3, is known and sized. Server unit tests, the property test and e2e were not run on the 2-core box.


---

## List 1 — Dead now

### 1a. Unused anywhere (knip, confirmed by grep)

| Item | Path | Lines | Why dead | Also changes | PR |
|---|---|---|---|---|---|
| `V013_NUMBERS` (the const and its doc comment only; `V01_NUMBERS`, `V06_NUMBERS` and `V015_NUMBERS` in the same file are used) | `packages/engine/src/v01-numbers.testkit.ts` | ~17 | No test imports it | none | C2d |
| `ENGINE_VERSION`, `claimantsOf`, `claimsOf`, `ofType` re-exports | `packages/bots/src/index.ts` (the `ENGINE_VERSION` line and the `./read` re-export line) | 2 | Nothing outside bots imports them from `@skimjob/bots` (sim/server import from engine) | none | C2d |
| `JobId`, `RoleId` type re-exports | `packages/engine/src/index.ts` (`export type { JobId, RoleId, RoomId }`) | 1 | Consumers import them from `@skimjob/content` | keep `RoomId` (used) | C2d |
| `PhaseKind` type | `packages/engine/src/types/state.ts` (`PhaseKind`) | 1 | Unused anywhere | none | C2d |
| `EVERYTHING_ROLES` / `POOL_ROLES` duplicate | `packages/content/src/setup.ts` (`EVERYTHING_ROLES`, `POOL_ROLES`) | 2 | Same value under two names; only `POOL_ROLES` / `DECKS.everything` are read | keep one name | C2d |
| `ACC_COLOURS` | `apps/web/src/art/crookLooks.ts` | 1 | Unused anywhere | none | C2d |
| `meetingName`, `MeetingName`, `meetingAfter` re-export | `apps/web/src/game/extension.ts` (the `./wording` re-export) | 1 | Callers import them from `game/wording.ts` | none | C2d |

### 1b. Exported but used only in their own file (knip; drop the `export`): 63

knip's 73 unused exports = the 10 of 1a (9 values plus the `MeetingName` type re-export; `EVERYTHING_ROLES` is counted under the duplicate) + these 63.

These are not dead code, but C3 turns knip on in CI, so each must lose its `export` (or gain a real importer). One-word edits.

| Package | Count | Items | PR |
|---|---|---|---|
| engine | 11 | `heldTake` (accomplices), `cleanThreshold` (crew), `cardDef`, `cardEffect` (deck), `regularMeetingId`, `emergencyMeetingId` (meeting), `PLAYER_ID_PATTERN`, `RESERVED_PLAYER_IDS`, `deckIdOf`, `policeRuns`, `dealShop` (setup) | C2d |
| bots | 12 | `wantsCallOut` (bot; Duel, deleted instead), `CLAIM_STYLE`, `RARELY`, `EVIDENCE_ROLES`, `BLUFF_WHEN_ACCUSED`, `ACCUSED_AT`, `doubleClaims` (claims), `TOP_FACTOR`, `skimEstimate`, `ratesSelfTop` (forecast), `foreseenCardHeat` (heat; Mastermind, deleted instead), `BIG_SAFE` (suspicion; Fence, deleted instead) | C2d |
| sim | 13 | `DECIDED_EARLY_LEAD_SHARE`, `metrics`, `OUTPUT_FILES`, `pct`, `Z95`, `DEFAULTS`, `parseShard`, `SETUPS`, `GATED_FROM_PLAYERS`, `cellKey`, `isStar`, `fixedGames`, `optionsProblem` | C2d |
| server | 6 | `pkceChallenge`, `DEFAULT_STAND_IN`, `parseBoardEdit`, `checkNote`, `rateLimiter`, `API_PREFIX` | C2d |
| web | 21 | `HAT_TOP`, `DECK_OPTIONS`, `QUICK_NOTE` (deleted instead, list 2), `ShopSheet`, `heatBand`, `myGameHref`, `plainName`, `CHAT_MAX_MARKS`, `cardEvent`, `TAG_ORDER`, `powerText`, `earnsText`, `tallyOf`, `SEEN_DEBOUNCE_MS`, `CATCH_UP_MS`, `AWAY_MIN_HIDDEN_MS`, `backoffMs`, `socketUrl`, `ArtSection`, `CHAT_DOCK_QUERY`, `useChatRead` | C2d |

---

## List 2 — Cut by R7 regardless

Lines: **code** = non-test source and CSS; **tests** = unit, QA and e2e. "Whole" = the file goes; otherwise the part named goes.

### 2.1 Duel mode (A11.2) — games need 3+ players

| Path(s) | Lines | What goes | Also changes | PR |
|---|---|---|---|---|
| `packages/engine/src/duel.ts` | 72 whole | Call-outs, their settlement | `index.ts` export; `handle.ts` (`callOut` handler, ~5 lines); `reduce.ts` (`callOutMade`, `callOutResolved` cases, ~15); `round.ts`, `meeting.ts`, `end.ts` Duel branches (~20); `setup.ts` `isDuel`, `duel` validation, Duel shop and `needsMeetings` filter (~25); `types/config.ts` `duel` field; `types/events.ts` `CallOutMade`, `CallOutResolved` (~30); `types/commands.ts` `callOut`; `types/state.ts`; `types/samples.ts` samples; `overrides.ts` `duel` key (~10); `reveal.ts` + `types/reveal.ts` call-out lines | C2a |
| `packages/content/src/jobs.ts` `DuelRules`, `duel:` | ~10 | `wrongCallOut` | `content.test.ts` | C2a |
| `packages/content/src/perks.ts` `SHOP_RULES.duel`, `duelThird` | ~4 | Duel shop dealing | `setup.ts` `dealShop` | C2a |
| `packages/content/src/setup.ts` `MIN_PLAYERS = 2` → 3 | 1 | | every 2-player fixture (see Risks) | C2a |
| `packages/content/src/roles.ts` `needsMeetings` flag | ~3 + uses | only Duel reads it | `setup.ts` | C2a |
| `packages/bots/src/bot.ts` call-out logic, `wantsCallOut` | ~40 | | `read.ts` (4 refs), `claims.ts` (3) | C2a |
| `apps/sim/src/args.ts` `--duel`, `apps/sim/src/suite/matrix.ts` Duel cell, `index.ts` | ~15 | | `args.test.ts`, `presets.qa.test.ts` | C2a |
| `apps/web/src/game/describeEvent.ts`, `game/meeting.ts`, `game/away.ts`, `screens/Meetings.tsx` Duel lines | ~25 | call-out wording and buttons | | C2a |
| Tests: `duel.test.ts` (247), `duel.qa.test.ts` (201) whole; Duel cases in `extension.qa.test.ts`, `view.leak.test.ts`, `invariants.prop.test.ts`, `crew-r2b.qa`, `owner-decisions.qa`, `crew.qa`, `commands.hostile`, `claims*`, `bots run.test.ts`, `server scheduler.qa.test.ts` (17 refs), `scenarios.int.test.ts` (9), web `describeEvent.test.ts`, `meeting.test.ts`, `claim.qa.test.ts` | ~448 whole + ~350 cases | | `samples.ts` keeps one sample per remaining type (compiler-checked) | C2a by package |

### 2.2 R6-only roles (A8 "Cut from R6")

Cut: **Inside Man, Getaway Driver, Fence, Blackmailer, Forger, Muscle, Snitch, Bagman, Cleaner, Mastermind, Embezzler** (11). Kept into S3a.6 (powers rewritten there): Lookout, Hacker, Smooth Talker, Auditor, Detective, Priest, Fixer, Mole, and the Rookie filler (see Decisions).

| Path(s) | Lines | What goes | Also changes | PR |
|---|---|---|---|---|
| `packages/content/src/roles.ts` | ~150 of 364 | 11 `ROLES` entries; `RolePower` kinds `fenceSafe`, `blackmail`, `forge`, `embezzle`, `cancelShakedown`, `snitch`, `bagman`, `cleaner`, `foresee`, `getaway`; `RoleScoring.lootPerPointOverFinalTarget` (Inside Man only); `STOLEN_VOTE_WEIGHT`, `CLEANER_REWARD_EVERY`, `BAGMAN_STREAK`; token triggers only these roles earn (`allInStreak`, `coolingRounds`, `forgedShakenClean`, `stolenVoteDecided`, `safeReached`, `heatReached`, `cancelledClean`, `targetShakenDirty`) | `content.test.ts`, `content.qa.test.ts` | C2c |
| `packages/content/src/setup.ts` | ~15 | `STARTER_ROLES` → `["rookie","lookout"]`; `STANDARD_ROLES` drops muscle, cleaner, fence, getawayDriver, embezzler; `RANDOM_DEAL_SINGLETONS` → `["mole"]` | Balanced-mix tests (Risks 3) | C2c |
| `packages/engine/src/accomplices.ts` | ~35 of 47 | `stolenVotes` (Blackmailer), `heldTake` and the Embezzler "always dirty" term, `forgedBy` (Forger), the Fence `safe` term. **`holdsDirty` is kept** (the shakedown in `meeting.ts` and the Detective in `crew.ts` read it), reduced to `stash >= threshold`, and moved into `meeting.ts` when the file goes; S3a.5 then replaces it with "above the fair share" | `meeting.ts` tally, `view.ts`, `end.ts` | C2c |
| `packages/engine/src/crew.ts` | ~110 of 274 | Muscle cancel + naming, Blackmailer, Forger, Snitch, Fixer-unrelated token rewards of cut roles, Embezzler take | `handle.ts` `useAbility` routing | C2c |
| `packages/engine/src/round.ts` | ~60 of 377 | Fence safe, Bagman bonus, Cleaner Rooftop, Getaway Driver reverse, Embezzler, Forger sighting in the move | | C2c |
| `packages/engine/src/meeting.ts` | ~50 of 482 | Muscle cancel window *trigger* (the window itself stays for the Shield), Snitch target votes, stolen votes in the tally | | C2c |
| `packages/engine/src/end.ts`, `reveal.ts`, `types/reveal.ts` | ~45 | Inside Man scoring, Snitch target win, Embezzler/★ lines for cut roles | | C2c |
| `packages/engine/src/deck.ts` Mastermind `foresee`/`cardForeseen` | ~25 | | `types/events.ts` `CardForeseen`; reveal | C2c |
| `packages/engine/src/setup.ts` | ~25 | `snitchTargetAssigned` deal step, Fence/Getaway special cases | | C2c |
| `packages/engine/src/types/events.ts`, `commands.ts`, `state.ts`, `samples.ts`, `view.ts` | ~140 | `SnitchTargetAssigned`, `VoteCompromised`, `SightingForged`, `VotesStolen`, `MuscleNamed`, `CardForeseen`, `RaidStopped`-only-by-cut-roles fields, `fenceSafe`/`safe` state fields, ability variants | `view.leak.test.ts` scrub list | C2c |
| `packages/engine/src/overrides.ts` | ~30 of 302 | override keys for cut roles (`insideMan`, `fence`, `embezzler`, `getawayDriver`, `cleaner`, `bagman`) | `overrides.test.ts` | C2c |
| `packages/bots/src/bot.ts` | ~90 of 456 | Snitch vote share, Bagman all-in, Muscle threshold, Fence/Embezzler/Forger/Blackmailer/Cleaner/Getaway play | `personalities.ts` knobs only these read | C2c |
| `packages/bots/src/claims.ts`, `perks.ts`, `suspicion.ts`, `read.ts`, `forecast.ts`, `heat.ts` | ~70 | `EVIDENCE_ROLES` entries, `BIG_SAFE` (Fence), `foreseenCardHeat` (Mastermind), cut-role bluff tables | | C2c |
| `apps/sim/src/metrics.ts`, `record.ts`, `suite/targets.ts`, `suite/report.ts` | ~40 | per-role rows for cut roles, Muscle/Embezzler metrics, ★ roles that are cut | `metrics.test.ts`, `suite.test.ts`, `split-gate.qa.test.ts` | C2c |
| `apps/server/src/scheduler.ts`, `timing.ts`, `live.ts`, `chat.ts` | ~10 | Muscle comments/naming; the `shakedownWindowMs` stays (Shield) | `police.qa.test.ts` unaffected | C2c |
| `apps/web/src/game/describeEvent.ts`, `game/extension.ts`, `game/reveal.ts`, `game/hud.ts`, `components/Extension.tsx`, `components/Reveal.tsx`, `screens/GalleryExtension.tsx`, `screens/GalleryReveal.tsx` | ~80 | lines and gallery samples for cut roles and their events | `describeEvent.test.ts`, `extension.test.ts`, `components/extension.qa.test.ts`, `reveal.test.ts` | C2c |
| Tests, whole file: `packages/bots/src/embezzler.qa.test.ts` (55) | 55 | | | C2c |
| Tests, cases: `roles.test.ts` / `roles.qa.test.ts` (~600 of 988), `crew.test.ts` / `crew.qa.test.ts` / `crew-r2b*` (~700 of 1,326), `meeting*` (~200), `round*` (~200), `end*` (~150), `extension*` (~400), `view*` (~150), `perks*` (~80), `alibi*` Forger (~60), `claims*` (~60), `invariants.prop.test.ts` role arbitraries (~40); bots `bot.test.ts`, `bots.qa`, `run.test`, `reveal*`, `r6-balance.qa`, `extension.qa`, `claims*` (~350); sim (~40); server `scheduler.qa`, `scenarios.int` Muscle window cases (~60); web unit (~120), e2e `extension*.spec.ts`, `reveal*.spec.ts` role cards (~40) | ~3,250 | | C2c |

### 2.3 Dropped event cards (A11.1): Quiet night, Payday, Power cut, Raid rumour, Double-cross

| Path(s) | Lines | What goes | Also changes | PR |
|---|---|---|---|---|
| `packages/content/src/events.ts` | ~25 of 81 | 5 `EVENTS` entries; `EventEffect` kinds `heat`, `blackout`, `raidRumour`, `doubleCross` (`roomSurge` stays for Shift change until S3a.8) | `content.test.ts` | C2d |
| `packages/engine/src/deck.ts` | ~70 of 206 | their effect functions, `answerDoubleCross`, the offer | `handle.ts` handler; `reduce.ts` (`doubleCrossOffered/Answered/Resolved`, `raidRumourHit`); `types/events.ts` (4 interfaces, ~50); `types/commands.ts` `answerDoubleCross`; `types/state.ts` `DoubleCrossOffer`, `offer`; `samples.ts`; `overrides.ts` `quietNight`/`payday` keys; `round.ts` blackout hook (Power cut) | C2d |
| `packages/engine/src/v01-numbers.testkit.ts` `V06_NUMBERS.events.quietNight` | 1 | | | C2d |
| `packages/bots/src/bot.ts` Double-cross answer (~15), `heat.ts` Quiet night | ~20 | | | C2d |
| `apps/server/src/live.ts` `answerDoubleCross: true` | 1 | command allow-list | `live.test.ts` | C2d |
| `apps/web/src/game/describeEvent.ts`, `game/extension.ts`, `game/away.ts`, `game/reveal.ts` Double-cross lines, gallery card samples | ~60 | | web unit tests, `extension.qa.test.ts` | C2d |
| Tests: `deck.test.ts` / `deck.qa.test.ts` (~350 of 799), `owner-decisions.qa` (~40), `view.leak` (~20), `reveal*` (~30), `invariants.prop` (~10), bots (~40), web (~60) | ~550 | | | C2d |

### 2.4 The Server room's old power (A11.4)

| Path(s) | Lines | What goes | Also changes | PR |
|---|---|---|---|---|
| `packages/content/src/jobs.ts` `serverRoom.info: "pocketCount"`, `rooms.ts` `RoomInfo` member | ~3 | the room becomes `info: "none"` with 0 loot until S3a.1 gives it coins | | C2d |
| `packages/engine/src/round.ts`, `reduce.ts`, `types/events.ts` `PocketCount`, `samples.ts` | ~35 | | `view.leak.test.ts` | C2d |
| `packages/bots/src/suspicion.ts` Server room reading | ~10 | | | C2d |
| `apps/web/src/game/describeEvent.ts`, `game/board.ts` | ~8 | | | C2d |
| Tests: `round*.test.ts`, `job.qa`, `alibi.qa`, `deck.qa`, `evidence.test`, `setup.test`, `types.qa` cases | ~120 | | | C2d |

### 2.5 Quick as a game mode, and starter mode (A11.3)

**Split:** the *mode* (Quick forces the Starter deck, no events, no tokens or shop) goes; the `quick` **session-length timing preset stays** (it is the 15-minute preset every e2e full game and many server tests run on) until S3a.3 rewrites timing as session length ÷ round cap. See Decisions and Risks 1.

| Path(s) | Lines | What goes | Also changes | PR |
|---|---|---|---|---|
| `packages/engine/src/setup.ts`, `types/config.ts` | ~25 | `starterMode` (Starter deck + no shop + no events), "Starter in starter mode" in `deckIdOf` | `setup.test.ts` (16 refs), `setup.qa`, `roles.test`, `extension*` | C2b |
| `apps/server/src/lobby.ts` `gameConfig` (the `quick` branches), `settings.ts` `starterMode`, the "starter mode needs events off" rule | ~25 | Quick no longer forces Starter / events off / no shop | `lobby.test.ts`, `settings.extension.qa.test.ts` (8 refs), `host*.test.ts` | C2b |
| `apps/web/src/components/DeckSettings.tsx` `QUICK_NOTE`, `effectiveDeck`, locked state; `components/Extension.tsx` "Quick games have no tokens…"; `game/extension.ts` `hasShop` Quick reading; `screens/GalleryExtension.tsx` Quick samples | ~40 | | `extension.test.ts`, `components/extension.qa.test.ts` (9 refs) | C2b |
| e2e: `extension.spec.ts` "Quick locks Starter" test (~45), `extension.qa.spec.ts` "Quick games have no tokens and no shop" (~25) | ~70 | | | C2b |

### 2.6 Old migrations and fallbacks

| Path(s) | Lines | What goes | Why safe | PR |
|---|---|---|---|---|
| `apps/server/src/settings.ts` `LEGACY_MOLE` and the saboteur-setting migration in the settings reader and checker | ~25 | read path for the dropped "mole" lobby setting | No real players; S5 clears old games before deploy | C2c |
| `packages/engine/src/types/config.ts` `mole?: MoleSetting`, `setup.ts` legacy `mole` validation | ~15 | engine side of the same migration | same | C2c |
| `packages/bots` crewSeed: the public-data `gameDigest` fallback is **already gone** (PR #64); `crewseed-required.qa.test.ts` (114) only proves its absence | — | merge into `crewseed.qa.test.ts` | | C2e |
| `apps/web/e2e/signin.spec.ts` fixture rows with `sessionLength: "quick"` | — | keep (the preset stays) | | — |

### List 2 total

| Package | Code lines | Test lines |
|---|---|---|
| content | ~230 | ~60 |
| engine | ~1,250 | ~4,300 |
| bots | ~260 | ~560 |
| sim | ~60 | ~120 |
| server | ~60 | ~300 |
| web (src) | ~220 | ~400 |
| web e2e | — | ~120 |
| **Total** | **~2,100** (types, samples and reduce included) | **~5,900**, plus ~1,900 merged away in C2d |

---

## List 3 — Replaced in S3/S4

Each item is deleted by the PR that builds its replacement (cleanup rule 1). Step numbers are `docs/simplified.md` "Step by step": S3(a) 1–9, S3(b) 1–5, S4 1–10.

### Engine, content, bots, sim

| Item | Path(s) | Lines (approx) | Deleted by |
|---|---|---|---|
| Loot per room, room capacity (Deposit boxes crowding), the split slider's loot model, the Teller line room, `roomSurge` loot | `content/jobs.ts` room `loot`/`capacity`, `rooms.ts` `RoomCapacity`; `engine/job.ts` yields; `round.ts` move check, yields, splits (`lootSplit`) | ~400 code, ~900 tests (`round*`, `job*`, `lockin*`) | **S3a.1** |
| Heat 0–100, `heatPressure`, `perRound`, the crew-share formula, Rooftop −20, `EVENT_HEAT_FULL_CREW`, Heat bust | `content/jobs.ts` `HeatRules`; `engine/job.ts` Heat formula; `round.ts` Heat step; `end.ts` heat failure; `types/state.ts` `heat` | ~350 code, ~800 tests | **S3a.2** |
| Hidden police moments, the Mole's queued tip-off, `policeScheduled`/`policeActivity`/`tipOffLanded`/`copsRaided`/`raidStopped` | `engine/police.ts` (53 whole), `setup.ts` `policeRuns`, `content/events.ts` `POLICE_ACTIVITY`; server `DEADLINE_RULES.policeMoment`, `POLICE_KEY_PREFIX`; bots `heat.ts` police; `apps/server/src/police.qa.test.ts` (116) | ~250 code, ~400 tests | **S3a.2** (the Mole's new power lands in S3a.6) |
| Fixer's raid stop (`stopAt: 95`, `lossShare`) | `crew.ts` `stopRaid`, `round.ts` | ~40 | **S3a.2** (rewritten as "reopen a taped room" in S3a.6) |
| Acts (3 × 3 rounds, `ROUNDS_PER_ACT`, `ActNumber`), fixed 9 rounds | `engine/acts.ts` (14 whole), `content/setup.ts` `ROUNDS_PER_ACT`; act fields across `types/*`, `round.ts`, `meeting.ts`, `view.ts`; web `wording.ts` (15 whole), `records.ts` act tags; bots `read.ts`; sim `record.ts` | ~300 code, ~500 tests | **S3a.3** (bank + round cap) and **S3a.5** (meetings at bank thirds) |
| Checkpoint targets (7/15/23 ×), `missedCheckpoint` Heat, final target, `checkpointRankings` | `content/jobs.ts` `CheckpointRules`; `engine/meeting.ts` checkpoint after the meeting; `end.ts` target failure; sim `record.ts` `checkpointRankings`, `suite/targets.ts` | ~200 code, ~500 tests | **S3a.3** |
| `V01_NUMBERS`, `V06_NUMBERS` (pinned R6 numbers) | `engine/v01-numbers.testkit.ts` (rest of file) | ~37 | goes with its last user, expected **S3a.4**; each S3a PR deletes the tests that pin it |
| The Haul, stash scoring, `end.ts` ranking/★ endings, `FailureReason`, `winsOn`, role scoring | `end.ts` (80), `content/roles.ts` scoring/`winsOn`, `types/reveal.ts` endings | ~200 code, ~550 tests | **S3a.4** (equal shares, honesty, endings without role wins) and **S3a.6** (Mole/Fixer win in handlers, A12 seam 4) |
| Shakedowns against the clean line (6) with payout (8); the gap box; the Priest's blessing payout (`blessingPaid`) | `content/jobs.ts` `ShakedownRules`; `engine/meeting.ts` shakedown result; `crew.ts` `blessingEvents` | ~150 code, ~400 tests | **S3a.5** |
| Meeting scheduling by act (`scheduleMeeting` slot, `awaitingMeeting`), alibis window per round | `engine/meeting.ts` scheduling; `round.ts` alibis; server `DEADLINE_RULES.scheduleMeeting`, `alibis`, `timing.ts` `alibiMs`, `meetingLeadMs` | ~200 code, ~500 tests | **S3a.5** (meetings at bank thirds). Alibis survive only as a "said" statement (A12 seam 5); the alibi *window* goes in **S3a.9** with the plan-board snapshot |
| R6 role powers of the kept roles (Lookout extra rooms, Hacker loop, Auditor shortfall, Detective stash check, Priest bless, Smooth Talker, Fixer, Mole tip-off), `perAct`/`perGame` counters, temperament tags, Balanced/Random deal, decks (Starter/Standard/Everything), role list setting, `FILLER_ROLE` | `content/roles.ts` (rest), `content/setup.ts` decks/`BALANCED_MIX`; `engine/setup.ts` deal (~200), `crew.ts` (rest), `round.ts` move powers, `claims.ts`; bots `bot.ts`, `claims.ts`, `suspicion.ts`; server `settings.ts` deck/deal/roleList; web `DeckSettings.tsx` (155) | ~1,200 code, ~2,500 tests | **S3a.6** (web lobby settings: **S4.5**) |
| Tokens (20 triggers), `tokenEarned`, R6 shop (3 columns, 9 perks, including Rig, which acts on the 9-card deck), `buyPerk`/perk spending, Shield auto-cancel, Recharge, Emergency perk, `shakedownPending` window and `resolveShakedown` deadline | `content/perks.ts`, `content/roles.ts` `TokenTrigger`/`rewards`; `engine/perks.ts` (197), `perks.testkit.ts`, `crew.ts` rewards, `meeting.ts` window; bots `perks.ts` (163); server `DEADLINE_RULES.resolveShakedown`, `timing.ts` `shakedownWindowMs`; sim token metrics | ~700 code, ~1,000 tests | **S3a.7** (engine/bots/server); web shop **S4.7** |
| The 9-card deck engine (`EVENTS_FROM_ROUND`, every round flips; Shift change, Lockdown, Audit, Inside tip as R6 effects) | `engine/deck.ts` (rest), `content/events.ts` (rest) | ~150 code, ~400 tests | **S3a.8** |
| Alibis/claims as separate R6 events → "said" events; plan board | `engine/claims.ts` (25), alibi parts of `round.ts`, `alibis.testkit.ts` (20) | ~120 code, ~600 tests | **S3a.9** |
| Content overrides for R6 numbers | `engine/overrides.ts` (rest, ~250) | ~250 code, ~240 tests | trimmed by each S3a PR for its own numbers; the mechanism is **keep** |
| Bot Heat/forecast/★ lean model | `bots/heat.ts` (68), `forecast.ts` (78), ★ parts of `bot.ts` | ~250 code, ~200 tests | **S3a.2** (Heat) and **S3a.4** (endings) |
| Sim metrics and suite gates for R6 (Heat bust share, ★ parity, split gate, checkpoint rankings, R5 parity) | `apps/sim/src/metrics.ts`, `record.ts`, `suite/report.ts` (481), `suite/targets.ts`, `suite/tally.ts`; `r5.qa.test.ts` (79), `split-gate.qa.test.ts` (128) | ~700 code, ~500 tests | each S3a PR updates "the sim's metrics for its rule"; the gates are reset by **S5** against S1's balance gates |

### Web

| Item | Path(s) | Lines | Deleted by |
|---|---|---|---|
| Move panel: room tiles with loot swatch and Heat hint, split slider | `components/RoomTile.tsx` (59), `SplitSlider.tsx` (45), move parts of `screens/Game.tsx`, `game/hud.ts` | ~400 | **S4.2** |
| Heat thermometer and Haul counter meters, target bar, Heat breakdown | `components/Meter.tsx` (46), Heat/target parts of `components/Extension.tsx`, `game/extension.ts` (`HeatLine`, `heatRound`) | ~350 | **S4.1** |
| R6 role cards, "How you win", rulebook sheet, token count | `components/Extension.tsx` (528), `game/extension.ts` (436), `components/extension.css` (375), `screens/GalleryExtension.tsx` (284) | ~1,600 | **S4.5** (role cards, rulebook) and **S4.7** (shop) |
| R6 ledger / case file / records | `components/CaseFile.tsx` (123), `casefile.css` (349), `game/records.ts` (80), `game/describeEvent.ts` (297) | ~850 | **S4.4** (the case board shell is **S3b.5**) |
| Suspicion board (tags + note) | `components/SuspicionBoard.tsx` (155), `screens/GalleryNotes.tsx` (104) | ~260 | **S4.4** (folds into case-board dossiers and pins); server `notes.ts` board storage is keep |
| "While you were away" recap | `components/AwayRecap.tsx`, `game/away.ts` | ~140 | keep the mechanism; its lines are rewritten in **S4.4** |
| R6 reveal (★ endings, token lines, Heat breakdown, timeline) | `components/Reveal.tsx` (395), `reveal.css` (269), `game/reveal.ts` (117), `screens/GalleryReveal.tsx` (172), engine `reveal.ts` (224), `types/reveal.ts` (119) | ~1,300 | engine parts with each S3a rule; web **S4.9** |
| Meeting screens (act scheduling, slot planner) | `screens/Meetings.tsx` (611), `meetings.css` (274), `game/meeting.ts` (376) | ~1,250 | **S4.8** (keep the vote/tally kit: `MeetingKit.tsx`) |
| Game screen layout (long scroll) | `screens/Game.tsx` (579), `game.css` (504), `game/hud.ts` (241) | ~1,300 | **S3b.2** (shell) and **S4.1–4.3** |
| Bank cutaway Heat/Lockdown states | `art/BankCutaway.tsx` Heat parts, `game/board.ts` | ~150 | **S4.1** |
| e2e specs for replaced screens | `game*.spec.ts`, `extension*.spec.ts`, `reveal*.spec.ts`, `meeting*.spec.ts`, `notes*.spec.ts`, `board.qa.spec.ts`, `lockin.qa.spec.ts`, `responsive*.spec.ts` (route lists) | ~2,300 | the S4 step that replaces each screen (cleanup rule 1, test plan step 4) |

**List 3 total:** engine ~7,500 (≈2,500 code), content ~600, bots ~2,000, sim ~1,800, server ~1,500, web src ~9,000, e2e ~2,300 → **~24,900 lines** (Rig's ~180 moved here from list 2).

---

## List 4 — Keep

| Area | Path(s) | S3 trim notes |
|---|---|---|
| Seeded RNG | `engine/rng.ts`, `rng.test.ts` | none |
| Event log, fold, `handleCommand` | `engine/reduce.ts`, `handle.ts`, `check.ts`, `types/events.ts` shell, `types/commands.ts` shell, `types/samples.ts` | every S3a PR replaces its own event types; `samples.ts` stays compiler-checked |
| Visibility and `viewFor`, leak scrub, property tests | `engine/types/visibility.ts`, `view.ts`, `types/view.ts`, `view.leak.test.ts`, `invariants.prop.test.ts` | each S3a PR adds its events to the scrub and arbitraries; A12 seam 1 (fact catalogue) goes through here |
| Meetings and voting (ballots, tally, emergency meeting, secret/open visibility) | `engine/meeting.ts` (vote core), `web/components/MeetingKit.tsx` | scheduling-by-act and the clean-line shakedown are list 3 (S3a.5); A12 seam 10 (motions by id) |
| Evidence cards | `engine/evidence.ts` | its allow-list follows the S3a event types |
| Setup validation, player ids | `engine/setup.ts` (validation, `PLAYER_ID_PATTERN`) | deal is list 3 (S3a.6), A12 seams 8–9 |
| Content overrides mechanism | `engine/overrides.ts` (`validateOverrides`) | keys change per S3a PR |
| Bots harness | `bots/run.ts`, `bot.ts` skeleton, `personalities.ts`, `read.ts`, `testkit.ts`, crewSeed | decision code rewritten per S3a rule (Opus) |
| Simulator harness | `sim/args.ts`, `run.ts`, `pool.ts`, `worker.ts`, `tasks.ts`, `output.ts`, `stats.ts`, `crew.ts`, `suite/{args,cli,matrix,merge,run,validate}.ts`, `scripts/sim-smoke.sh`, `.github/workflows/sim-suite.yml` | metrics/gates are list 3 |
| Server core | `server.ts`, `main.ts`, `startup.ts`, `config.ts`, `clock.ts`, `web.ts`, `build.mjs`, `index.ts` | `index.ts` header cites m2-plan (stale-ref group) |
| Store and DB | `store.ts`, `db.ts`, `migrate.ts` (migrations add-only, latest 008) | none |
| Live channel | `live.ts` | command allow-list loses Duel/Double-cross (C2b), later perks |
| Scheduler and deadlines | `scheduler.ts`, `timing.ts`, `timers.test.ts` | `DEADLINE_RULES`: `policeMoment` S3a.2, `scheduleMeeting`/`alibis` S3a.5/S3a.9, `resolveShakedown` S3a.7; timing table S3a.3 |
| Lobby, invites, hand-over, bots in seats | `lobby.ts`, `settings.ts` (core) | deck/deal/role-list settings S3a.6 |
| Auth (guest, Google) | `auth.ts`, `google.ts` | none |
| Host controls | `host.ts`, `web/game/host.ts`, `components/HostPanel.tsx`, `screens/GameHost.tsx`, `GalleryHost.tsx`, `host.css` | none |
| Chat | `server/chat.ts`, `web/game/chat.ts`, `components/Chat.tsx`, `chat.css`, `screens/GameChat.tsx` | evidence-card wording follows S3 events |
| Notes (last seen, private tags) | `server/notes.ts`, `web/game/notes.ts` | becomes case-board pins/tags storage in S4.4 |
| UI kit and theme | `theme.css`, `components.css`, `game-kit.css`, `SketchFrame.tsx`, `sketch.ts`, `Button.tsx`, `Avatar.tsx`, `avatarLooks.ts`, `Chip.tsx`, `Segmented.tsx`, `TextField.tsx`, `Toast.tsx`, `Underline.tsx`, `Wordmark.tsx`, `icons.tsx`, `screens/Gallery.tsx` | gallery sections for replaced components go with them |
| Art | `art/*` (BankCutaway, Crook, crookLooks, Raccoon, RoomIcon, rooms, Spots, bankLayout, art.css), `screens/GalleryArt.tsx`, `gallery-art.css`, `BankDoodle.tsx`, e2e `art.qa.spec.ts`, `art-harness.qa.tsx` | Teller line art drops with the room (S3a.1/S4.1); bells, tape, siren, bank pile are added in S4.1 |
| Landing, new game, invite, my games, router, api | `screens/Landing.tsx`, `NewGame.tsx`, `Invite.tsx`, `Lobby.tsx` (core), `TopBar.tsx`, `MyGames.tsx`, `router.ts`, `api.ts`, `inviteCode.ts`, `App.tsx`, `main.tsx`, `screens.css` | `api.ts` deck/deal types S4.5 |
| CI and scripts | `.github/workflows/ci.yml`, `sim-suite.yml`, `scripts/*` | C3 adds knip, scoping and "CI ok" |
| e2e kept journeys | `landing`, `lobby*`, `signin*`, `host*`, `chat*`, `press.qa`, `overflow.qa`, `art.qa`, `setupGame.ts` | `lobby*` deck parts S4.5; tags added in C3 |

**List 4 total:** ~34,600 lines (the remainder of each package after lists 1–3).

---

## Test audit

### Duplicated coverage, `*.test.ts` vs `*.qa.test.ts`

There are 39 unit/QA name pairs and 27 QA-only files. QA files were written as adversarial additions, but over many fix rounds several now re-test the same happy paths. Recommended actions (C2e unless the code under test is cut):

| Pair | Lines (unit + QA) | Finding | Action | PR |
|---|---|---|---|---|
| `engine/duel.test` + `duel.qa` | 247 + 201 | Duel | delete both | C2a |
| `engine/roles.test` + `roles.qa` | 346 + 642 | ~60% cut roles; rest R6 powers (list 3) | delete cut-role cases; rest goes in S3a.6 | C2c |
| `engine/crew.test` + `crew.qa` + `crew-r2b.test` + `crew-r2b.qa` | 245 + 337 + 426 + 318 | four files on one module; "r2b" names an old milestone; heavy overlap on Auditor/Detective/Priest uses | delete cut-role cases (its feature slice (C2a–C2d)); merge the remaining into `crew.test.ts` + `crew.qa.test.ts` | its feature slice, then C2e |
| `engine/extension.test` + `extension.qa` | 446 + 736 | named after the R6 spec, cross-cutting (roles, tokens, decks, police); overlaps `roles*`, `perks*`, `setup*` | delete Duel/cut-role/cut-card cases (its feature slice (C2a–C2d)); move the rest beside their module (`setup.test`, `perks.test`, `meeting.test`) and drop exact duplicates | its feature slice, then C2e |
| `engine/owner-decisions.qa` (solo) | 312 | pins 1–3 Nov owner rulings, most of them R6 (Duel, police, tokens) | delete overruled cases; keep any still-true ruling in its module's test | its feature slice, then C2e |
| `engine/deck.test` + `deck.qa` | 444 + 355 | ~45% dropped cards | delete dropped-card cases | C2d |
| `engine/view.test` + `view.qa` + `view.leak` | 257 + 467 + 554 | **not duplicates** (review): `view.qa` is a differential non-interference harness with a control case plus prototype-key, reveal-ballot and `eventsSince` edges; `view.leak` is the scrub | keep all three (list 4); only cut-feature cases go with their slice | — |
| `engine/types.test` + `types.qa` | 79 + 238 | `types.qa` constructs every event; `samples.ts` + leak scrub already enforce this | cut `types.qa` to the cases the compiler can't check | C2e |
| `engine/lockin.test` + `lockin.qa`, `server/lockin.qa`, e2e `lockin.qa.spec` | 100 + 194 + 395 + 83 | lock-in grace at engine, server and browser level: different layers, not verified as duplicates | keep | — |
| `bots/lockin.qa.test.ts` | 34 | **not a lock-in copy** (review, QA): the only check that bots never propose a meeting slot (owner decision, PR #44) | keep; it becomes list 3 under S3a.5 (meetings at bank thirds). Its 2-player cell and `mole:` fixture change in C2a/C2c | — |
| `bots/crewseed.qa` + `crewseed-required.qa` + `server/crewseed.qa` + `sim/r5.qa` | 128 + 114 + 83 + 79 | crewSeed secrecy and determinism tested in four places | merge the two bot files into one; rename `sim/r5.qa.test.ts` to `sim/crewseed.qa.test.ts` (its content is crewSeed determinism, not R5) | C2e |
| `bots/reveal.test` + `reveal.qa` | 69 + 375 | QA tests engine reveal through bots | move engine-reveal cases to `engine/reveal.qa`, the rest go with S4.9 | C2e |
| `server/chat.test` + `chat.qa` + `chat.evidence.qa` | 308 + 315 + 134 | rate limit and length tested in both | merge duplicates | C2e |
| `server/host.test` + `host.qa` | 377 + 539 | pause/extend happy paths in both | merge duplicates | C2e |
| `server/scheduler.test` + `scheduler.qa` | 363 + 449 | QA has 17 Duel refs; overlap on reconcile | delete Duel (C2a, C2e), merge reconcile duplicates (C2e) | C2a, C2e |
| `web/game/chat.test` + `chat.qa` + `components/chat.qa` + `chat.render.test` | 232 + 302 + 134 + 119 | four files on chat formatting | merge into `game/chat.test` + one QA | C2e |
| `web/components/extension.qa` (solo) | 702 | R6 Extension UI, 9 Quick refs | delete Quick/cut parts (C2b, C2c); rest goes in S4.5/S4.7 | C2b, C2c |
| `web/wording.qa` (solo) | 52 | meeting names without acts | goes with `wording.ts` in S3a.5 | — |
| e2e pairs (`chat`, `extension`, `game`, `host`, `lobby`, `meeting`, `notes`, `responsive`, `reveal`, `signin`) | ~3,700 | `responsive.spec` + `responsive.qa.spec` + `game.responsive` + `chat.responsive` check the same widths on the same routes | merge into one responsive spec per route list; the rest wait for their S4 replacement | C2e (responsive), S4 |

### Tests of removed rules (not covered above)

| Test | Lines | Rule | Action | PR |
|---|---|---|---|---|
| `bots/embezzler.qa.test.ts` | 55 | Embezzler bot | delete | C2c |
| `bots/r6-balance.qa.test.ts` | 95 | R6 balance knobs (Muscle threshold, ★ lean) | delete cut-role cases; rest S3a.6 | C2c |
| `bots/r5.test.ts` | 62 | R5 bot settings: Bagman all-in (cut), Hacker loops its own room (list 3) | delete the Bagman case (C2c); the Hacker case goes in S3a.6 | C2c |
| `bots/win-rule.qa.test.ts` | 54 | R6 one-crew win rule with ★ role endings | list 3: replaced in S3a.4 | — |
| `sim/presets.qa.test.ts` | 35 | Duel/Starter sim presets | delete Duel parts | C2a, C2b |
| `server/settings.extension.qa.test.ts` | 75 | saboteur migration, starter mode | delete those cases | C2b, C2c |
| `server/police.qa.test.ts` | 116 | hidden police moments | S3a.2 | — |

### Slow tests with no unique value

Durations were not measured (2-core box; see Method); these are the heavy ones by construction:

| Test | Why slow | Unique value? | Action | PR |
|---|---|---|---|---|
| e2e `@fast-clock` full Quick games: `game.spec` (1 game), `game.qa.spec` (12 seats), `overflow.qa.spec` (real game over), `reveal.spec` (real game) | each plays a whole 9-round game on a scaled clock | the 12-seat game is a required QA check; the others overlap (all reach game over) | keep `game.spec` and the 12-seat `game.qa`; switch `overflow.qa` and `reveal.spec` to the gallery reveal or a log fixture | C2e |
| `engine/invariants.prop.test.ts` | property runs over random games | yes (leak and fold invariants) | keep; trim arbitraries for cut roles/cards (C2a, C2c, C2d) | C2a, C2c, C2d |
| `server/scenarios.int.test.ts` | full server games | partly overlaps `live.test` | delete Duel/Muscle scenarios; keep one full game | C2a, C2c |
| `bots/run.test.ts`, `sim/sim.qa.test.ts`, `sim/suite/suite.test.ts` | many full bot games | sim determinism is unique; batch-size repetitions are not | lower game counts where a smaller batch proves the same | C2e |

**Test audit total:** ~1,900 lines merged away in C2e (engine ~500, server ~330, web ~355, e2e ~480, sim ~115, bots ~100) on top of the list-2 test deletions.

---

## Stale doc references in code

Counted over `*.ts`, `*.tsx`, `*.css`, `*.yml`, `*.sh` (S1 moves `extension.md`, `m2-plan.md` and `r6-balance.md` to `docs/archive/` and rewrites `design.md`, so all of these go stale):

| Package | `extension.md` | `m2-plan` | `§` citations (old design numbering) | other (roles-v2, v2 §, balance-N.md, r6-balance) | files |
|---|---|---|---|---|---|
| engine | 251 | 0 | 1,073 | 120 | 74 |
| content | 40 | 0 | 128 | 30 | 9 |
| bots | 46 | 0 | 261 | 58 | 32 |
| sim | 43 | 0 | 94 | 7 | 31 |
| server | 26 | 32 | 201 | 7 | 42 |
| web (src + e2e) | 59 | 31 | 289 | 15 | 103 |
| CI/scripts | 0 | 0 | 1 | 0 | 1 |
| **Total** | **465** | **63** | **2,047** | **237** | **292** |

Who fixes which group:
- **Refs inside list 2 code and tests** disappear with them in **C2a–C2d** (roughly a third of the engine's and bots' refs).
- **Refs inside list 3 code** disappear when S3/S4 replace it; each S3/S4 PR cites the new `design.md` sections in what it writes (builder rule 3).
- **Refs in list 4 code** (RNG, reduce, view, meetings core, server, chat, lobby, auth, host, UI kit, art): S1's brief says to "fix every reference (including code comments citing extension.md or old design sections)". That is a docs PR touching ~150 code files. **Provisional:** do it as part of **C2e** (or a small follow-up right after S1 merges), when the new section numbers exist, rewriting `extension.md`/`m2-plan.md` citations to the new `design.md` section or dropping them; S1 itself then only fixes `.md` links. The C2 PRs must not add new old-style citations.

---

## Summary table

Lines (`wc -l`, tests included; list 2/3 partly estimated, ±30%):

| Package | Now | List 1 | List 2 | List 3 | List 4 | After C2 |
|---|---|---|---|---|---|---|
| engine (src + tests) | 18,690 | ~30 | ~5,400 | ~7,650 | ~5,600 | ~12,800 |
| content | 1,020 | ~5 | ~280 | ~610 | ~130 | ~735 |
| bots | 4,390 | ~20 | ~805 | ~2,015 | ~1,550 | ~3,500 |
| sim | 4,360 | ~15 | ~180 | ~1,800 | ~2,350 | ~4,050 |
| server | 11,600 | ~10 | ~360 | ~1,500 | ~9,700 | ~10,900 |
| web src | 22,200 | ~25 | ~620 | ~9,000 | ~12,550 | ~21,200 |
| web e2e | 4,430 | 0 | ~120 | ~2,300 | ~2,000 | ~3,830 |
| CI, scripts, config | ~690 | 0 | 0 | 0 | ~690 | ~690 |
| **Total** | **~67,400** | **~105** | **~7,765** | **~24,885** | **~34,600** | **~58,000** |

"After C2" = now − list 1 − list 2 − up to ~1,500 test lines C2e merges away. After S3/S4 replace list 3 (new code is expected to be about half the size of what it replaces), the repo should land near 45,000–50,000 lines.

---

## Risks — "the game still runs (R6 minus cut features)" after each C2 PR

1. **Quick is a timing preset as well as a mode.** `sessionLength: "quick"` (15 min) is what `e2e/setupGame.ts`, every `@fast-clock` full game, the 12-seat QA game and ~150 server test lines use. Deleting it would break most of e2e. C2b removes only the mode (Starter forced, events off, no shop) and, in the same PR, the e2e assertions that expected it (`extension.spec.ts` "Quick locks Starter", `extension.qa.spec.ts` "no tokens and no shop"). Settled: no interim state, since the feature split puts every package's part in C2b. **Side effect:** after C2b, full e2e games on the 15-minute preset deal the Standard deck with events and a shop and may run longer; watch the shard times.
2. **Starter deck collapses to Rookie + Lookout** once Inside Man, Bagman and Cleaner go. Starter/Quick games still deal and play (Rookies fill), but QA on C2a should play one Starter game to the end.
3. **Balanced deal at 8+ players** wants 2 lone wolves; with the Embezzler gone only the Mole remains. `drawnCount` already caps at the pool size, so the deal works (1 Mole + Team players), but the R6 balance tests and the sim's Balanced cells at 8–12 expect 2. Update them in C2a; the sim baseline (`docs/balance/baseline.json`) will drift; S5 refreshes it, so C2a's sim smoke must not compare against the baseline as a gate.
4. **3+ players.** With Duel gone, `MIN_PLAYERS` = 3. Grep every `players: [a, b]` fixture, the sim's `-p 2` presets and matrix cells, lobby start-button tests and any e2e that starts a 2-seat game (`setupGame.ts` defaults) before merging C2a; the server refuses 2-seat starts after C2b.
5. **Shakedown window after the Muscle.** `shakedownPending` and the `resolveShakedown` deadline still run when a Shield is in the shop. C2a must keep the window's trigger for the Shield only and keep "a window always runs its full length" (STATUS engineering note), or the cancel leaks by timing.
6. **Cut roles in stored settings.** A lobby whose stored `roles` list names a cut role must not crash `validateConfig` after C2a/C2b. Either filter unknown role ids when the lobby starts a game, or accept the risk (no real players; S5 clears old games). C2b should filter them.
7. **Event log replay.** Stored R6 games whose logs contain deleted event types (`callOutMade`, `doubleCrossOffered`, `pocketCount`, …) will make `applyEvent` throw on load. Acceptable (no real players; R6 logs won't replay anyway, S5 clears them), but dev databases (`.pglite/`) need wiping after C2a, and the server must not crash at startup on such a game: check `startup.ts` loads lazily, or wipe before deploying any C2 build.
8. **Power cut vs. the Electrician/Blackout.** R7 keeps a blackout as a role power and a perk. Deleting the card's `blackout` effect kind in C2a is fine, but S3a.6/S3a.7 must not resurrect it as the old card code; they build it through the role/perk handlers.
9. **Mole without police moments** still works in C2 (police stay until S3a.2). Do not cut `police.ts` in C2a even though A10 lists it; it is list 3.
10. **knip in CI (C3)** will fail until list 1b's 63 one-word un-exports land in C2d, so C3 must follow all C2 PRs.

---

## Decisions (provisional)

1. **Quick split:** the mode goes in C2b; the 15-minute preset stays, relabelled "15 min" in C2b, its id renamed in S3a.3. Reason: a 15-minute session is a valid R7 length (session ÷ round cap), and e2e and server tests run on it.
2. **Rookie kept** until S3a.6: R7 deals 5–7 roles to up to 12 players, so S3a.6 decides what a roleless seat is; deleting the filler now would break every deal.
3. **Embezzler and all Wildcards cut in C2c**, the Balanced mix capped by pool size (no deal code change needed), rather than kept for the deal's sake.
4. **Rig stays until S3a.7** with the rest of the R6 shop (review): `SHOP_COLUMNS` and `SHOP_RULES.swayEventsOff` are untouched in C2.
5. **`V01_NUMBERS`/`V06_NUMBERS`/`V015_NUMBERS`** stay until their last test user goes in S3; only the dead `V013_NUMBERS` goes (C2d), and C2c/C2d strip their keys for cut roles and cards. Repinning R6 tests that S3 deletes anyway has no value. **This departs from the spec bullet** that lists "v0.1 number testkits" in list 2: flagged for the PM.
6. **Stale code citations in keep code** are rewritten in C2e (or a follow-up right after S1), not in S1, so they can point at the new section numbers.
7. **Police moments and the Fixer's raid stop** are list 3 (S3a.2), not list 2, although A10 names them, because the Mole and Fixer still need them until their R7 powers land.
