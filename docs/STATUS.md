# Status

_Last updated: 7 Nov 2026._

## Where things stand
- **Specs:** `docs/design.md` is the single rules spec (R7 Simplified); `docs/simplified.md` is the plan. Current decisions: `docs/decisions.md`. Later: Skimjob Advanced (`docs/advanced.md`). Out of scope: the recruited Mole.
- **Content** 0.17.0 (the live R6 build; R7 replaces it).
- **Live:** https://skimjob.duckdns.org on the owner's AWS Lightsail box (`docs/deploy.md`), commit 1a4e083, Google sign-in on. The live game has no real players, so R7 is built straight on `main`.
- **Mockups:** the [approved S2 mockups](https://claude.ai/artifact/QtmuUsTX9aFxiESdDQHzEp) (owner, 7 Nov) are the S4 reference for wording and behaviour; their artboard captions and the icon key are review notes, not product UI.
- **Next step:** S3a (#88) and S3b, in parallel.

## Tasks, follow-ups and owner questions
Tracked as GitHub issues, not in this file:
- **Board:** [Skimjob R7](https://github.com/orgs/EssenKay-Studios/projects/2) (private; Status Todo / In progress / In review / Owner review / Done; fields Step, Model, PR).
- **Milestone:** [R7 Simplified](https://github.com/EssenKay-Studios/Skimjob/milestone/1) (`docs/simplified.md`), steps S0 to S5 and C as `type:task` issues titled "S1 — ...", "C2a — ...".
- **Follow-ups:** issues labelled `type:follow-up`. **Owner questions:** issues labelled `owner-decision` (`provisional` when a reading awaits confirmation); the rule itself stays in `docs/decisions.md`.
- Rules and decisions stay in the repo: `docs/design.md`, `docs/decisions.md`, `docs/simplified.md`.

Record: M1 (engine, simulator, bots), M2-1 to M2-13 (server, web, chat, Google sign-in, host controls) and R6 are built and live; M2-14 and M2-15 are parked. History: git, the PRs and `docs/archive/`.

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
