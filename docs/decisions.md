# Decision log

Newest first. Each entry: what was decided, and why. Add an entry whenever a rule, number, or architecture choice changes.

---

### 2026-11-01 — Meetings and votes (M1 task 6)
- **Meeting timing (PM decision, provisional):** a regular meeting opens only after the act's last round has resolved (rounds 1–3, the Act 1 meeting, checkpoint 1). Its slot can be proposed, accepted or server-picked at any time during the act; `advance { openMeeting }` for it is refused until the phase is `awaitingMeeting`, so the server re-sends it then. Emergency meetings can open mid-act; rounds pause (no moves, no round deadline) while any meeting is open, and closing one goes back to planning the same round with submitted moves kept (or back to awaiting the act's meeting). Only one meeting is open at a time; a second `openMeeting` is refused until the first closes.
- **Ids are built from public data only, never RNG draws or the log length** (the log length would let players count hidden events; PR #6 review). Regular meeting `act-<n>`; emergency `emergency-<player>` (unique, since one per player per game); proposal `proposal-<n>`, numbering the game's `meetingProposed` events from 1. Meetings draw no randomness.
- **Scheduling (provisional):** the proposer counts as accepting; a slot locks once more than half the crew has accepted, which emits `meetingScheduled` and drops the other proposals. A slot already proposed this act is refused. Once a slot is locked, `proposeMeeting`, `acceptMeeting` and `scheduleMeeting` are refused. `scheduleMeeting` must name the act being played.
- **Emergency meetings:** one per player per game, callable in planning or while the act's meeting is awaited, not while a meeting is open; only one may wait in its notice period at a time (the notice period is the server's). A pending emergency survives the act's meeting and opens in the next act. It can shake someone down (with the current act's numbers) but has no checkpoint.
- **Ballots (provisional):** skip, or shake down another player — not yourself, since a clean player could otherwise collect compensation by voting for themselves. A later ballot replaces the earlier one. Ballot visibility: `open` public, `hiddenThenRevealed` private (all ballots go public in `meetingClosed`), `secret` `secretTo()` with `meetingClosed.ballots: null`. `voteSealed` is private, or secret in Secret mode.
- **Sealed votes (provisional, answers the PR #1 review):** a sealed vote has no meeting scope; it counts in the next meeting that opens, regular or emergency, and is used up. It is cast as a `voteCast { sealed: true }` right after `meetingOpened`, so in Open mode it is public from the start of the window, and a present player overrides it with a live vote. Sealing again replaces it; it can't be withdrawn (to abstain, turn up, or let it be used).
- **Tally:** quorum is ballots × 2 ≥ crew size; a shakedown needs target votes × 2 > ballots cast; otherwise `skipped` if skips × 2 > ballots, else `noMajority`. Every ballot weighs 1 (Smooth talker later). Tally and ballots are in seat order.
- **Shakedown:** the stash (never the safe) is revealed and taken; below `cleanBelowPerAct` × act it's clean and the target is paid `compensationPerAct` × act. The numbers are `JobDef.shakedown` (3 and 5) so simulator content overrides can tune them with the other job numbers. **Compensation is capped by the Haul (provisional)**, so the Haul never goes negative.
- **Checkpoint (§11.4):** `closeMeeting` of a regular meeting emits `meetingClosed` → `shakedownResolved`? → `checkpointChecked` → then `copsRaided` + `gameEnded` if the missed-checkpoint +15 takes Heat to 100 (clamped once; `heatPenalty` is the change after clamping), else `roundStarted` for the next act, or after Act 3 (no Heat penalty) `gameEnded` success / failed `target`. Ranking and winners stay empty until task 7.
- **No resume point in `MeetingState`** (`resumeRound` removed): the phase after a meeting follows from `round` and `resolvedRound`. **Commands are refused in the `setup` phase.**

### 2026-11-01 — Alibis (M1 task 5)
- **`postAlibi { player, room }` posts a public `alibiPosted { player, round, room }`** for the latest resolved round (`GameState.resolvedRound`). One per player per round; it can't be changed or withdrawn. Refused before round 1 resolves.
- **Alibi window (provisional):** from a round's resolution until the next round resolves, in any phase (planning, awaiting the meeting, meeting). So round 2's planning is also the time to post round 1's alibi.
- **An alibi must name a room in play (provisional).** It can be a lie, but not about a room that doesn't exist in this game (structured data, §5.4).
- **The round deadline names its round:** `advance { deadline: { kind: "round", round } }` is refused unless `round` is the round being planned, so a retried or late deadline can't resolve the next round early (task 4 review). A retry is a harmless rejection.

### 2026-11-01 — Round loop (M1 task 4)
- **`handleCommand(state, command)` is the one entry point** for commands. It returns `{ ok: true, state, events }` or `{ ok: false, reason }`. Commands arrive as untrusted JSON, so any bad input is a rejection that leaves state untouched, never a throw: wrong phase, unknown player, room not in play, a split that isn't a whole number from 0 to the room's loot (NaN, fractions, strings, Infinity), Security without a watched room, a watch from outside Security, an ability the role doesn't have. The stored move is normalised (unknown fields dropped).
- **`rngAdvanced` is automatic.** Handlers draw only through the `Draw` they're given; `withRng` appends `rngAdvanced` after their events if anything was drawn, and discards the draws on a rejection. The round loop itself draws nothing.
- **Setup opens round 1.** `setupEvents` now emits `roundStarted { round: 1 }` (before the final `rngAdvanced`), so `createGame` returns a game in planning. No separate "start" command.
- **The default room is content** (`JobDef.defaultRoom`, `"lobby"` for the bank), since other jobs may not have a Lobby. **Rounds per act** is `ROUNDS_PER_ACT` (3) in content.
- **Split bounds:** a move's `pocket` may be 0 to the room's listed loot when submitted, and is capped at the real yield when the round resolves (crowded Deposit boxes pay 3). The Insider's move is refused if `pocket > 0`, and resolution treats the Insider's pocket as 0 regardless.
- **Lookout:** the ability is `{ kind: "lookout", rooms }`, 1 to `extraRooms` distinct rooms in play (content says 1). This replaces the single-room shape, so the content field means something. It's optional each round, and can name any room in play.
- **Watch results leave out the watcher.** Security and Lookout results (`roomWatched.seen`), like room sightings, list the *other* players in the room.
- **Fence safe (provisional):** the deposit happens after this round's split, from the stash including this round's pocket. The submitted amount must be 1 to what's left of the per-act cap (5); the amount actually moved is also capped by the stash, and `abilityResolved` reports the amount that moved. The allowance resets at the first round of each act.
- **Heat:** baseline + room pressure is rounded, added, then clamped to 0–100 once (`roundResolved.heatDelta` is the change after clamping, so Rooftop at Heat 0 shows 0). Events and the missed-checkpoint penalty must join that single clamp when they land. Heat at 100 emits `copsRaided` then `gameEnded { failed, heat }`; the ranking is left empty until task 7.
- **Acts:** after an act's last round the phase becomes `awaitingMeeting { act }` (also after round 9, for the final meeting); task 6 starts the next act. Server-room `pocketCount` counts players who kept anything this round.
- **Player-keyed scratch data uses `Map`**, because player ids are host-chosen strings (a seat called `__proto__` works).

### 2026-11-01 — Bank job content (M1 task 3)
- **Content shape:** `RoomDef` (`loot`, `heatPressure`, optional `capacity`, `info`: none / watchRoom / pocketCount), `RoleDef` (`power`, `canPocket`, `scoring`), and `JobDef` (room tiers, room defs, `heat`, `checkpoints`) in `packages/content`. The room tiers moved from `setup.ts` into `BANK_JOB` in `jobs.ts`, so there is one room list. Heat and checkpoint numbers live on the job, because jobs may change them (Casino baseline +5, §9).
- **A room's Heat is one number, `heatPressure`, applied as pressure × (visitors ÷ crew size).** Vault 20, Manager's office 10, Rooftop −20, others 0 (§7). The engine sums pressure × visitors and divides by crew size once, so equal crew shares give exactly equal Heat at any size.
- **Heat rounding (provisional):** each round's baseline-plus-rooms change is rounded to a whole number with `Math.round` (halves up, i.e. towards more Heat). Keeps Heat, the ledger and the 100 check in whole numbers; the §7 sanity check (quarter of the crew in the Vault → 81) is exact.
- **Heat floor (provisional):** Heat is clamped to 0–100 (`clampHeat`). §7 says Heat "runs from 0 to 100"; the floor means Rooftop turns can't be banked below zero.
- **Role powers are data, scoring is data:** Rookie `stashMultiplier` 1.2; Insider `canPocket: false` and `perLootOverFinalTarget` 1; Lookout `extraRooms` 1; Fence `fenceSafe.perAct` 5. `RolePower.kind` matches the engine's `AbilityUse.kind`. Applying them is tasks 4 and 7.
- **Engine helpers take a `JobDef`**, not a job id (`roomsInPlay`, `roomDef`, `roomLoot`, `roundHeatDelta`, `clampHeat`, `checkpointTarget`); only `jobById` and `validateConfig`'s job check read the `JOBS` table. The §17.4 content-override field on `GameConfig` is left to task 10: it only has to change what the engine looks up, plus validate the override (configs are untrusted JSON, so that part isn't free).

