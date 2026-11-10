# Status

_Last updated: 10 Nov 2026._

## Where things stand
- **Specs:** `docs/design.md` is the single rules spec (R7 Simplified); `docs/simplified.md` is the plan. Current decisions: `docs/decisions.md`. Later: Skimjob Advanced (`docs/advanced.md`). Out of scope: the recruited Mole.
- **Content** 0.26.0.
- **Live** (`docs/deploy.md`): commit fc5768c, deployed 10 Nov 2026: R7 with all of S4 except S4.10 (#111); the old R6 games are cleared. Google sign-in on. The live game has no real players, so R7 is built straight on `main`.
- **Mockups:** the [approved S2 mockups](https://claude.ai/artifact/QtmuUsTX9aFxiESdDQHzEp) (owner, 7 Nov) are the S4 reference for wording and behaviour; their artboard captions and the icon key are review notes, not product UI.
- **S4 is merged except S4.10, Learn the game (#111),** which is next. The live game runs in `GameShell`.
- **Open:** no PRs; the CI-stability fixes #226 and #230 are merged. Next is #111. The owner's playtest tickets #232–#246 are open and come before or alongside it (the PM orders them). #247 (talking bots) is after R7.
- **Then:** S5 (#112, final audit, balance pass, deploy; owner playtest).

## Tasks, follow-ups and owner questions
Tracked as GitHub issues, not in this file:
- **Board:** [Skimjob R7](https://github.com/orgs/EssenKay-Studios/projects/2) (private; Status Todo / In progress / In review / Owner review / Done; fields Step, Model, PR).
- **Milestone:** [R7 Simplified](https://github.com/EssenKay-Studios/Skimjob/milestone/1) (`docs/simplified.md`), steps S0 to S5 and C as `type:task` issues titled "S1 — ...", "C2a — ...".
- **Follow-ups:** issues labelled `type:follow-up`. **Owner questions:** issues labelled `owner-decision` (`provisional` when a reading awaits confirmation); the rule itself stays in `docs/decisions.md`.
- Rules and decisions stay in the repo: `docs/design.md`, `docs/decisions.md`, `docs/simplified.md`.

Record: M1 (engine, simulator, bots), M2-1 to M2-13 (server, web, chat, Google sign-in, host controls) and R6 are built and live; M2-14 and M2-15 are parked. History: git, the PRs and `docs/archive/`.

## Engineering notes (standing rules)
- **Engine:** handlers draw randomness only through the `Draw` that `handleCommand` passes them (`withRng` appends `rngAdvanced`); never read `state.rng`. New commands go in `HANDLERS` (`handle.ts`) and return a reason string to refuse; `applyEvent` throws on unfolded event types, so add cases in `reduce.ts`. Every ending goes through `gameEnded` (`end.ts`); every shakedown path goes through `afterVote` (`meeting.ts`); any new place that starts a round uses `startRound`. Draw only when a rule needs it, so games that skip the rule keep their stream. Roles go through `roleHandler(role)`, with charges per holder in `roleState`; no role ids in `end.ts`. An emergency is accepted only in the result window (§9.3: `phase.kind === "result"`, one per window); never assume a regular meeting or the emergency pool in a full bot game (a bust can end it first, a bot may spend the pool). `deck.ts` has one `applies()` seam for "this card can apply now"; a new event card adds its case there, and the redraw rule (§13) uses it.
- **Public statements and notices:** every player statement is one `said` event (`statement` of kind `plan`, `alibi` or `role`); a new kind goes in that union, not in a new event type, and the plan snapshot rides the round deadline with no wall time. Anonymous public notices (purchases, power cuts) are held and released together at resolution in an order that carries no information (the black market's order, or the game's room order for power cuts), never the order players acted. A round resolves in a fixed order from one command: the said plan, then the nameless `perkSold` notices, then the round's facts; power cuts are announced as the next round starts, with no source.
- **Views and leaks:** clients and bots get only `viewFor()` (a deep copy). A view's `seq` counts only what that player can see; never send a full-log index, `games.config` (has the seed) or `game_events.idx`. A new state field a view shows is added to `viewFor` by hand, and `view.leak.test.ts`'s scrub must hide it if private. `samples.ts` needs one sample per event and command type (the compiler enforces it). `secret` visibility never opens, even after the game.
- **Server:** `command.player` always comes from the session. Run commands as `store.withGameLock(id, …load → handleCommand → append…)`. Deadlines go through `app.live.system` and the scheduler's `reconcile`; never write `deadlines` by hand. A new deadline kind gets one entry in `DEADLINE_RULES`. A view is pushed only when it changed and bots act only when their own view changed (no timing leaks). A command's `{ ok }` reply goes out before its pushes, so tests reading views right after need a barrier. The server must stay one process (per-game lock, scheduler). Migrations are add-only. Outside production `POST /games/:id/start {seed}` names the game's seed; e2e pins one with `startGame({ seed })` when a spec needs a known path.
- **Tests:** seed-swept tests (`view.leak`'s `scrub-…` seeds, `bots/reveal.qa`) must be re-picked whenever a change adds or removes an RNG draw, and must still reach every event, perk and power. `vitest.setup.ts` yields a macrotask after every test, so long files of CPU-bound tests don't hit vitest's 60 s `onTaskUpdate` timeout (#171); keep it, and keep each test well under 60 s.
- **Chat:** stored and sent exactly as typed; render as text only (never `dangerouslySetInnerHTML` or markdown). Message ids are random UUIDs. The rate limit is in memory per process. Bots don't chat.
- **Database:** no `DATABASE_URL` = PGlite in `.pglite/` (`PGLITE_DIR=memory` for in-memory); tests share one PGlite per file; `pnpm test:pg` runs them on real Postgres.
- **Content:** numbers live in `packages/content`; tunables that should be overridable go in `ContentOverrides` and `validateOverrides`. After any rule, number or bot change, run the sim suite (or the "Sim suite" workflow) with `--compare docs/balance/baseline.json` (`docs/testing.md`).
- **Web:** frames use `<SketchFrame>` with a stable `seed`; new components go in `/dev/gallery`; e2e responsive specs cover 360–1280 px (add new screens to their route lists). A client route must not equal an API `GET` route (the server serves both on one origin).
- **Game layout:** the game screen is `GameShell` (`components/GameShell.tsx`): a new panel is one `ShellPanel` entry in `Game.tsx` with a `place` (`left` side tab, `centre`, `right`, or `sheet` for phones only) and, for phones, a `tab`. From 1024 px the panels are columns and side tabs; below it each is a bottom sheet from the tab bar, one open at a time. e2e reaches a panel with `openPanel` / `closePanel` (`e2e/setupGame.ts`; `openPanel` waits for the sheet's slide-up), never by clicking tabs directly, and whole-game loops on phones call `keepRoundOpen`.
- **Teaching pop-ups** (`TeachingPopup.tsx`) step aside for dialogs that need the player: none shows while a meeting or shakedown window is open or once the game has ended, and a lesson on screen waits until then. e2e games switch Tips off for their humans (`startGame`); only the teaching specs opt in.
- **Player ids** match `/^[A-Za-z0-9_-]{1,32}$/` and are never `__proto__`/`constructor`/`prototype`.

## Upcoming milestones
- **Skimjob Advanced** (`docs/advanced.md`): after R7 is built and playtested; additive only.
- **M3** — mobile apps (Flutter), push notifications, quiet hours.
- **M4** — more content (museum, casino, roles, events).
