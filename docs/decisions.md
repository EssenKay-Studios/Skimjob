# Decision log

Newest first. Each entry: what was decided, and why. Add an entry whenever a rule, number, or architecture choice changes.

---

### 2026-11-01 — Core type choices
- **Each event type fixes its own visibility in the type system.** For example, `roleDealt` can only be private and `rngSeeded` can only be reveal-only, so a secret can't be logged as public by mistake. `voteCast` is public or private depending on the vote-visibility setting.
- **After the game ends, every event is visible to everyone** (`canSee`), which is what the reveal needs (§13).
- **A move's split is stored as `pocket`** (the amount kept), not the amount handed in. Real yields can change after submission (shared Deposit boxes, events), so `pocket` is capped at the actual yield, and "hand everything in" is simply `pocket: 0`. Design §5.1's rule is unchanged.
- **`GameConfig` holds only settings that change the rules.** Session length, deadlines, meeting window length, quiet hours, pause/extend and bot replacement belong to the server, because the engine has no clock.
- **The seed never appears in a public event.** `gameCreated` is public without the seed; the seed goes in a reveal-only `rngSeeded` event.
- **Only resting phases are modelled:** `setup`, `planning`, `awaitingMeeting`, `meeting`, `ended`. Resolving, Checkpoint and FinalCheck from §17.2 happen inside one `advance()` and leave only events behind.
- **Meeting time slots are opaque strings** that the engine stores but never reads as a time.

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
