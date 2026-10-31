# Decision log

Newest first. Each entry: what was decided, and why. Add an entry whenever a rule, number, or architecture choice changes.

---

### 2026-11-01 — Seeded RNG and setup (M1 task 2)
- **RNG algorithm: sfc32, seeded by hashing the seed string with cyrb128**, then 12 outputs discarded. Small, fast, 128-bit state, passes PractRand, and simple enough to write in-repo (no engine dependency). `RngState.words` is the four sfc32 words as unsigned 32-bit integers. A golden-value test pins the output, because changing the algorithm changes every old log's draws.
- **How RNG state is rebuilt on replay (deferred from PR #1):** `rngSeeded` sets the RNG from the seed, and any command that draws random numbers ends its events with a reveal-only **`rngAdvanced { words }`** carrying the RNG state after its draws. The fold just copies the words, so replay never re-draws and the fold never needs to know how many draws a rule makes. Being reveal-only, the state is in no player's view during the game (it would let them predict draws); after the game it is harmless, like the seed. Rejected: putting the state on the random-consuming events themselves (`roleDealt` is private and other draws may land on public events, so it would leak), and replaying from commands (breaks "state = fold over the log").
- **Rooms are not random:** they come straight from the player-count tiers in content (§6.2).
- **Role deal (provisional):** Moles first (by the Mole setting), then distinct roles drawn at random from the pool (each at most once), then Rookies for any seats left; the resulting deck is shuffled and dealt in seat order. So 4 players in starter mode get one of each starter role, and 12 get Lookout, Insider, Fence and nine Rookies. The Mole is never a pool role; it is controlled only by the Mole setting.
- **Mole count (provisional):** 2–4 players: never. 5–8: off 0, maybe 0 or 1 (50%), on 1. 9–12: off 0, maybe 1 or 2 (50/50), on 2. Design §8.1 says "1 or 2 Moles" at 9–12 without saying how the host setting maps onto it; the host's "off" is respected at every size. Numbers live in `MOLE_RULES` in content.
- **Starter mode requires `mole: "off"` and `eventsEnabled: false`.** `validateConfig` rejects any other combination instead of quietly ignoring it, so `gameCreated` and the config never claim a Mole or events that a starter game doesn't have (§8.1). (PR #2 review; PM call.)
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
