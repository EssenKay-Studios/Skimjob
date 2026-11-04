# R7 code cleanup audit (step C1)

*4 Nov 2026 · step C1 of `docs/simplified.md` ("C — clean the code"). Deletes nothing. Base: `origin/main` at `f4ee6b1`. This file is deleted again at S5.*

## Owner summary (one page)

**What this is.** Before any R7 code is written, every file in the repo was sorted into four lists: dead now, cut by R7 regardless, replaced later by S3/S4, and keep. A dead-code checker (`knip`) now runs with `pnpm knip`; it is not in CI yet (that is C3).

**The numbers.** The code is about **67,000 lines** (source, tests, CSS, e2e, config; docs excluded), and about half of it (~34,700) is tests.

| List | What | About how many lines | Gone by |
|---|---|---|---|
| 1. Dead now | 13 unused exports, 64 exports only used inside their own file, 1 unused test helper | ~150 | C2a–C2c |
| 2. Cut by R7 regardless | Duel; 11 R6-only roles; 5 dropped event cards; the Server room's "pocket count"; the Quick/Starter coupling to "no shop, no events"; old setting migrations; dead bot code | **~8,000** (≈2,100 code, ≈5,900 tests), plus ~1,900 test lines merged away in C2d | C2a–C2d |
| 3. Replaced in S3/S4 | Heat, loot and splits, acts and checkpoints, tokens and the R6 shop, police moments, the R6 ledger/case file/suspicion board, R6 reveal parts, the R6 UI panels | ~24,700 | the S3/S4 PR that replaces each |
| 4. Keep | RNG, event log, visibility and `viewFor`, meetings and voting, chat, server, lobby, auth, scheduler, host controls, UI kit, art, sim harness | ~34,600 (some to trim in S3) | stays |

**After C2** the repo should be about **57,500 lines** (−15%), the game still runs as R6 minus the cut features, and `knip` reports nothing. The big shrink comes in S3/S4, which replace list 3 instead of adding beside it; the expected size after S4 is roughly 45,000–50,000 lines.

**What will be gone after C2:** Duel mode (2-player call-outs), the Inside Man, Getaway Driver, Fence, Blackmailer, Forger, Muscle, Snitch, Bagman, Cleaner, Mastermind and Embezzler; the Quiet night, Payday, Power cut, Raid rumour and Double-cross cards; the Server room's power; the Rig perk (it only works with the 9-card deck; see Decisions); the old saboteur ("mole") setting migration; 3 whole test files and ~1,900 lines of duplicated test cases.

**Risks to watch** (details at the end):
1. **Quick is two things.** It is a game mode (Starter deck, no shop, no events), which R7 cuts, and the 15-minute timing preset that every e2e full game and many server tests use. C2 keeps the timing preset and only drops the mode; Learn the game (S4.10) replaces it.
2. **Starter deck shrinks** to Rookie + Lookout once Bagman, Cleaner and Inside Man go, so Quick and starter-mode games are mostly Rookies until S3a.6. Playable, but dull.
3. **The Balanced deal loses its second lone wolf** (the Embezzler). The deal already caps at the pool size, so 8+ players get one Mole and a Team player; tests that expect two lone wolves change in C2a.
4. **Games need 3+ players.** `MIN_PLAYERS` goes from 2 to 3 with Duel; any test, fixture or sim matrix cell at 2 players must move to 3 in the same PR.
5. **The shakedown window stays** (the Shield still uses it after the Muscle goes); it goes in S3a.7 with the Shield.

---

## Method

