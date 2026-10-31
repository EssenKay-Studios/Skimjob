# Decision log

Newest first. Each entry: what was decided, and why. Add an entry whenever a rule, number, or architecture choice changes.

---

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
