# Status

_Last updated: 3 Nov 2026. **Development is halted** (owner): every code PR is merged; nothing new starts until the owner says so._

## Where things stand
- **Specs:** `docs/design.md` is the game design; `docs/extension.md` is the rules spec for roles, tokens and the shop and wins on any conflict. Current decisions: `docs/decisions.md`. Out of scope: `docs/rebuild.md` (jobs redesign proposal), Books mode, the recruited Mole.
- **Content** 0.17.0 (R6 balance pass, provisional gates; `docs/balance/r6-balance.md`).
- **Live:** https://skimjob.duckdns.org on the owner's AWS Lightsail box (`docs/deploy.md`). It runs 1a4e083 (all of M2-1 to M2-13 and R6), with Google sign-in on. A paused bot smoke-test game stays in its database (harmless; the app can't end it).
- **Next step:** on hold, owner to resume (M2-14, then M2-15; see `docs/pipeline/HANDOFF.md` "How to resume").

## Current milestone: M2 — playable web prototype

Plan and acceptance criteria: `docs/m2-plan.md`. This is the canonical task list.

1. [x] **M2-1** Server skeleton and game store (Fastify, `pg` + PGlite, migrations, `GameStore`).
2. [x] **M2-2** Identity, invites and lobby API (guest sessions, dev auth stub, lobby routes).
3. [x] **M2-3** Live game channel and server bots (WebSocket, per-seat views).
4. [x] **M2-4** Scheduler and elastic timing (deadlines, presets incl. Quick).
5. [x] **M2-5** Web shell, style kit, lobby screens and host hand-over.
6. [x] **M2-6** Game screen thin slice (first playable build).
7. [x] **M2-7** Meetings and voting UI (#35).
8. [x] **M2-8** Chat: server, feed UI, DMs, evidence cards (#38).
9. [x] **M2-9** Art: bank cutaway, room icons, crooks (#33; wired in with Claim role, #41).
10. [x] **M2-10** Ledger, case file, "While you were away", suspicion board (#46). Also #44: public lock-in marks, presence, early round end, people-majority meeting lock.
11. [x] **M2-11** End-of-game reveal (incl. tokens and purchases) (#55): roles and win rules, ending and why, scores, a scrubbable round timeline (tokens, perks, tip-offs vs patrols, loops vs power cuts, forged sightings, stolen votes), beside #52's final ranking.
12. [x] **M2-12** Google sign-in, stub-ready, and "My games" (#53). Routes `/api/auth/google/{start,callback}`.
13. [x] **M2-13** Host controls and resilience (#54): pause/resume, extend, replace with bot + hand back, lobby kick.
14. [ ] **M2-14** Playtest pass — **paused by the owner**.
15. [ ] **M2-15** Offline demo (in-browser engine and bots, same UI) as a GitHub Pages site — **paused by the owner**.

- [x] **R6 — the Extension** (`docs/extension.md`), built inside M2: R6a rules in engine, content, bots and sim (#50); balance pass, content 0.17.0 (#51); R6b Extension UI: deck picker, rulebook, role cards, shop, Heat breakdown, gap box (#52).
- [x] **Ops:** Lightsail deployment (systemd, nginx, Postgres, weekly `pg_dump`); Mac pipeline and SHA-bound merge gate (#48).

## Done before M2 (record)
- **M1** — engine, simulator and bots (tasks 1–16): rules, `viewFor`, events deck, Duel, sim CLI, the first balance passes.
- **Role deck R1–R5** (#34, #36, #37, #43 and earlier): roles, perks, bot claims, the sim suite; replaced by R6.
- History: `docs/archive/decisions-history.md` and the PRs.

## Open follow-ups (from reviews and QA)
- **R6 balance** (`docs/balance/r6-balance.md`): Heat share of failures 34–54% at 4–6p (design target 10–20%, not gated); Starter succeeds 86–96% and Duel 44% (report-only); the Cleaner sits lowest of the Team roles; revisit team parity 0.10 (gated at 0.20) after the M2-14 playtests.
- **Quiet hours** must freeze police moments and deadlines (M3; host pause already does, #54).
- **Flaky tests:** see `docs/pipeline/HANDOFF.md` "Known flaky tests"; stabilise them. The 12-seat game QA test's real bugs are fixed: reveal overflow (#62) and alibi-window timing (#63). Watch #62's new reveal long-names spec at 1024/1280 in CI (it timed out once locally).
- **Board PATCH rate limiter has no test** (#46): `apps/server/src/notes.ts` `rateLimiter`; add one with the fake clock.
- **`CaseFile` memo misses name changes** (#46): a mid-game rename (a bot takes over) shows old names until a new entry arrives.
- **Notes endpoint fetched twice** (#46): `useAwayRecap` and `useSuspicionBoard` each call `GET /games/:id/notes`.
- **#44 notes:** absent people in the people-majority denominator; the faint offline dot.
- **CI actions pinned to `@v4` tags, not SHAs** (#35): `ci.yml`, `sim-suite.yml`.
- Smaller: the hunch can outweigh a certain Peek; `live.hostile.qa.test.ts` has no `claimRole` row; server bots re-roll claim chances on every `decide()`; a slow test in `packages/bots/src/run.test.ts` needs an explicit timeout; the `viewFor` deep-copy speedup (35–40% of sim time) is left for the owner (#34).
- **Reveal:** the "stolen vote decided" flag needs tokens on, so it always reads false in Quick (starter mode) (#55).
- **Before M2-14:** check bot pace (bots react to every change they can see; an instant public reaction to something private is a mild tell); server-picked meeting slots must avoid quiet hours once they exist.

## Engineering notes (standing rules)
- **Engine:** handlers draw randomness only through the `Draw` that `handleCommand` passes them (`withRng` appends `rngAdvanced`); never read `state.rng`. New commands go in `HANDLERS` (`handle.ts`) and return a reason string to refuse; `applyEvent` throws on unfolded event types, so add cases in `reduce.ts`. Every ending goes through `gameEnded` (`end.ts`); every shakedown path through `afterVote` (`meeting.ts`); any new place that starts a round uses `startRound`. Read powers with `powerOf(config, role)`.
- **Views and leaks:** clients and bots get only `viewFor()` (a deep copy). A view's `seq` counts only what that player can see; never send a full-log index, `games.config` (has the seed) or `game_events.idx`. A new state field a view shows is added to `viewFor` by hand, and `view.leak.test.ts`'s scrub must hide it if private. `samples.ts` needs one sample per event and command type (the compiler enforces it). `secret` visibility never opens, even after the game; Ballot-perk views live only in `me.seenBallots`.
- **Server:** `command.player` always comes from the session. Run commands as `store.withGameLock(id, …load → handleCommand → append…)`. Deadlines go through `app.live.system` and the scheduler's `reconcile`; never write `deadlines` by hand. A new deadline kind gets one entry in `DEADLINE_RULES`. A view is pushed only when it changed and bots act only when their own view changed (no timing leaks); a Muscle shakedown window always runs its full length. A command's `{ ok }` reply goes out before its pushes, so tests reading views right after need a barrier. The server must stay one process (per-game lock, scheduler). Migrations are add-only (latest 008).
- **Chat:** stored and sent exactly as typed; render as text only (never `dangerouslySetInnerHTML` or markdown). Message ids are random UUIDs. The rate limit is in memory per process. Bots don't chat.
- **Database:** no `DATABASE_URL` = PGlite in `.pglite/` (`PGLITE_DIR=memory` for in-memory); tests share one PGlite per file; `pnpm test:pg` runs them on real Postgres.
- **Content:** numbers live in `packages/content`; tunables that should be overridable go in `ContentOverrides` and `validateOverrides`. After any rule, number or bot change, run the sim suite (or the "Sim suite" workflow) with `--compare docs/balance/baseline.json` (`docs/testing.md`).
- **Web:** frames use `<SketchFrame>` with a stable `seed`; new components go in `/dev/gallery`; e2e responsive specs cover 360–1280 px (add new screens to their route lists). A client route must not equal an API `GET` route (the server serves both on one origin).
- **Player ids** match `/^[A-Za-z0-9_-]{1,32}$/` and are never `__proto__`/`constructor`/`prototype`.

## Upcoming milestones
- **M3** — mobile apps (Flutter), push notifications, quiet hours.
- **M4** — more content (museum, casino, roles, events).

## Questions for the owner
Every provisional call still to confirm, once each; each is marked *provisional* in the named `docs/decisions.md` section (details of the older ones: `docs/archive/decisions-history.md`).
1. **Rules and roles, R6a readings** (#50): Balanced 5–6p deal; token triggers; automatic perks (Shield, Emergency) exempt from one-per-round; police moments on game time (refused during meetings, next due from the previous, Heat × min(1, crew ÷ 5), one per round in the sim); view readings; the legacy `mole` setting migrated; Exact list in content order; Hidden list falls back to the preset for bots; Mole and Embezzler in Duel; bot and sim tunables.
2. **Rules and roles, R6 confirm items:** the Blackmailer keeps its token if the shakedown is cancelled; the Mole tips off at most 3 times a game, even with Recharge.
3. **Balance gates** (#51): the split parity gate; ★ band 0.9–1.8×; ★ lean point 0.8 with content 0.17.0's numbers; Balanced 4p 1/1 and 8p 2/1; Team parity ≤ 0.20 until M2-14; Muscle bot threshold 2; Heat share and Starter/Duel success report-only.
4. **Rules and roles, police and gap-fills:** background police only when a Mole could be dealt; a tip-off lands at the next free police moment; a wrong Duel call-out pays 8; when a between-meetings stretch ends and how Recharge works; 1 h default session; Quick = Starter with no shop; Duel shop and events-off dealing; the Fixer stopping any raid; Forger 7+.
5. **Server and timing, host controls** (#54): players can act while paused; Extend amounts per preset, no cap; replace with bot after 2 missed rounds (never the host, Opportunist), handed back by host or player; lobby kick of any non-host seat.
6. **Server and timing, Google sign-in** (#53): the account's seat is kept on a same-game clash; redirect URI from env; display-name fallback (`name` → `given_name` → "Crook"); scopes `openid profile`; `prompt=select_account`.
7. **Web and UI** (#52, #55, #62): Extension UI readings and end-of-game reveal readings (Starter deck ≠ starter mode, Heat breakdown parts, reveal attribution of tip-offs, loops and stolen votes); the reveal-overflow regression coverage (pipeline and git).
8. **Older provisional readings** (1–2 Nov, M1 to M2-10; partly accepted 2 Nov): accept the rest in bulk, or name any to revisit.
9. **Resume:** when to restart development (M2-14, M2-15).