1. **knip 6.44** added as a root dev dependency, `knip.json` at the root, script `pnpm knip`. Each workspace has its real entry points: package `src/index.ts` (with `includeEntryExports` for engine, content and bots, so a re-export nobody imports is reported), `apps/sim` CLI and worker, `apps/server` `main.ts` and `build.mjs`, `apps/web` `main.tsx`, Vite and Playwright configs (picked up by knip's plugins), every `*.test.ts`, every e2e `*.spec.ts` and the art harness. Types and interfaces that are used in their own file (the members of the `GameEvent` union, for example) are not reported (`ignoreExportsUsedInFile` for types only), which removed ~100 lines of noise; values exported but used only in their own file are still reported.
2. **knip result (default mode):** 0 unused files, 0 unused dependencies, 0 unlisted dependencies, **73 unused exports, 3 unused exported types, 1 duplicate export**. With `ignoreExportsUsedInFile: true` for everything, 9 exports and 3 types are unused anywhere at all (list 1a); the other 64 are used only in their own file (list 1b).
3. **knip `--production`** (tests excluded) also run as a cross-check: 8 test-only files (the testkits and `samples.ts`, all expected) and ~170 exports used only by tests. Those are mostly helpers exported for their unit tests and are not dead; they are not listed, except where the code they test is cut.
4. **By hand:** every workspace read area by area (file headers, the role, event, perk and job content, the deal, the deadline rules, settings, bot decision code, sim args and suite, every web screen, gallery page and e2e spec, the CI workflows and scripts). Cut-feature reach was measured by grep over identifiers (`duel`, `callOut`, the 11 role ids, the 5 card ids, `pocketCount`, `V01_NUMBERS`, …); line counts below are `wc -l` for whole files and estimates (±30%) for parts of mixed files.
5. Test-duration data was not collected (the cloud box has 2 cores and the brief forbids running the full suite); slow-test notes come from what the tests do (full games, 12 seats, property runs).

**C2 PR key:** **C2a** engine + content + bots + sim · **C2b** server · **C2c** web + e2e · **C2d** test consolidation (after C2a–c).

---

## List 1 — Dead now

### 1a. Unused anywhere (knip, confirmed by grep)

| Item | Path | Lines | Why dead | Also changes | PR |
|---|---|---|---|---|---|
| `V013_NUMBERS` | `packages/engine/src/v01-numbers.testkit.ts:37–57` | ~20 | No test imports it (the 0.13 numbers it pins were never used after the R5 pass) | none | C2a |
| `ENGINE_VERSION`, `claimantsOf`, `claimsOf`, `ofType` re-exports | `packages/bots/src/index.ts:3,10` | 2 | Nothing outside bots imports them from `@skimjob/bots` (sim/server import from engine) | none | C2a |
| `JobId`, `RoleId` type re-exports | `packages/engine/src/index.ts:4` | 1 | Consumers import them from `@skimjob/content` | keep `RoomId` (used) | C2a |
| `PhaseKind` type | `packages/engine/src/types/state.ts:54` | 1 | Unused anywhere | none | C2a |
| `EVERYTHING_ROLES` / `POOL_ROLES` duplicate | `packages/content/src/setup.ts:47,56` | 2 | Same value under two names; only `POOL_ROLES` / `DECKS.everything` are read | keep one name | C2a |
| `ACC_COLOURS` | `apps/web/src/art/crookLooks.ts:34` | 1 | Unused anywhere | none | C2c |
| `meetingName`, `MeetingName`, `meetingAfter` re-export | `apps/web/src/game/extension.ts:30` | 1 | Callers import them from `game/wording.ts` | none | C2c |

### 1b. Exported but used only in their own file (knip; drop the `export`)

These are not dead code, but C3 turns knip on in CI, so each must lose its `export` (or gain a real importer). One-word edits.

| Package | Count | Items | PR |
|---|---|---|---|
| engine | 11 | `heldTake` (accomplices), `cleanThreshold` (crew), `cardDef`, `cardEffect` (deck), `regularMeetingId`, `emergencyMeetingId` (meeting), `PLAYER_ID_PATTERN`, `RESERVED_PLAYER_IDS`, `deckIdOf`, `policeRuns`, `dealShop` (setup) | C2a |
| bots | 12 | `wantsCallOut` (bot; Duel, deleted instead), `CLAIM_STYLE`, `RARELY`, `EVIDENCE_ROLES`, `BLUFF_WHEN_ACCUSED`, `ACCUSED_AT`, `doubleClaims` (claims), `TOP_FACTOR`, `skimEstimate`, `ratesSelfTop` (forecast), `foreseenCardHeat` (heat; Mastermind, deleted instead), `BIG_SAFE` (suspicion; Fence, deleted instead) | C2a |
| sim | 13 | `DECIDED_EARLY_LEAD_SHARE`, `metrics`, `OUTPUT_FILES`, `pct`, `Z95`, `DEFAULTS`, `parseShard`, `SETUPS`, `GATED_FROM_PLAYERS`, `cellKey`, `isStar`, `fixedGames`, `optionsProblem` | C2a |
| server | 6 | `pkceChallenge`, `DEFAULT_STAND_IN`, `parseBoardEdit`, `checkNote`, `rateLimiter`, `API_PREFIX` | C2b |
| web | 22 | `HAT_TOP`, `DECK_OPTIONS`, `QUICK_NOTE` (deleted instead, list 2), `ShopSheet`, `heatBand`, `myGameHref`, `plainName`, `CHAT_MAX_MARKS`, `cardEvent`, `TAG_ORDER`, `powerText`, `earnsText`, `tallyOf`, `SEEN_DEBOUNCE_MS`, `CATCH_UP_MS`, `AWAY_MIN_HIDDEN_MS`, `backoffMs`, `socketUrl`, `ArtSection`, `CHAT_DOCK_QUERY`, `useChatRead` | C2c |

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
| `apps/web/src/game/describeEvent.ts`, `game/meeting.ts`, `game/away.ts`, `screens/Meetings.tsx` Duel lines | ~25 | call-out wording and buttons | | C2c |
| Tests: `duel.test.ts` (247), `duel.qa.test.ts` (201) whole; Duel cases in `extension.qa.test.ts`, `view.leak.test.ts`, `invariants.prop.test.ts`, `crew-r2b.qa`, `owner-decisions.qa`, `crew.qa`, `commands.hostile`, `claims*`, `bots run.test.ts`, `server scheduler.qa.test.ts` (17 refs), `scenarios.int.test.ts` (9), web `describeEvent.test.ts`, `meeting.test.ts`, `claim.qa.test.ts` | ~448 whole + ~350 cases | | `samples.ts` keeps one sample per remaining type (compiler-checked) | C2a / C2b / C2c by package |

### 2.2 R6-only roles (A8 "Cut from R6")

Cut: **Inside Man, Getaway Driver, Fence, Blackmailer, Forger, Muscle, Snitch, Bagman, Cleaner, Mastermind, Embezzler** (11). Kept into S3a.6 (powers rewritten there): Lookout, Hacker, Smooth Talker, Auditor, Detective, Priest, Fixer, Mole, and the Rookie filler (see Decisions).

| Path(s) | Lines | What goes | Also changes | PR |
|---|---|---|---|---|
| `packages/content/src/roles.ts` | ~150 of 364 | 11 `ROLES` entries; `RolePower` kinds `fenceSafe`, `blackmail`, `forge`, `embezzle`, `cancelShakedown`, `snitch`, `bagman`, `cleaner`, `foresee`, `getaway`; `RoleScoring.lootPerPointOverFinalTarget` (Inside Man only); `STOLEN_VOTE_WEIGHT`, `CLEANER_REWARD_EVERY`, `BAGMAN_STREAK`; token triggers only these roles earn (`allInStreak`, `coolingRounds`, `forgedShakenClean`, `stolenVoteDecided`, `safeReached`, `heatReached`, `cancelledClean`, `targetShakenDirty`) | `content.test.ts`, `content.qa.test.ts` | C2a |
| `packages/content/src/setup.ts` | ~15 | `STARTER_ROLES` → `["rookie","lookout"]`; `STANDARD_ROLES` drops muscle, cleaner, fence, getawayDriver, embezzler; `RANDOM_DEAL_SINGLETONS` → `["mole"]` | Balanced-mix tests (Risks 3) | C2a |
| `packages/engine/src/accomplices.ts` | 47 whole | Blackmailer stolen votes, Embezzler "always dirty", Forger plants | `meeting.ts` tally, `view.ts`, `end.ts` | C2a |
| `packages/engine/src/crew.ts` | ~110 of 274 | Muscle cancel + naming, Blackmailer, Forger, Snitch, Fixer-unrelated token rewards of cut roles, Embezzler take | `handle.ts` `useAbility` routing | C2a |
| `packages/engine/src/round.ts` | ~60 of 377 | Fence safe, Bagman bonus, Cleaner Rooftop, Getaway Driver reverse, Embezzler, Forger sighting in the move | | C2a |
| `packages/engine/src/meeting.ts` | ~50 of 482 | Muscle cancel window *trigger* (the window itself stays for the Shield), Snitch target votes, stolen votes in the tally | | C2a |
| `packages/engine/src/end.ts`, `reveal.ts`, `types/reveal.ts` | ~45 | Inside Man scoring, Snitch target win, Embezzler/★ lines for cut roles | | C2a |
| `packages/engine/src/deck.ts` Mastermind `foresee`/`cardForeseen` | ~25 | | `types/events.ts` `CardForeseen`; reveal | C2a |
| `packages/engine/src/setup.ts` | ~25 | `snitchTargetAssigned` deal step, Fence/Getaway special cases | | C2a |
| `packages/engine/src/types/events.ts`, `commands.ts`, `state.ts`, `samples.ts`, `view.ts` | ~140 | `SnitchTargetAssigned`, `VoteCompromised`, `SightingForged`, `VotesStolen`, `MuscleNamed`, `CardForeseen`, `RaidStopped`-only-by-cut-roles fields, `fenceSafe`/`safe` state fields, ability variants | `view.leak.test.ts` scrub list | C2a |
| `packages/engine/src/overrides.ts` | ~30 of 302 | override keys for cut roles (`insideMan`, `fence`, `embezzler`, `getawayDriver`, `cleaner`, `bagman`) | `overrides.test.ts` | C2a |
| `packages/bots/src/bot.ts` | ~90 of 456 | Snitch vote share, Bagman all-in, Muscle threshold, Fence/Embezzler/Forger/Blackmailer/Cleaner/Getaway play | `personalities.ts` knobs only these read | C2a |
| `packages/bots/src/claims.ts`, `perks.ts`, `suspicion.ts`, `read.ts`, `forecast.ts`, `heat.ts` | ~70 | `EVIDENCE_ROLES` entries, `BIG_SAFE` (Fence), `foreseenCardHeat` (Mastermind), cut-role bluff tables | | C2a |
| `apps/sim/src/metrics.ts`, `record.ts`, `suite/targets.ts`, `suite/report.ts` | ~40 | per-role rows for cut roles, Muscle/Embezzler metrics, ★ roles that are cut | `metrics.test.ts`, `suite.test.ts`, `split-gate.qa.test.ts` | C2a |
| `apps/server/src/scheduler.ts`, `timing.ts`, `live.ts`, `chat.ts` | ~10 | Muscle comments/naming; the `shakedownWindowMs` stays (Shield) | `police.qa.test.ts` unaffected | C2b |
| `apps/web/src/game/describeEvent.ts`, `game/extension.ts`, `game/reveal.ts`, `game/hud.ts`, `components/Extension.tsx`, `components/Reveal.tsx`, `screens/GalleryExtension.tsx`, `screens/GalleryReveal.tsx` | ~80 | lines and gallery samples for cut roles and their events | `describeEvent.test.ts`, `extension.test.ts`, `components/extension.qa.test.ts`, `reveal.test.ts` | C2c |
| Tests, whole file: `packages/bots/src/embezzler.qa.test.ts` (55) | 55 | | | C2a |
| Tests, cases: `roles.test.ts` / `roles.qa.test.ts` (~600 of 988), `crew.test.ts` / `crew.qa.test.ts` / `crew-r2b*` (~700 of 1,326), `meeting*` (~200), `round*` (~200), `end*` (~150), `extension*` (~400), `view*` (~150), `perks*` (~80), `alibi*` Forger (~60), `claims*` (~60), `invariants.prop.test.ts` role arbitraries (~40); bots `bot.test.ts`, `bots.qa`, `run.test`, `reveal*`, `r6-balance.qa`, `extension.qa`, `claims*` (~350); sim (~40); server `scheduler.qa`, `scenarios.int` Muscle window cases (~60); web unit (~120), e2e `extension*.spec.ts`, `reveal*.spec.ts` role cards (~40) | ~3,250 | | C2a / C2b / C2c |

### 2.3 Dropped event cards (A11.1): Quiet night, Payday, Power cut, Raid rumour, Double-cross

| Path(s) | Lines | What goes | Also changes | PR |
|---|---|---|---|---|
| `packages/content/src/events.ts` | ~25 of 81 | 5 `EVENTS` entries; `EventEffect` kinds `heat`, `blackout`, `raidRumour`, `doubleCross` (`roomSurge` stays for Shift change until S3a.8) | `content.test.ts` | C2a |
| `packages/engine/src/deck.ts` | ~70 of 206 | their effect functions, `answerDoubleCross`, the offer | `handle.ts` handler; `reduce.ts` (`doubleCrossOffered/Answered/Resolved`, `raidRumourHit`); `types/events.ts` (4 interfaces, ~50); `types/commands.ts` `answerDoubleCross`; `types/state.ts` `DoubleCrossOffer`, `offer`; `samples.ts`; `overrides.ts` `quietNight`/`payday` keys; `round.ts` blackout hook (Power cut) | C2a |
| `packages/engine/src/v01-numbers.testkit.ts` `V06_NUMBERS.events.quietNight` | 1 | | | C2a |
| `packages/bots/src/bot.ts` Double-cross answer (~15), `heat.ts` Quiet night | ~20 | | | C2a |
| `apps/server/src/live.ts` `answerDoubleCross: true` | 1 | command allow-list | `live.test.ts` | C2b |
| `apps/web/src/game/describeEvent.ts`, `game/extension.ts`, `game/away.ts`, `game/reveal.ts` Double-cross lines, gallery card samples | ~60 | | web unit tests, `extension.qa.test.ts` | C2c |
| Tests: `deck.test.ts` / `deck.qa.test.ts` (~350 of 799), `owner-decisions.qa` (~40), `view.leak` (~20), `reveal*` (~30), `invariants.prop` (~10), bots (~40), web (~60) | ~550 | | | C2a / C2c |

### 2.4 The Server room's old power (A11.4)

| Path(s) | Lines | What goes | Also changes | PR |
|---|---|---|---|---|
| `packages/content/src/jobs.ts` `serverRoom.info: "pocketCount"`, `rooms.ts` `RoomInfo` member | ~3 | the room becomes `info: "none"` with 0 loot until S3a.1 gives it coins | | C2a |
| `packages/engine/src/round.ts`, `reduce.ts`, `types/events.ts` `PocketCount`, `samples.ts` | ~35 | | `view.leak.test.ts` | C2a |
| `packages/bots/src/suspicion.ts` Server room reading | ~10 | | | C2a |
| `apps/web/src/game/describeEvent.ts`, `game/board.ts` | ~8 | | | C2c |
| Tests: `round*.test.ts`, `job.qa`, `alibi.qa`, `deck.qa`, `evidence.test`, `setup.test`, `types.qa` cases | ~120 | | | C2a |

### 2.5 Quick as a game mode, and starter mode (A11.3)

**Split:** the *mode* (Quick forces the Starter deck, no events, no tokens or shop) goes; the `quick` **session-length timing preset stays** (it is the 15-minute preset every e2e full game and many server tests run on) until S3a.3 rewrites timing as session length ÷ round cap. See Decisions and Risks 1.

| Path(s) | Lines | What goes | Also changes | PR |
|---|---|---|---|---|
| `packages/engine/src/setup.ts`, `types/config.ts` | ~25 | `starterMode` (Starter deck + no shop + no events), "Starter in starter mode" in `deckIdOf` | `setup.test.ts` (16 refs), `setup.qa`, `roles.test`, `extension*` | C2a |
| `apps/server/src/lobby.ts:349–365`, `settings.ts` `starterMode`, the "starter mode needs events off" rule | ~25 | Quick no longer forces Starter / events off / no shop | `lobby.test.ts`, `settings.extension.qa.test.ts` (8 refs), `host*.test.ts` | C2b |
| `apps/web/src/components/DeckSettings.tsx` `QUICK_NOTE`, `effectiveDeck`, locked state; `components/Extension.tsx` "Quick games have no tokens…"; `game/extension.ts` `hasShop` Quick reading; `screens/GalleryExtension.tsx` Quick samples | ~40 | | `extension.test.ts`, `components/extension.qa.test.ts` (9 refs) | C2c |
| e2e: `extension.spec.ts` "Quick locks Starter" test (~45), `extension.qa.spec.ts` "Quick games have no tokens and no shop" (~25) | ~70 | | | C2c |

### 2.6 Old migrations and fallbacks

| Path(s) | Lines | What goes | Why safe | PR |
|---|---|---|---|---|
| `apps/server/src/settings.ts` `LEGACY_MOLE` saboteur-setting migration (lines 14–15, 67–80, 113) | ~25 | read path for the dropped "mole" lobby setting | No real players; S5 clears old games before deploy | C2b |
| `packages/engine/src/types/config.ts` `mole?: MoleSetting`, `setup.ts` legacy `mole` validation | ~15 | engine side of the same migration | same | C2a |
| `packages/bots` crewSeed: the public-data `gameDigest` fallback is **already gone** (PR #64); `crewseed-required.qa.test.ts` (114) only proves its absence | — | merge into `crewseed.qa.test.ts` | | C2d |
| `apps/web/e2e/signin.spec.ts` fixture rows with `sessionLength: "quick"` | — | keep (the preset stays) | | — |

### 2.7 Perk that only works with a cut card mechanic

| Path(s) | Lines | What goes | Why | PR |
|---|---|---|---|---|
| Rig perk: `content/perks.ts` `rig`, `PERK_RULES.rigOptions`, `SHOP_COLUMNS.sway`; engine `perks.ts` `rigPicked`, `RiggedCard` state, `RigPicked` event; bots `perks.ts` Rig; web shop line | ~60 code, ~120 tests | "Pick the next card from two" belongs to the 9-card deck; not in A9 | **Provisional:** could also wait for S3a.7 with the rest of the shop. Listed here because nothing in R7 can use it and it drags `deck.ts` internals. If the reviewer prefers, move it to S3a.7. | C2a |

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
| Tokens (20 triggers), `tokenEarned`, R6 shop (3 columns, 9 perks), `buyPerk`/perk spending, Shield auto-cancel, Recharge, Emergency perk, `shakedownPending` window and `resolveShakedown` deadline | `content/perks.ts`, `content/roles.ts` `TokenTrigger`/`rewards`; `engine/perks.ts` (197), `perks.testkit.ts`, `crew.ts` rewards, `meeting.ts` window; bots `perks.ts` (163); server `DEADLINE_RULES.resolveShakedown`, `timing.ts` `shakedownWindowMs`; sim token metrics | ~700 code, ~1,000 tests | **S3a.7** (engine/bots/server); web shop **S4.7** |
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

**List 3 total:** engine ~7,500 (≈2,500 code), content ~600, bots ~2,000, sim ~1,800, server ~1,500, web src ~9,000, e2e ~2,300 → **~24,700 lines**.

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

There are 39 unit/QA name pairs and 27 QA-only files. QA files were written as adversarial additions, but over many fix rounds several now re-test the same happy paths. Recommended actions (C2d unless the code under test is cut):

| Pair | Lines (unit + QA) | Finding | Action | PR |
|---|---|---|---|---|
| `engine/duel.test` + `duel.qa` | 247 + 201 | Duel | delete both | C2a |
| `engine/roles.test` + `roles.qa` | 346 + 642 | ~60% cut roles; rest R6 powers (list 3) | delete cut-role cases; rest goes in S3a.6 | C2a |
| `engine/crew.test` + `crew.qa` + `crew-r2b.test` + `crew-r2b.qa` | 245 + 337 + 426 + 318 | four files on one module; "r2b" names an old milestone; heavy overlap on Auditor/Detective/Priest uses | delete cut-role cases (C2a); merge the remaining into `crew.test.ts` + `crew.qa.test.ts` | C2a, C2d |
| `engine/extension.test` + `extension.qa` | 446 + 736 | named after the R6 spec, cross-cutting (roles, tokens, decks, police); overlaps `roles*`, `perks*`, `setup*` | delete Duel/cut-role/cut-card cases (C2a); move the rest beside their module (`setup.test`, `perks.test`, `meeting.test`) and drop exact duplicates | C2a, C2d |
| `engine/owner-decisions.qa` (solo) | 312 | pins 1–3 Nov owner rulings, most of them R6 (Duel, police, tokens) | delete overruled cases; keep any still-true ruling in its module's test | C2a, C2d |
| `engine/deck.test` + `deck.qa` | 444 + 355 | ~45% dropped cards | delete dropped-card cases | C2a |
| `engine/meeting.test` + `meeting.qa` | 584 + 410 | vote tally and emergency calls tested in both | merge duplicate tally/visibility cases into `meeting.test` | C2d |
| `engine/view.test` + `view.qa` + `view.leak` | 257 + 467 + 554 | `view.qa` repeats several scrub checks now in `view.leak` | drop the duplicates from `view.qa` | C2d |
| `engine/types.test` + `types.qa` | 79 + 238 | `types.qa` constructs every event; `samples.ts` + leak scrub already enforce this | cut `types.qa` to the cases the compiler can't check | C2d |
| `engine/lockin.test` + `lockin.qa`, `bots/lockin.qa`, `server/lockin.qa`, e2e `lockin.qa.spec` | 100 + 194 + 34 + 395 + 83 | lock-in grace tested at every layer | keep engine + server; drop the bots copy (34) | C2d |
| `bots/crewseed.qa` + `crewseed-required.qa` + `server/crewseed.qa` + `sim/r5.qa` | 128 + 114 + 83 + 79 | crewSeed secrecy and determinism tested in four places | merge the two bot files into one; rename `sim/r5.qa.test.ts` to `sim/crewseed.qa.test.ts` (its content is crewSeed determinism, not R5) | C2d |
| `bots/reveal.test` + `reveal.qa` | 69 + 375 | QA tests engine reveal through bots | move engine-reveal cases to `engine/reveal.qa`, the rest go with S4.9 | C2d |
| `server/chat.test` + `chat.qa` + `chat.evidence.qa` | 308 + 315 + 134 | rate limit and length tested in both | merge duplicates | C2d |
| `server/host.test` + `host.qa` | 377 + 539 | pause/extend happy paths in both | merge duplicates | C2d |
| `server/scheduler.test` + `scheduler.qa` | 363 + 449 | QA has 17 Duel refs; overlap on reconcile | delete Duel (C2b), merge reconcile duplicates (C2d) | C2b, C2d |
| `web/game/chat.test` + `chat.qa` + `components/chat.qa` + `chat.render.test` | 232 + 302 + 134 + 119 | four files on chat formatting | merge into `game/chat.test` + one QA | C2d |
| `web/components/extension.qa` (solo) | 702 | R6 Extension UI, 9 Quick refs | delete Quick/cut parts (C2c); rest goes in S4.5/S4.7 | C2c |
| `web/wording.qa` (solo) | 52 | meeting names without acts | goes with `wording.ts` in S3a.5 | — |
| e2e pairs (`chat`, `extension`, `game`, `host`, `lobby`, `meeting`, `notes`, `responsive`, `reveal`, `signin`) | ~3,700 | `responsive.spec` + `responsive.qa.spec` + `game.responsive` + `chat.responsive` check the same widths on the same routes | merge into one responsive spec per route list; the rest wait for their S4 replacement | C2d (responsive), S4 |

### Tests of removed rules (not covered above)

| Test | Lines | Rule | Action | PR |
|---|---|---|---|---|
| `bots/embezzler.qa.test.ts` | 55 | Embezzler bot | delete | C2a |
| `bots/r6-balance.qa.test.ts` | 95 | R6 balance knobs (Muscle threshold, ★ lean) | delete cut-role cases; rest S3a.6 | C2a |
| `bots/r5.test.ts` | 62 | R5 bot settings: Bagman all-in (cut), Hacker loops its own room (list 3) | delete the Bagman case (C2a); the Hacker case goes in S3a.6 | C2a |
| `bots/win-rule.qa.test.ts` | 54 | R6 one-crew win rule with ★ role endings | list 3: replaced in S3a.4 | — |
| `sim/presets.qa.test.ts` | 35 | Duel/Starter sim presets | delete Duel parts | C2a |
| `server/settings.extension.qa.test.ts` | 75 | saboteur migration, starter mode | delete those cases | C2b |
| `server/police.qa.test.ts` | 116 | hidden police moments | S3a.2 | — |

### Slow tests with no unique value

Durations were not measured (2-core box; see Method); these are the heavy ones by construction:

| Test | Why slow | Unique value? | Action | PR |
|---|---|---|---|---|
| e2e `@fast-clock` full Quick games: `game.spec` (1 game), `game.qa.spec` (12 seats), `overflow.qa.spec` (real game over), `reveal.spec` (real game) | each plays a whole 9-round game on a scaled clock | the 12-seat game is a required QA check; the others overlap (all reach game over) | keep `game.spec` and the 12-seat `game.qa`; switch `overflow.qa` and `reveal.spec` to the gallery reveal or a log fixture | C2d |
| `engine/invariants.prop.test.ts` | property runs over random games | yes (leak and fold invariants) | keep; trim arbitraries for cut roles/cards (C2a) | C2a |
| `server/scenarios.int.test.ts` | full server games | partly overlaps `live.test` | delete Duel/Muscle scenarios; keep one full game | C2b |
| `bots/run.test.ts`, `sim/sim.qa.test.ts`, `sim/suite/suite.test.ts` | many full bot games | sim determinism is unique; batch-size repetitions are not | lower game counts where a smaller batch proves the same | C2d |

**Test audit total:** ~1,900 lines merged away in C2d (engine ~500, server ~330, web ~355, e2e ~480, sim ~115, bots ~100) on top of the list-2 test deletions.

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
- **Refs in list 4 code** (RNG, reduce, view, meetings core, server, chat, lobby, auth, host, UI kit, art): S1's brief says to "fix every reference (including code comments citing extension.md or old design sections)". That is a docs PR touching ~150 code files. **Provisional:** do it as part of **C2d** (or a small C2e right after S1 merges), when the new section numbers exist, rewriting `extension.md`/`m2-plan.md` citations to the new `design.md` section or dropping them; S1 itself then only fixes `.md` links. The C2 PRs must not add new old-style citations.

---

## Summary table

Lines (`wc -l`, tests included; list 2/3 partly estimated, ±30%):

| Package | Now | List 1 | List 2 | List 3 | List 4 | After C2 |
|---|---|---|---|---|---|---|
| engine (src + tests) | 18,690 | ~30 | ~5,550 | ~7,500 | ~5,600 | ~12,600 |
| content | 1,020 | ~5 | ~290 | ~600 | ~130 | ~730 |
| bots | 4,390 | ~20 | ~820 | ~2,000 | ~1,550 | ~3,450 |
| sim | 4,360 | ~15 | ~180 | ~1,800 | ~2,350 | ~4,050 |
| server | 11,600 | ~10 | ~360 | ~1,500 | ~9,700 | ~10,900 |
| web src | 22,200 | ~25 | ~620 | ~9,000 | ~12,550 | ~21,200 |
| web e2e | 4,430 | 0 | ~120 | ~2,300 | ~2,000 | ~3,830 |
| CI, scripts, config | ~690 | 0 | 0 | 0 | ~690 | ~690 |
| **Total** | **~67,400** | **~105** | **~7,950** | **~24,700** | **~34,600** | **~57,500** |

"After C2" = now − list 1 − list 2 − the ~1,900 test lines C2d merges away. After S3/S4 replace list 3 (new code is expected to be about half the size of what it replaces), the repo should land near 45,000–50,000 lines.

---

## Risks — "the game still runs (R6 minus cut features)" after each C2 PR

1. **Quick is a timing preset as well as a mode.** `sessionLength: "quick"` (15 min) is what `e2e/setupGame.ts`, every `@fast-clock` full game, the 12-seat QA game and ~150 server test lines use. Deleting it in C2b/C2c would break most of e2e. C2 removes only the mode coupling (Starter forced, events off, no shop). **Side effect:** after C2b, e2e full Quick games deal the Standard deck with events and a shop; full games may take longer and the e2e assertions that expected "no shop" in Quick (`extension.qa.spec.ts`) are deleted in C2c. C2b and C2c should land back to back, or C2b keeps `starterMode` forced for Quick until C2c (pick one in the C2b brief).
2. **Starter deck collapses to Rookie + Lookout** once Inside Man, Bagman and Cleaner go. Starter/Quick games still deal and play (Rookies fill), but QA on C2a should play one Starter game to the end.
3. **Balanced deal at 8+ players** wants 2 lone wolves; with the Embezzler gone only the Mole remains. `drawnCount` already caps at the pool size, so the deal works (1 Mole + Team players), but the R6 balance tests and the sim's Balanced cells at 8–12 expect 2. Update them in C2a; the sim baseline (`docs/balance/baseline.json`) will drift; S5 refreshes it, so C2a's sim smoke must not compare against the baseline as a gate.
4. **3+ players.** With Duel gone, `MIN_PLAYERS` = 3. Grep every `players: [a, b]` fixture, the sim's `-p 2` presets and matrix cells, lobby start-button tests and any e2e that starts a 2-seat game (`setupGame.ts` defaults) before merging C2a; the server refuses 2-seat starts after C2b.
5. **Shakedown window after the Muscle.** `shakedownPending` and the `resolveShakedown` deadline still run when a Shield is in the shop. C2a must keep the window's trigger for the Shield only and keep "a window always runs its full length" (STATUS engineering note), or the cancel leaks by timing.
6. **Cut roles in stored settings.** A lobby whose stored `roles` list names a cut role must not crash `validateConfig` after C2a/C2b. Either filter unknown role ids when the lobby starts a game, or accept the risk (no real players; S5 clears old games). C2b should filter them.
7. **Event log replay.** Stored R6 games whose logs contain deleted event types (`callOutMade`, `doubleCrossOffered`, `pocketCount`, …) will make `applyEvent` throw on load. Acceptable (no real players; R6 logs won't replay anyway, S5 clears them), but dev databases (`.pglite/`) need wiping after C2a, and the server must not crash at startup on such a game: check `startup.ts` loads lazily, or wipe before deploying any C2 build.
8. **Power cut vs. the Electrician/Blackout.** R7 keeps a blackout as a role power and a perk. Deleting the card's `blackout` effect kind in C2a is fine, but S3a.6/S3a.7 must not resurrect it as the old card code; they build it through the role/perk handlers.
9. **Mole without police moments** still works in C2 (police stay until S3a.2). Do not cut `police.ts` in C2a even though A10 lists it; it is list 3.
10. **knip in CI (C3)** will fail until list 1b's 64 one-word un-exports land in C2a–C2c, so C3 must follow all C2 PRs.

---

## Decisions (provisional)

1. **Quick split:** the mode goes in C2; the `quick` timing preset stays until S3a.3 (reason: e2e and server tests depend on it; A11.3 replaces the mode, not the test clock).
2. **Rookie kept** until S3a.6: R7 deals 5–7 roles to up to 12 players, so S3a.6 decides what a roleless seat is; deleting the filler now would break every deal.
3. **Embezzler cut in C2a** with the Balanced mix capped by pool size (no code change needed), rather than kept for the deal's sake.
4. **Rig perk cut in C2a** (needs the 9-card deck control); movable to S3a.7 if the reviewer prefers.
5. **`V01_NUMBERS`/`V06_NUMBERS`** stay until their last test user goes in S3; only the dead `V013_NUMBERS` goes in C2a. Repinning R6 tests that S3 deletes anyway has no value.
6. **Stale code citations in keep code** are rewritten in C2d (or a C2e right after S1), not in S1, so they can point at the new section numbers.
7. **Police moments and the Fixer's raid stop** are list 3 (S3a.2), not list 2, although A10 names them, because the Mole and Fixer still need them until their R7 powers land.
