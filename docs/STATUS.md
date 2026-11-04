# Status

_Last updated: 4 Nov 2026._

## Where things stand
- **Specs:** `docs/design.md` is the single rules spec (R7 Simplified); `docs/simplified.md` is the plan. Current decisions: `docs/decisions.md`. Later: Skimjob Advanced (`docs/advanced.md`). Out of scope: the recruited Mole.
- **Content** 0.17.0 (the live R6 build; R7 replaces it).
- **Live:** https://skimjob.duckdns.org on the owner's AWS Lightsail box (`docs/deploy.md`), commit 1a4e083, Google sign-in on. The live game has no real players, so R7 is built straight on `main`.
- **Next step:** R7 step **S0** (this docs clean-up), then S1.

## Current milestone: R7 Simplified (`docs/simplified.md`)

Approved after the owner's playtest (3 Nov): simpler rules (Part A) and clearer presentation (Part B). Run as "How to run it" says.

- [ ] **S0** Record the 4 Nov decisions; clean the docs so every live `.md` describes R7 only. **In progress.**
- [ ] **S1** Spec freeze: `docs/design.md` becomes the single spec; the R6 extension spec, the M2 plan and the R6 balance report move to `docs/archive/`; "Content text" section; S5 balance gates. **Owner approves the spec.**
- [ ] **C** Clean the code (alongside S2): C1 audit (checker + `docs/cleanup-audit.md`), C2 delete in about four PRs (engine+content+bots+sim; server; web+e2e; test consolidation), C3 guardrails (scoped tests, `knip` in CI, builder/reviewer cleanup rules).
- [ ] **S2** Mockups of 5 screens (Design artifact type), no code. **Owner approves the mockups.**
- [ ] **S3** Two tracks, straight on `main`:
  - (a) new rules: 1 rooms, coins and grabs; 2 bells, cooling, raids, Wanted and the bust; 3 the bank, round cap and endings; 4 equal shares, kitty, fair share, missing, honesty; 5 meetings at bank thirds, briefings and shakedowns; 6 roles; 7 perks and the shop; 8 the 4-card event deck; 9 the plan-board snapshot.
  - (b) interface foundations: 1 `InfoTip` and content-text plumbing; 2 the one-screen shell and bottom sheets; 3 the per-user Tips setting; 4 the plan board's live channel; 5 the case board shell.
- [ ] **S4** Wire the screens: 1 board art; 2 the move; 3 plan board UI; 4 case board data and ⚠ checks; 5 role cards, rulebook, opponents; 6 teaching pop-ups; 7 black market; 8 meeting and shakedown screens; 9 reveal; 10 "Learn the game". **Owner tries a test deploy.**
- [ ] **S5** Final dead-code audit, one balance pass (Sim suite workflow), deploy. **Owner playtests.**

Record: M1 (engine, simulator, bots), M2-1 to M2-13 (server, web, chat, Google sign-in, host controls) and R6 are built and live; M2-14 and M2-15 are parked. History: git, the PRs and `docs/archive/`.

## Open follow-ups
- **Flaky tests:** see `docs/pipeline/HANDOFF.md` "Known flaky tests"; stabilise them.
- **Board PATCH rate limiter has no test** (`apps/server/src/notes.ts` `rateLimiter`); add one with the fake clock, if the notes code survives C.
- **CI actions pinned to `@v4` tags, not SHAs:** `ci.yml`, `sim-suite.yml`.
- **Quiet hours** must freeze deadlines (M3; host pause already does); server-picked meeting slots must avoid quiet hours once they exist.
- **Before playtests:** check bot pace (bots react to every change they can see; an instant public reaction to something private is a mild tell).
- A slow test in `packages/bots/src/run.test.ts` needs an explicit timeout.

## Engineering notes (standing rules)
- **Engine:** handlers draw randomness only through the `Draw` that `handleCommand` passes them (`withRng` appends `rngAdvanced`); never read `state.rng`. New commands go in `HANDLERS` (`handle.ts`) and return a reason string to refuse; `applyEvent` throws on unfolded event types, so add cases in `reduce.ts`. Every ending goes through `gameEnded` (`end.ts`); every shakedown path goes through `afterVote` (`meeting.ts`); any new place that starts a round uses `startRound`.
- **Views and leaks:** clients and bots get only `viewFor()` (a deep copy). A view's `seq` counts only what that player can see; never send a full-log index, `games.config` (has the seed) or `game_events.idx`. A new state field a view shows is added to `viewFor` by hand, and `view.leak.test.ts`'s scrub must hide it if private. `samples.ts` needs one sample per event and command type (the compiler enforces it). `secret` visibility never opens, even after the game.
- **Server:** `command.player` always comes from the session. Run commands as `store.withGameLock(id, …load → handleCommand → append…)`. Deadlines go through `app.live.system` and the scheduler's `reconcile`; never write `deadlines` by hand. A new deadline kind gets one entry in `DEADLINE_RULES`. A view is pushed only when it changed and bots act only when their own view changed (no timing leaks). A command's `{ ok }` reply goes out before its pushes, so tests reading views right after need a barrier. The server must stay one process (per-game lock, scheduler). Migrations are add-only.
- **Chat:** stored and sent exactly as typed; render as text only (never `dangerouslySetInnerHTML` or markdown). Message ids are random UUIDs. The rate limit is in memory per process. Bots don't chat.
- **Database:** no `DATABASE_URL` = PGlite in `.pglite/` (`PGLITE_DIR=memory` for in-memory); tests share one PGlite per file; `pnpm test:pg` runs them on real Postgres.
- **Content:** numbers live in `packages/content`; tunables that should be overridable go in `ContentOverrides` and `validateOverrides`. After any rule, number or bot change, run the sim suite (or the "Sim suite" workflow) with `--compare docs/balance/baseline.json` (`docs/testing.md`).
- **Web:** frames use `<SketchFrame>` with a stable `seed`; new components go in `/dev/gallery`; e2e responsive specs cover 360–1280 px (add new screens to their route lists). A client route must not equal an API `GET` route (the server serves both on one origin).
- **Player ids** match `/^[A-Za-z0-9_-]{1,32}$/` and are never `__proto__`/`constructor`/`prototype`.

## Upcoming milestones
- **Skimjob Advanced** (`docs/advanced.md`): after R7 is built and playtested; additive only.
- **M3** — mobile apps (Flutter), push notifications, quiet hours.
- **M4** — more content (museum, casino, roles, events).

## Questions for the owner
Each is marked *provisional* in the named `docs/decisions.md` section.
1. **Host controls** (#54): players can act while paused; Extend amounts per preset, no cap; replace with bot after 2 missed rounds (never the host, Opportunist), handed back by host or player; lobby kick of any non-host seat.
2. **Google sign-in** (#53): the account's seat is kept on a same-game clash; redirect URI from env; display-name fallback (`name` → `given_name` → "Crook"); scopes `openid profile`; `prompt=select_account`.
3. **R7 provisional readings (PM, 4 Nov)**, `docs/decisions.md` "Provisional readings": the "N coins went missing" formula (taken excluding seized − handed in, never negative); Advanced drops the Inside tip card. (Owner decided on 4 Nov: how coins count toward honesty (once, when first on the table), raid seizure before the split, the end-of-round order with the bust check before the split, every bell visible except a Hacker-hidden room, Books mode dropped.)
4. **Round-end grace lengths** (once everyone has locked in): 1h 10 s, 3h 30 s, 1d 2 min, 3d 5 min, 1w 5 min.
5. **Notes** (case-board seen marks, suspicion board) live outside the engine log, over REST; kept only if that code survives the C and S4 clean-up.