### 2026-11-01 — Seeded RNG and setup (M1 task 2)
- **RNG algorithm: sfc32, seeded by hashing the seed string with cyrb128**, then 12 outputs discarded. Small, fast, 128-bit state, passes PractRand, and simple enough to write in-repo (no engine dependency). `RngState.words` is the four sfc32 words as unsigned 32-bit integers. A golden-value test pins the output, because changing the algorithm changes every old log's draws.
- **How RNG state is rebuilt on replay (deferred from PR #1):** `rngSeeded` sets the RNG from the seed, and any command that draws random numbers ends its events with a reveal-only **`rngAdvanced { words }`** carrying the RNG state after its draws. The fold just copies the words, so replay never re-draws and the fold never needs to know how many draws a rule makes. Being reveal-only, the state is in no player's view during the game (it would let them predict draws); after the game it is harmless, like the seed. Rejected: putting the state on the random-consuming events themselves (`roleDealt` is private and other draws may land on public events, so it would leak), and replaying from commands (breaks "state = fold over the log").
- **Rooms are not random:** they come straight from the player-count tiers in content (§6.2).
- **Role deal (provisional):** Moles first (by the Mole setting), then distinct roles drawn at random from the pool (each at most once), then Rookies for any seats left; the resulting deck is shuffled and dealt in seat order. So 4 players in starter mode get one of each starter role, and 12 get Lookout, Insider, Fence and nine Rookies. The Mole is never a pool role; it is controlled only by the Mole setting.
- **Mole count (provisional):** 2–4 players: never. 5–8: off 0, maybe 0 or 1 (50%), on 1. 9–12: off 0, maybe 1 or 2 (50/50), on 2. Design §8.1 says "1 or 2 Moles" at 9–12 without saying how the host setting maps onto it; the host's "off" is respected at every size. Numbers live in `MOLE_RULES` in content.
- **Starter mode requires `mole: "off"` and `eventsEnabled: false`.** `validateConfig` rejects any other combination instead of quietly ignoring it, so `gameCreated` and the config never claim a Mole or events that a starter game doesn't have (§8.1). (PR #2 review; PM call.)
- **`validateConfig(config: unknown)` returns a list of errors** (empty = valid) instead of throwing, and checks the shape as well as the rules: enum values (`mole`, `voteVisibility`) by membership, `job` by own key only (`Object.hasOwn`), booleans and strings by `typeof`. The M2 server will receive configs as untrusted JSON. `setupEvents` throws with all the errors joined. No schema library. (PR #2 QA; PM call.)
- **Host role pool:** empty means the content default (only the starter roles exist so far). Duplicates, unknown roles and the Mole are rejected. Starter mode ignores the pool.

### 2026-11-01 — Owner decisions for M2 (from Karthik)
- Scope tonight: finish M1, then build M2 **running locally** (no deployment until hosting accounts exist).
- Login: **invite link + nickname** for quick joins, plus **Google sign-in** for a persistent identity.
- Backend: **Node server + Postgres**.
- Art: agents draw the cartoon art as **SVG**, in a hand-drawn notebook style modelled on cityrt.com (style only — never their logo, name or artwork). Style guide: `docs/ui-style.md`.

### 2026-11-01 — Core type choices
- **Each event type fixes its own visibility in the type system.** For example, `roleDealt` can only be private and `rngSeeded` can only be reveal-only, so a secret can't be logged as public by mistake. `voteCast` is public, private or secret depending on the vote-visibility setting; `voteSealed` is private or secret.
- **After the game ends, private and reveal-only events become visible to everyone** (`canSee`), which is what the reveal needs (§13). **Secret events never do.** A fourth visibility kind, `secret` (`secretTo(player)`), is visible only to its player, during and after the game. It is used only for ballots (`voteCast`, `voteSealed`) in *Secret* vote mode, so "only the tally is ever shown" (§11.2) holds at the reveal too. A future Informant role would be granted these explicitly by `viewFor()`, not by `canSee()`. `PlayerView.reveal.log` is therefore a filtered list of `{ seq, event }`, not the raw log. Unknown visibility kinds fail closed, before and after the game. (QA finding on PR #1; PM decision.)
- **A move's split is stored as `pocket`** (the amount kept), not the amount handed in. Real yields can change after submission (shared Deposit boxes, events), so `pocket` is capped at the actual yield, and "hand everything in" is simply `pocket: 0`. Design §5.1's rule is unchanged.
- **`GameConfig` holds only settings that change the rules.** Session length, deadlines, meeting window length, quiet hours, pause/extend and bot replacement belong to the server, because the engine has no clock.
- **The seed never appears in a public event.** `gameCreated` is public without the seed; the seed goes in a reveal-only `rngSeeded` event.
- **Only resting phases are modelled:** `setup`, `planning`, `awaitingMeeting`, `meeting`, `ended`. Resolving, Checkpoint and FinalCheck from §17.2 happen inside one `advance()` and leave only events behind. A meeting that is scheduled or called but not yet open is **not** a phase, because it can coexist with planning: it lives in `GameState.scheduledMeeting` (regular) or `pendingEmergency` (in its notice period, §11.1). Both carry a `meetingId`.
- **`advance` names the deadline that passed:** `round`, `openMeeting { meetingId }` or `closeMeeting { meetingId }`. During planning the round deadline and an emergency notice period can both be pending, and the engine has no clock to tell them apart. The engine rejects a deadline that isn't pending.
- **The server picks a regular meeting slot with a `scheduleMeeting { act, slot }` system command** when nobody locked one in by the act deadline (§11.1). It emits `meetingScheduled` with `proposalId: null`.
- **Meeting time slots are opaque strings** that the engine stores and compares only for equality, never reads as a time.
- **Views carry log positions:** `ledger` and `caseFile` entries are `{ seq, event }`, where `seq` is the index in the full log, for "since seq N" recaps (§13) and evidence cards (§12.1).
- **`meetingClosed.tally` is `{ skip, targets }`**, so no player id can collide with "skip".
- **A ranking's `stash` includes the Fence safe** (the safe protects loot from shakedowns; it is still the Fence's loot).

### 2026-10-31 — Game name is Skimjob
Replaces the working title "Heist Crew".

### 2026-10-31 — One monorepo
Engine, content, bots, simulator, server and clients live in one pnpm monorepo so rule changes and their callers land together and types are shared.

### 2026-10-31 — Engine is a pure, deterministic, event-sourced TypeScript package
Same package runs in browser, React Native and Node. Seeded RNG, no clock, content as data, visibility-scoped events, `viewFor()` projection. Enables replays, reveal, recaps, bots that can't cheat, and mass simulation.

### 2026-10-31 — Bots use the same interface as humans
Bots receive only `viewFor()` and emit normal commands. Needed for fair bot seats and meaningful simulation.

### 2026-10-31 — Discussion is the core; it can happen anywhere
In-app crew chat + DMs (others see *that* a DM happened), plus players freely using WhatsApp/in person. Verified evidence cards keep facts trustworthy.

### 2026-10-31 — Votes are group-scheduled live windows
Any player proposes a time, majority accepts; one regular meeting per act (auto-scheduled if none), one emergency meeting per player per game. Rounds pause during windows. Sealed votes for absentees.

### 2026-10-31 — Vote visibility default: hidden while voting, revealed after
Prevents bandwagoning while giving the group evidence to argue about. Host can switch to open or secret.

### 2026-10-31 — No player elimination
Getting caught costs loot (shakedown), never your seat — essential for week-long games.

### 2026-10-31 — Final meeting happens before the final target check
Stops a last-round grab-everything; the crew can rescue a failing heist by shaking down the greediest player.

### 2026-10-31 — Revealing your role is risky by design
Every role has a weakness once known; players can bluff role claims; shakedowns reveal stash, not role.

### 2026-10-31 — Visual direction: cartoon building cutaway (Option A)
Detailed UI design deferred.
