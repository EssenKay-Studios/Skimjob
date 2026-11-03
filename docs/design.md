# Skimjob — Game Design Document

*Version 0.2 — 3 Nov 2026: the canonical rules are now **roles v3 as amended by the Extension** (approved 3 Nov; [`roles-v3.md`](roles-v3.md), [`extension.md`](extension.md); the Extension wins on any conflict). This is the spec for R6a (rules, content, bots) and R6b (UI), **not yet built**: `main` still plays the R5 rules (content 0.14.0). Numbers in [brackets] and those called starting values are tuned by the balance pass. The Rebuild ([`rebuild.md`](rebuild.md)), Books mode and a recruited Mole are not approved and out of scope. Version 0.1 was 31 Oct 2026; balance passes 1–3 are in `docs/balance/`.*

---

## 1. Overview

**Pitch:** *Steal from your crew — just don't sink the job.*

Skimjob is a social deduction game for groups of friends, played in a browser or on an Android/iOS app. A crew robs one bank together over a session the host sets, anywhere from an hour to a week. Every round each player secretly picks a room to loot and decides how much to hand to the crew and how much to pocket. The player with the biggest stash at the end wins, **but if the heist fails, nobody wins.**

**Players:** 2–12 humans, with bots available to fill seats. The ideal range is 4–8.
**Session length:** set by the host, from 1 hour to 7 days. The rules stay the same at every length; only the pace changes.
**Platforms:** web, Android and iOS, all on one shared game server. A player can switch devices mid-game.

### 1.1 Design pillars

1. **One simple core choice.** Each round is a single decision: pick a room, then split the loot. Anyone can learn it in a minute.
2. **Depth comes from layers.** Roles, jobs and events add the complexity, and each one is explained on its own card when it shows up. New players only need to learn their own card.
3. **Discussion is the game.** The app supplies the facts. The arguing happens in the in-app chat, in WhatsApp, or in person.
4. **Async-first.** A week-long game should need about 15 minutes a day. The only moments when everyone needs to be online together are the scheduled votes.
5. **Nobody sits out.** No player is ever eliminated. Getting caught costs you loot, not your seat.
6. **A big reveal at the end.** Every game ends with a full replay showing who did what.

---

## 2. Core concepts

| Term | Meaning |
|---|---|
| **Loot** | Points collected from a room each round. |
| **Haul** | The crew's shared pot. Everyone can see the total, but not who put in what. |
| **Stash** | A player's private pocket. Only they can see it until a shakedown or the end of the game. |
| **Heat** | A shared danger meter from 0 to 100. If it reaches 100, the cops raid and the heist fails immediately. |
| **Round** | One shift inside the bank. There are 9 rounds per game. |
| **Meeting** | The crew meets after rounds 3, 6 and 9 to vote and check the Haul target. (Players never see "act"; "once between meetings" powers recharge at these meetings.) |
| **Haul target** | A minimum the Haul has to reach by each regular meeting (the old "checkpoint"). |
| **Shakedown** | The result of a successful vote: the target's stash (and any Fence safe) is revealed, and the stash is taken into the Haul. |
| **Alibi** | A formal, logged claim of which room you were in. It can be a lie. |
| **Token** | A private reward a role earns; tokens buy perks from the game's shop of three (§8.3). |
| **Case file** | A player's private log of everything they personally saw. |
| **Ledger** | The public log of everything everyone can see. |

---

## 3. Winning and losing

*Roles v3 §1 as amended by the Extension (approved 3 Nov 2026; R6a builds it). There are no sides: everyone is one crew, and at most one player wins (or a shared tie), never a team.*

- **Score** = stash, plus the Fence safe, plus the Inside Man's bonus (+1 per [5] loot the Haul ends above the final target, rounded down). **Whole numbers only**: no multipliers and no decimals (the Rookie's ×1.05 and one-decimal rounding are gone).
- **Ranking:** every player by score, then the tie-breaks: fewer times shaken down, then more total loot handed in (tracked by the engine, revealed only at the end). The **top group** is everyone still level after both; they share the win.
- **The heist succeeds** if, after the final meeting, the Haul is at or above the final target and Heat is below 100. The top group wins, whatever their roles (Mole and Embezzler included).
- **The heist fails** if Heat reaches 100 at any point, or the final target is missed. Nobody wins, **except** a top-group member whose role wins that ending:

| How the game ends | Who wins |
|---|---|
| Final target met and Heat below 100 | The biggest stash |
| Cops raid (Heat 100) | Nobody, unless the Getaway Driver, Mole or Fence has the biggest stash |
| Final target missed | Nobody, unless the Embezzler, Mole or Fence has the biggest stash |

- A failure-winner outside the top group doesn't win, even if it beats every other failure-winner; if no top-group member qualifies, nobody wins.
- **A failed heist still shows the whole ranking**, labelled as a loss unless someone qualified.
- Roles are read as they are at the end of the game, so a Double-cross (§10) can hand over a failure win.
- Every role card carries one "How you win" line (roles-v3.md §1), so nobody has to look this table up.

---

## 4. Game structure

```
Setup → R1 R2 R3 → Meeting 1 (vote → shakedown → Haul target check)
      → R4 R5 R6 → Meeting 2 (vote → shakedown → Haul target check)
      → R7 R8 R9 → Final meeting (vote → shakedown → final check)
      → Reveal and replay
```

There are **no acts in player language** (Extension, approved 3 Nov): the crew simply meets after rounds 3, 6 and 9. Powers limited to "once between meetings" recharge only at these regular meetings, never at an emergency meeting (owner, 3 Nov). The engine may keep numbering the three stretches internally; players never see "act".

**Stretches (provisional PM definition, 3 Nov):** a "between meetings" stretch runs from the close of one regular meeting to the close of the next (stretch 1 runs from the deal to the close of meeting 1). Its uses recharge **when its regular meeting closes**, after the vote, any shakedown and the Haul target check. So a power used during meeting 1 (Detective, Mole, Auditor) spends stretch 1's charge, and the fresh charge is available from round 4's planning. Emergency meetings never close a stretch (owner ruling 2). The engine counts stretches by regular-meeting closes, not by `actOfRound`. In Duel a stretch closes when round 3's or round 6's call-outs and target check settle (owner ruling 7). Role claims, the Fence's safe allowance and Duel call-outs use the same stretches. **Recharge** (perk) restores one used-up use of the current stretch, or a once-per-game use. It is refused if nothing is used up. A restored use that isn't spent by the stretch's close adds nothing, because the normal recharge covers it.

| Rounds | Feel |
|---|---|
| 1–3 | Casing the joint. Trust is high and skims are small. Not much information yet. |
| 4–6 | The job. The first shortfalls appear, and with them accusations, alibis and alliances. |
| 7–9 | The getaway. Everyone can see the maths. Greed, Heat and suspicion all peak. |

### 4.1 Elastic timing

The engine doesn't know about real time. A scheduler on the server spreads the host's chosen duration across the 9 rounds and the meeting windows.

| Session length | Round length (about) | Meetings |
|---|---|---|
| 1 hour | 5–6 min | Auto-scheduled, 3-minute windows |
| 3 hours | ~18 min | Auto-scheduled, 5-minute windows |
| 1 day | ~2.5 h | Group-scheduled, 5–15 minute windows |
| 3 days | ~8 h | Group-scheduled, 10–30 minute windows |
| 1 week | ~18 h | Group-scheduled, 10–30 minute windows |

- In sessions shorter than 3 hours, meetings are always auto-scheduled.
- **Quick (15 min)** (45 s rounds, a playtest preset, not the default; the default is 1 hour) forces the **Starter deck**, with events off and no tokens or shop (Extension; provisional details in §8.1).
- Rounds are **paused** while a vote window is open, so nothing resolves in the middle of a vote.
- **Rounds end early once the whole crew has locked in** (owner decision, 2 Nov): the round resolves a short grace period after the last lock-in, or at its deadline if that comes first, so the last player can still change their move. Changing a move during the grace doesn't restart it. *Grace (provisional, `timing.ts`, scaled by TIME_SCALE):* Quick 5 s, 1 hour 10 s, 3 hours 30 s, 1 day 2 min, 3 days and 1 week 5 min. Alibi windows, meeting windows, emergency notices and the Muscle's window always run their full length.
- The host can set "quiet hours", such as midnight to 7am, during which rounds don't resolve and no notifications are sent.

---

## 5. A round in detail

### 5.1 Planning (simultaneous and secret)

Every player submits a **move**:
1. **Room**: where they go this round.
2. **Split**: how much of that room's loot goes to the Haul. The rest goes to their stash.
3. **Ability** (optional): a role power, if their role has one.

Moves can be changed until the round deadline. If a player misses the deadline, they get a **default move**: Lobby, hand everything in.

**Lock-ins are public** (owner decision, 2 Nov): everyone sees which players have locked in a move this round (a mark on their seat, and a `moveLocked` line in the ledger), never the room, split or ability. Only the first move of a round counts as locking in; changing it afterwards shows nothing new. Bots lock in like anyone. A default move never shows as locked in.

**Presence is public** (owner decision, 2 Nov): each person's seat shows whether they are online now or when they were last seen. It comes from the server (who has the game open), never from the game log. Bots show as bots, never as online.

### 5.2 Resolution order

1. Event card effects apply (see §10).
2. Room yields and capacity rules are worked out.
3. Splits are applied: the Haul increases, and stashes increase.
4. Heat changes are applied.
5. Information goes out:
   - Each player learns **who else was in their room**.
   - Security, Lookout and other information results go to the players they belong to.
   - The ledger posts the **round summary**: Haul change, Heat, and any public event results.
6. If Heat ≥ 100, the cops raid and the game ends.

### 5.3 How the deduction works

Room yields are public, so the crew can compare what the Haul *should* have grown by with what it actually grew by.

> Four alibis are posted: Vault (6), Office (4), Lobby (2), Lobby (2). Those add up to 14. The Haul grew by 9, so **5 is missing.** Either someone pocketed loot, or someone's alibi is a lie that covers a bigger skim.

The strongest cheating move is to loot the Vault, pocket the difference, and claim the Lobby. It's only safe if nobody else was in the Vault, and nobody checked the Vault cameras.

### 5.4 Alibis

- After a round resolves, each player can post one **Alibi** ("I was in the Office") to the ledger.
- Alibis are posted **before the next round's planning**: a short alibi window follows every round. When its deadline passes (the server times it), the round's alibis close and the next round starts; after round 3, 6 or 9, the regular meeting comes next. An emergency meeting may interrupt the window, which then resumes. *(Owner answers, 1 Nov.)*
- Alibis are optional and can be lies. Posting none is suspicious in itself.
- Alibis are structured data, so both bots and the auto-recap can reason about them.

---

## 6. Rooms (default job: First National Bank)

### 6.1 Core rooms (all player counts)

| Room | Loot | Effect |
|---|---|---|
| **Vault** | 6 | Adds vault pressure to Heat (see §7) |
| **Office** | 4 | — |
| **Lobby** | 2 | — |
| **Security** | 0 | Pick one room and see everyone who was in it this round |
| **Rooftop** | 0 | Removes Heat (laying low) |

### 6.2 Extra rooms for bigger crews

More rooms keep the number of people per room, and so the number of witnesses, roughly steady as the crew grows.

| Players | Rooms added |
|---|---|
| 2–4 | Core only (5 rooms) |
| 5–8 | **Deposit boxes**: 5 loot, holds 2 people (if more than 2 go, everyone there gets 4; R5, was 3), adds half the vault pressure. **Server room**: 0 loot, learn *how many* players pocketed loot this round, but not who. |
| 9–12 | Everything above, plus **Teller line**: 4 loot. **Manager's office**: 4 loot, adds half the vault pressure. *(1 Nov: were 4 and 5; R5 put the Teller line back to 4 — see decisions.md and balance-3.md.)* |

---

## 7. Heat

Heat runs from 0 to 100. If it reaches 100, the cops raid and the heist fails.

| Source | Change |
|---|---|
| Each round (baseline) | +4 |
| Vault pressure | +20 × (Vault visitors ÷ crew size) |
| Deposit boxes | +10 × (visitors ÷ crew size) |
| Manager's office | +10 × (visitors ÷ crew size) |
| Rooftop | −20 × (Rooftop visitors ÷ crew size) |
| Haul target missed at meeting 1 or 2 | +15 |
| **Police activity** (the Mole's tip-off, or the hidden background patrol) | +4 [starting value] each; the two are announced identically (§8, §10) |
| Other event cards | Varies (event Heat × min(1, crew ÷ 5) for crews of 2–4, §10) |

Scaling by fractions of the crew means a crew of 12 and a crew of 3 feel the same pressure when the same *share* of players goes to the Vault.

Each round's room-and-baseline Heat change is rounded to a whole number (halves round up), and Heat never drops below 0, so time on the Rooftop can't be banked ahead.

**Heat breakdown** (Extension; R6a engine, R6b UI): every round's public summary lists its Heat parts, e.g. "+4 every round, +10 Vault, −5 Rooftop, +4 police activity". Each room's line is the Heat it actually caused (so a Getaway Driver's or Cleaner's Rooftop visit is folded into the Rooftop line, and a claimed Rooftop visit that cooled nothing still shows only in the maths). Tip-offs and patrols share the one "police activity" label and never name a cause. *Rounding (provisional):* each line is rounded on its own (halves up), and the round's room-and-baseline change is the sum of its rounded lines, so the breakdown always adds up. A round's police activity can land after the summary is posted; it is then added as an extra line (§10).

*Sanity check (placeholder numbers):* the baseline alone adds 36 over 9 rounds. With a quarter of the crew in the Vault every round, total Heat is about 81, which is risky but survivable. With half the crew in the Vault, Heat goes bust unless people spend turns on the Rooftop.

---

## 8. Roles

*Roles v3 as amended by the Extension (approved 3 Nov 2026; `docs/roles-v3.md`, `docs/extension.md`). The spec for R6a/R6b, not yet built: `main` still plays the R5 roles (factions, per-role perk rewards, ally reveals). Numbers in [brackets] are starting values, tuned by the balance pass.*

Every player is dealt **one secret role** at the start of the game. Roles are designed so that **revealing your role is risky**: each one has a weakness once people know about it. Players can claim any role, truthfully or as a bluff. A formal claim (the **Claim** button, §12.1) goes on the public ledger: once per player **between meetings**, any role the game knows (even one that can't be in this game, so a refusal never hints at the hidden role pool), never in Duel mode. Like an alibi it changes no rule; it is evidence the crew weighs.

**Tags, not teams.** Each card carries a **temperament tag** that describes how selfish its power is and changes no rule: **Team player**, **Wildcard** or **Lone wolf**. The tag replaces the old factions (crew / accomplice / saboteur); there are no sides, no allies and no automatic reveals (§8.2). ★ marks the four roles that can also win a failed heist (§3).

**Every reward is one token** (spent in the shop, §8.3). "Caught" means shaken down and **not clean** (§11.3). **"Once between meetings"** powers recharge at the regular meetings after rounds 3, 6 and 9 only, never at an emergency meeting (owner, 3 Nov).

**Team players**

| Role | Power | Earns a token when | Weakness if revealed |
|---|---|---|---|
| **Rookie** | No power. No score multiplier. | The Haul target is met at meeting 1 or 2. | Seen as an easy target to pin blame on. |
| **Inside Man** *(5+)* | Can't pocket loot. Scores +1 per [5] loot the Haul ends above the final target (rounded down). | The Haul target is met at meeting 1 or 2. | Others pocket more, knowing the Inside Man will cover the Haul. |
| **Lookout** | Each round, also sees who was in one extra room. | Someone it saw is caught. | People lie around it more carefully, or try to frame it. |
| **Auditor** | Once between meetings: learns the latest resolved round's shortfall for one room (what its visitors pocketed). | A visitor of that room, that round, is caught. | Liars shake it down to discredit it. |
| **Detective** *(4+, not in Duel)* | Once between meetings: learns whether one player's stash (plus any safe) is **"dirty": [6] or more** right now. The same number as the clean line, tuned with it (owner, 3 Nov). | A player it checked is caught. | Cheaters shake it down first. |
| **Snitch** *(4+, not in Duel)* | Secretly assigned a target (drawn at random from the other players at setup). | Its target is caught (each time). | Its target has a reason to frame it. |
| **Smooth Talker** *(5+, not in Duel)* | Its vote counts double (toward the majority only). | It voted for a player who is caught. | Others coordinate their votes against it. |
| **Muscle** *(5+, not in Duel)* | Once per game: cancel a shakedown after the vote passes. | It saved an innocent (clean) player: a token **and** its power back (owner, 3 Nov). Saving a cheater names it in the ledger. | Everyone knows a vote against its friends may get blocked. |
| **Priest** *(5+, not in Duel)* | Once between meetings: bless another player; if they're shaken down clean before the next regular meeting closes, the bank pays the [8], not the Haul. | A blessing pays out. | Its flock becomes a free target. |
| **Bagman** | Each round it hands in everything (from a room that pays), the bank adds +1 to the Haul, hidden in the round's Haul change. | It hands in everything 3 rounds running. | The +1 shows in the Haul maths, so others hide skims behind it. |
| **Cleaner** | Its Rooftop visit counts as 2 visitors for Heat. | Every 2nd Rooftop round. | A Rooftop alibi is its easy cover; nobody believes it. |
| **Fixer** | Once per game, automatically: any raid, at any moment, stops with Heat at 95, and the Fixer loses ¼ of its stash (rounded, halves up). | That happens. | The crew gets reckless with Heat. |
| **Mastermind** *(events on only)* | Privately sees each next event card as a round starts (round 2's at setup). Police activity isn't a card, so it doesn't see that coming. | The Haul target is met at meeting 1 or 2. | Blamed for every bad card. |

**Wildcards**

| Role | Power | Earns a token when | Also wins | Weakness if revealed |
|---|---|---|---|---|
| **Getaway Driver** ★ | Its Rooftop visit cools no Heat (`reverse` 0, R5), so a claimed Rooftop visit doesn't add up in the Heat breakdown. | Heat reaches 75 after a round (once per game). | A raid, with the biggest stash. | Rooftop claims that don't cool Heat give it away. |
| **Fence** ★ | Hides up to [5] loot between meetings in a safe that shakedowns **show but can't take**. | The safe reaches 10 (once per game). | Any failure, with the biggest stash (safe counts). | A big shown safe makes it the next target. |
| **Hacker** | Once between meetings: loops one room's cameras; Security's feed of that room reads **"camera offline"**. | Its loop hid a player who pocketed that round from a Security watcher. | — | Every "camera offline" looks like its doing (or a power cut). |
| **Blackmailer** *(7+, not in Duel)* | Once between meetings: guesses one player's role; if right, it **steals that player's vote** at the next meeting (the victim is told only "your vote is compromised"). | A vote it stole decides a shakedown (owner, 3 Nov). | — | Players hide their roles; victims out it. |
| **Forger** *(7+, not in Duel)* | Once between meetings: plants a **fake sighting** (player X in room R) on that round's watch feeds of R. | Someone it framed is shaken down clean. | — | A proven forgery gets it hunted. |

**Lone wolves**

| Role | Power | Earns a token when | Also wins | Weakness if revealed |
|---|---|---|---|---|
| **Mole** ★ | Once between meetings, **any time**: tips off the cops for +[4] Heat, a public event announced only as **"police activity"**, the same announcement as the background patrol (§10). At most 3 per game. | Each tip-off (owner, 3 Nov). | Any failure, with the biggest stash. | Revealed means hunted. |
| **Embezzler** ★ | Once between meetings: moves up to [1] of the round's handed-in loot from the Haul to its stash after the splits, hidden in the round's Haul change. While it holds a take, a shakedown always catches it. | Its first take. | A missed target, with the biggest stash. | Its stash is always dirty while holding a take. |

**Minimum crew sizes:** Snitch and Detective 4+; Inside Man, Smooth Talker, Muscle and Priest 5+; Blackmailer and Forger 7+. **Not in Duel:** roles that need meetings (Smooth Talker, Muscle, Priest, Snitch, Detective, Blackmailer, Forger).

*Role details (R1–R5 builds, kept where roles v3 doesn't change them; provisional unless noted):*
- **Tokens:** earning one is a private event (only you are told); your own token count shows in your view, nobody else's. Tokens are granted right after the triggering shakedown (Lookout, Auditor, Detective, Snitch, Smooth Talker, Forger), at the meeting's target check (Rookie, Inside Man, Mastermind; the final check grants nothing, the game is over), or as the triggering round resolves. "Saw", "audited", "checked" and "framed" count anything earlier in the game by that player, and nobody earns from their own shakedown. Tokens stay with the player in a Double-cross (they were earned, not dealt); role uses travel with the card.
- **Auditor:** used any time after round 1 resolves; it audits the latest resolved round (so it can follow up an alibi), not the same round twice. A Power cut doesn't stop it (it reads the books, not the cameras).
- **Detective:** used any time; can't check a player whose shakedown is pending. The Fence safe counts, as in the clean check.
- **Smooth Talker:** the double vote counts toward the majority (§11.2), not toward quorum, which counts voters. The public tally counts one per ballot, so only a result the plain count can't explain shows it. A sealed vote counts double too. "Voted for" means its last ballot in that meeting.
- **Muscle:** when a vote passes a shakedown, a short **shakedown window** opens before it is applied (§11.3). The Muscle can cancel it then, including a shakedown of itself (saving itself earns nothing). The cancel stays private until the window ends; the ledger then says the shakedown was cancelled, and names the Muscle only if the target wasn't clean (public `muscleNamed`). Clean is the clean check at the window's end.
- **Priest:** blesses another player whose shakedown isn't already pending. A clean shakedown pays the usual [8], then public `blessingPaid` puts it back into the Haul (the bank paid); it doesn't say who blessed. If a player it blessed is caught, it can't bless again until after the next regular meeting.
- **Bagman:** the +1 needs a room with loot (the Rooftop doesn't count) and comes with a private note to the Bagman.
- **Cleaner:** counts only in the Rooftop's Heat pressure.
- **Fixer:** stops **any** raid, whenever Heat would reach 100: at a round's resolution, from a missed target's +15, or from police activity at any moment (planning, an alibi window or a meeting, §10). (Provisional PM reading, 3 Nov.) Public `raidStopped` (no name; Heat set to 95), private note of the loss. If several are dealt (unique roles off), the first in seat order with its save left acts.
- **Mastermind:** the foreseen card is drawn early from the game's RNG (only when a Mastermind is dealt) and flips unless a Rig picks another; a Rig of a foreseen round offers the foreseen card first. Nothing is foreseen past round 9.
- **Fence:** the safe move is part of its move and happens after that round's split, so it can include loot pocketed that round; it can't move more than the stash holds. A Recharge never refills the safe allowance.
- **Hacker:** the loop is part of its move and names any room in play. Only **Security** is fooled (it reads "camera offline" for that room); the Lookout's extra room, a Tail and room-mates still see who was there. One token per loop, however many watchers; fooling only itself earns nothing.
- **Blackmailer:** the guess is part of its move and resolves with the round. At the **next meeting that opens** (regular or emergency) the victim's ballot weighs 0 and the Blackmailer's ballot weighs exactly +1 more, whatever the victim's own weight; nothing is added if the Blackmailer doesn't vote; the public tally still counts one per ballot. Quorum still counts the victim's ballot. "Decides a shakedown" means the shakedown passed and wouldn't have without the stolen weight. A wrong guess tells nobody anything.
- **Forger:** `{ forge, target, room }` in its move, any player (itself included) and any room in play. That round every **watch feed** of the room (Security, Lookout and Tail) lists the target as if it were there; room-mates' own sightings don't, a feed of the target itself doesn't, a player really in the room isn't listed twice, a Hacker loop or a Power cut still reads "camera offline". Only the reveal-only `sightingForged` tells it apart (end-of-game reveal).
- **Embezzler:** the take comes right after the splits (and the Bagman's bonus), at most **this round's inflow**, so the public Haul change is never negative; only the Embezzler is told. While it holds a take (anything taken since its last shakedown) its shakedown is **never clean**, whatever the stash (no pay; the Detective's check and the Muscle's clean test agree), and the shakedown takes the whole stash back into the Haul.
- **Mole:** the tip-off is its own command, not part of a move. "Any time" means during any round's planning or alibi window, during any open meeting (regular or emergency), or while a meeting is waiting to open. It is limited to once between meetings and 3 per game. It produces exactly the announcement of the background patrol (§10): a public `policeActivity` event with no name, +[4] Heat at once, scaled the same way in crews under 5, and a raid if Heat reaches 100 (unless a Fixer stops it). Only the Mole is told it was its own.

### 8.1 Dealing roles

*Roles v3 §6 as amended by the Extension.*

- **Decks** (host setting, §15), plus **per-role toggles** on top of any preset:
  - **Starter** (first game, no events): Rookie, Inside Man, Lookout, Bagman, Cleaner. Never deals a Wildcard or Lone wolf.
  - **Standard** (the default, 11 roles): Lookout, Auditor, Detective, Smooth Talker, Muscle, Cleaner, Hacker, Fence ★, Getaway Driver ★, Mole ★, Embezzler ★. Rookies fill any spare seats.
  - **Everything:** all 20.
  - **Quick (15 min) games use the Starter deck automatically:** 45-second rounds leave no time for powers and tokens.
  - **Quick (15 min) forces the Starter deck (provisional PM call, 3 Nov):** in the lobby, Quick locks the deck picker, the per-role toggles and the Event cards setting to Starter with events off. The lobby says "Quick games use the Starter deck". The host's other choices are kept and come back if the session length changes. Quick games also have **no tokens and no shop**: the token triggers are off and the shop is hidden. 45-second rounds leave no time for them, and Starter is the learning game, so it teaches rooms, splits, alibis and votes first. A longer game on the Starter deck has tokens and the shop as normal. Outside Quick, per-role toggles can add any role to any preset. "Never deals a Wildcard or Lone wolf" describes the untouched Starter preset, and a toggled deck shows as Custom.
- **Deal style** (host setting):
  - **Balanced** (default): a researched, **fixed mix per player count** of Wildcards and Lone wolves, decided by the balance pass (starting point: roles-v2 §3's most-weighted row under the n ÷ 3 rounded cap, below). The host can't change it. Roles come from the deck; seats the deck can't fill go to Team players (Rookies last).
  - **Truly random:** each seat is drawn uniformly from the eligible deck. Any mix can come up, even more Lone wolves than Team players.
  - The saboteur Off / Maybe / On setting is **removed**. A stored *Off* becomes Balanced with every Wildcard and Lone wolf toggled off; *Maybe* and *On* become plain Balanced. "No wildcards without a lone wolf" and "at most Lone wolves + 1 Wildcards" are dropped.
- **Role list shown to players** (host setting): **Exact roles dealt** (default; owner, 3 Nov: the public multiset of dealt roles, not who has which), **Possible roles** (the deck), or **Hidden**.
- *Balanced starting mixes (Wildcards / Lone wolves, before the balance pass):* 2–3 players none; 4: 0 / 1; 5–6: 1 / 1; 7–8: 1 / 1; 9–10: 1 / 2; 11–12: 2 / 2 *(PM reading of v2 §3's most-weighted rows under the cap ⌊(n + 1) ÷ 3⌋; 5–6 was a 50/50 tie, 1 / 1 taken; the balance pass replaces these)*.
- **Eligibility:** minimum crew sizes and "not in Duel" as in §8; the **Mastermind** only with events on.
- **Unique roles** (host setting, default on): each role is dealt at most once and Rookies fill the remaining seats. Off: seats are drawn from the deck with replacement, so roles may repeat, except that there is always at most one Mole and one Embezzler.

### 8.2 Shakedowns and roles

A shakedown reveals a player's **stash** (and a Fence's safe), not their role. Roles only come out at the end, or when a player chooses to say what they are, truthfully or not.

**No automatic reveals** (roles v3 §2): nobody learns anyone's role from the deal or as a reward (the Hacker's known saboteur, the Getaway Driver ↔ saboteur reveal, the Fence's, Mole's and Embezzler's reveals, the Forger known to saboteurs, saboteurs knowing each other, and the Blackmailer's ally bond are all gone; `alliesLearned` and `roleState.allies` go). Roles are learned only by choice: the Peek perk, the Inside tip card, the Detective, the Blackmailer's guess, claims and evidence cards.

### 8.3 Tokens and the perk shop

*Extension (approved 3 Nov); replaces role deck v2's fixed per-role perk rewards. R6a builds it.*

Roles earn **tokens** (§8); tokens buy perks from a **shop of three**.

- **The shop:** each game deals **one perk from each column** below, so every game with a shop has exactly three (Quick has none; events-off and Duel games deal from fixed sub-lists, below). The shop's three perks are public from the start.
- **Costs** [starting values]: **Peek 2, Shield 2, every other perk 1.**
- **Private until used:** your tokens and purchases are private; only using a perk shows, as below.
- **Use** a perk any time after buying it, **at most one perk per round**.
- **Unspent tokens are worth nothing** at the end.
- **Starting tokens:** 0. **Buying** (provisional PM reading): any time during the game, in any phase, if you have the tokens. You may make any number of purchases, and a perk may be bought more than once (each copy is used separately). **Using:** at most one perk per round. A round runs from the start of its planning until the next round's planning starts, so its alibi window and any meeting after it count as part of it.
- **Events off:** the Sway column deals from +Vote and Emergency only (Rig needs events).
- **Duel** (provisional PM reading): the shop still has exactly three perks, drawn only from perks that work without meetings. Learn deals Peek or Tail; Protect deals Alibi or Recharge; Sway deals Rig with events on. With events off, the Sway slot deals whichever Learn or Protect perk wasn't already dealt (picked at random), so a Duel shop always has three.
- **Quick:** no tokens and no shop (§8.1).

| Learn | Protect | Sway |
|---|---|---|
| **Peek** (2) | **Shield** (2) | **+Vote** (1) |
| **Ballot** (1) | **Alibi** (1) | **Emergency** (1) |
| **Tail** (1) | **Recharge** (1) | **Rig** (1, events on only) |

| Perk | Effect (unchanged from R1–R2b) |
|---|---|
| **Peek** | Learn one other player's role, as it is now. Any time. |
| **Shield** | Spent by itself: your next passed shakedown is cancelled. The ledger says only "cancelled", as for the Muscle; a Muscle cancel first keeps the Shield. |
| **+Vote** | +1 ballot weight in the open meeting (once per meeting); counts toward the majority, not the public tally or quorum, like the Smooth Talker. |
| **Ballot** | In an open meeting, see one other player's ballot live, as it changes, in your own view only (never in an event). **Works in Secret mode too** (the one exception to secret ballots, §11.2). Refused in Open mode, where ballots are public. |
| **Tail** | While planning, also see who is in one more room when the round resolves (like the Lookout; a Power cut blinds it, a camera loop doesn't). |
| **Alibi** | Your posted alibi for the latest resolved round, if it is true, is stamped **Verified** in public (`alibiVerified`). A false alibi can't be stamped. |
| **Recharge** | A used-up power comes back: one use of the current stretch (§4), or a once-per-game use. Refused if nothing is used, and never refills the Fence safe allowance. |
| **Emergency** | Spent by itself: once your own emergency meeting is used, calling another spends it. |
| **Rig** | Draw two different cards for the next round (events on); the first flips unless you pick the other. Another player's Rig of the same round never refuses yours; if several players rig a round, the oldest Rig's pick flips. |

- **Shakedown window:** under **Exact** roles it opens only when a Muscle is dealt or the Shield is in this game's shop; under Possible / Hidden whenever a Muscle could be dealt or the Shield is in the shop, so the window never gives a role away (§11.3).
- **Double-cross** (§10): tokens and bought perks stay with the player.

---

## 9. Jobs

A job is the location. It changes the strategy without adding new rules to memorise.

| Job | Twist |
|---|---|
| **First National Bank** (starter) | The standard rooms above. |
| **Art museum** | Rooms hold **items** of fixed value (a painting worth 8, a sculpture worth 5). An item goes either to the Haul or to your stash, never split, so every theft is all-or-nothing. |
| **Casino** | One secret round pays **triple**, and nobody knows which one. Baseline Heat is +5. |
| *(future)* Train, cruise ship, museum gala… | — |

---

## 10. Events

From round 2 onward, one event card is drawn each round and flipped at the start of the round for everyone to see. There are 9 cards: the Police patrol has left the deck and become hidden background police activity (provisional, below). Starter mode (and so every Quick game) has no events. Two things now look like sabotage, so the crew can't easily tell bad luck from a role's power (Extension, approved 3 Nov; R6a builds it). **Police activity** is announced identically whether it is the background patrol or the Mole's tip-off. **"Camera offline"** is shown both for a Power cut, which blinds every camera, and for a Hacker's loop, which blinds one room's Security feed. A single offline room in a round with no Power cut is therefore always a loop.

| Event | Effect |
|---|---|
| **Quiet night** | Heat −10. |
| **Shift change** | The Vault yields double this round, and its Heat pressure is ×1.5. |
| **Power cut** | No witnesses this round, and **every camera reads "camera offline"** (Security, Lookout, Tail), exactly like a Hacker's loop of one room. Nobody sees anybody. (Unlike a loop, it is flipped in public.) |
| **Payday** | The Lobby yields 4 this round. |
| **Lockdown** | One random room is closed this round. |
| **Audit** | This round's shortfall is shown **per room** ("the Vault came up 4 short"). |
| **Raid rumour** | The player with the biggest stash secretly loses 3. Only they are told. |
| **Inside tip** | One random player privately learns another player's role. |
| **Double-cross** | Two random players are offered a role swap. It happens only if both secretly accept. |

*Events deck (provisional, task 14):*
- The deck holds one of each card; every flip from round 2 draws from the **full deck**, so cards can repeat *(owner answers, 1 Nov)*. Events are a host setting (§15), off in starter mode.
- **Event Heat for small crews:** a card's Heat (Quiet night), police activity's Heat and the extra Heat of a surge (Shift change's ×1.5 beyond ×1) are scaled by **min(1, crew ÷ 5)**, rounded, so at 3 players police activity adds 2 and Quiet night removes 6. A Mole's tip-off and the background patrol are scaled the same way, so they always match. From 5 players cards play at full strength. *(Owner answers, 1 Nov.)*
- **Police activity (provisional PM call, 3 Nov, awaiting owner confirmation; replaces the Police patrol card):** the Police patrol is **no longer an event card**, so the deck is 9 cards. Instead, every game has a hidden background chance of police activity, whether events are on or off:
  - **The draw:** as each round's planning opens (rounds 1–9), the engine draws from the seeded RNG. With chance [1 in 4] (a content number, `policeActivity.chance`, tuned by the balance pass), that round's **window** gets one police activity. If it does, the engine also draws a **slot**, uniformly from the phases a tip-off could land in during that window: the round's planning, its alibi window, and (after rounds 3, 6 and 9) its regular meeting. It also draws a fraction f in [0, 1) of that phase. The draw is secret state: it is never in any view and only reveal-only in the log.
  - **The moment:** the server fires it at the phase's start plus f × the phase's planned length (`advance { kind: "policeActivity" }`). If the phase ends sooner (an early round end once everyone has locked in, or a meeting closing), it fires as the phase closes, before anything else in the transition (so before the round resolves). The simulator and engine tests have no clock, so they fire it at the drawn phase's close. Pauses (an open meeting, a host pause) delay it like any deadline.
  - **The announcement is identical** for this patrol and the Mole's tip-off (§8). It is one public `policeActivity { heat }` event with no source, the text "Police activity: +4 Heat", the same small-crew scaling, the Heat added at once and a raid check at once (a Fixer may stop it, §8). The Mole alone also gets a private "your tip-off" note. The source is reveal-only.
  - **Heat breakdown:** police activity counts in the breakdown of the round whose window it landed in. If it lands in round r's planning or alibi window, it counts in round r. If it lands in a meeting, it counts in the latest resolved round. If it lands after that round's summary was posted, the summary gains a "+4 police activity" line.
  - **Accepted leftover tells:** two police activities in one window means at least one was the Mole, but not which. A tip-off during an emergency meeting, or while a regular meeting is waiting to open, is always the Mole, because the patrol never lands there. With no Mole in the role list, every police activity is a patrol, so there is nothing to hide. Round 1, events off and the Starter deck no longer give the Mole away.
  - The Mastermind doesn't foresee police activity, because it isn't a card. With about 2.25 patrols per game at the starting chance (about +9 Heat), the balance pass tunes the chance together with the baseline Heat.
- Every other card is flipped as the round starts, so players can plan around it; its effects apply when the round resolves (§5.2 step 1). Lockdown names its closed room on the flip (any room but the Lobby, where missed moves go). Double-cross offers go privately to the two players on the flip, and each can accept or decline until the round deadline; the swap happens at step 1, so the new roles play that round. Each role card keeps its uses so far.
- **Shift change** also raises the Vault's Heat pressure ×1.5 (balance pass 2; was ×2; the Police patrol card was +10, then +5, until the Extension made it +4 and the 3 Nov PM call moved it out of the deck); **Payday** doubles the Lobby's loot (2 → 4).
- **Power cut:** no room-mates, and every watch feed (Security, Lookout, Tail) reads "camera offline". The Server room still counts pockets.
- **Audit:** every room in play is listed with what it came up short (0 included).
- **Raid rumour:** compares stashes, not the Fence safe (which it never touches); ties are broken at random; with every stash empty nobody is hit. The lost loot is gone.
- **Inside tip:** the tip is a player's current role.

---

## 11. Crew meetings and voting

### 11.1 Scheduling

- **Regular meeting:** after rounds 3, 6 and 9 (the last is the final meeting); each comes before its Haul target check. Any player can propose a time, and it's locked in once a majority of the **people** (human players) accepts; bots' backing doesn't count toward the lock (owner decision, 2 Nov). With no people at all (simulator, all-bot tests), a majority of the crew locks it. Bots never propose a time, they only back existing proposals. If nobody schedules one, the server picks a time 1–2 hours after round 3, 6 or 9 ends; in games of 3 hours or less meetings open automatically.
- **Emergency meeting:** each player can call **one** emergency meeting per game, at any point. Others are notified and it opens after a short notice period that the host sets.
- **Window length:** set by the host, from 5 to 30 minutes.

*Meeting timing (provisional):* a regular meeting's slot can be proposed and locked in at any time during the three rounds before it (the proposer counts as accepting, so one person in a crew of bots locks a slot by proposing it; a majority is more than half the crew's people), but the meeting only **opens after round 3, 6 or 9 has resolved**: rounds 1–3, then meeting 1, then its target check. An emergency meeting can open between any rounds (it recharges no "once between meetings" power, §4); rounds pause while any meeting is open, and only one meeting is open at a time. Only one emergency meeting can be waiting to open at once.

### 11.2 Voting

- During the window, each player either votes for one player to be shaken down or votes to skip.
- **Vote visibility** is a host setting:
  - *Hidden then revealed* (default): nobody can see votes while they're being cast, and everyone's votes go into the ledger afterwards.
  - *Open*: votes are visible as they're cast.
  - *Secret*: only the tally is ever shown, even at the end-of-game reveal. The one exception is the **Ballot** perk (§8.3): its holder sees one chosen ballot, live, in their own view only (owner decision on role deck v2).
- **Players who can't make it** can leave a sealed vote in advance. Otherwise they count as abstaining.
- **One vote rule for every crew size** (Extension, approved 3 Nov; R6a builds it): a shakedown passes if **at least half the crew votes** (sealed votes count) and **one player gets more than half of the votes cast** (vote weights count). The ⅓ plurality for 9–12 players (owner answers, 1 Nov) is gone.
- When the window closes, the ballots are cleared from the screen. The **result** stays in the ledger permanently.

*Smooth talker (provisional):* "more than half of the votes cast" counts the Smooth talker's ballot twice; "at least half the crew has to take part" counts people. The tally shown counts one per ballot (see §8).

*Ballots (provisional):* you can't vote to shake yourself down, and you can change your vote until the window closes. A sealed vote counts in the **next meeting that opens, regular or emergency**, and is then used up; sealing again replaces it, it can't be withdrawn, and a player who turns up can override it with a live vote.

### 11.3 Shakedown results

*Fixed numbers (Extension, approved 3 Nov; R6a builds them). 6 and 8 are starting values, tuned by the balance pass; they replace 3 × and 5 × the act number.*

- The target's stash is revealed to everyone and goes into the Haul. A **Fence's safe is shown too, but not taken** (owner answers, 2 Nov).
- **Clean:** if the stash **plus any Fence safe** is under **[6]**, the target is declared clean (so a Fence with a full safe isn't clean), and the crew pays them **[8]** out of the Haul, so false accusations hurt everyone (never more than the Haul holds). The same numbers apply at every meeting, regular or emergency. The Detective's "dirty" line is the same number (§8).
- An Embezzler holding a take is never clean (§8).
- No player is ever eliminated.
- *Shakedown window:* when a Muscle could act or the Shield is in this game's shop (§8.3; under Exact roles, only when a Muscle is actually dealt or the Shield is in the shop), a passed shakedown is applied only after a short window in which the Muscle may cancel it (§8); a Shield cancels it when the window ends. If a Muscle or Shield could stop it, players see a short pause before it goes through. The target check (§11.4) comes after that window.

### 11.4 Order at a meeting

**Vote → shakedown applied → Haul target checked.** At the end of the game, this means the final meeting can still rescue a failing heist by shaking down the greediest player. That stops everyone from grabbing everything in the last round.

### 11.5 Haul targets (cumulative)

| By | Haul needed | If missed |
|---|---|---|
| Meeting 1 (after round 3) | 7 × crew size | +15 Heat; the shortfall carries forward |
| Meeting 2 (after round 6) | 15 × crew size | +15 Heat; the shortfall carries forward |
| Final meeting (after round 9) | 23 × crew size *(R5; was 24)* | The heist fails |

Because targets are cumulative, a shortfall carries into the next stretch. **Target bar** (Extension; R6b UI): the game screen shows the Haul as a progress bar to the next meeting's target ("Haul 40 / 63 needed by the next meeting"). **Gap box** (Extension; R6b UI): once a round's alibis are in, the app adds them up (event effects included) and compares them with the Haul's growth ("Alibis say +14, the Haul grew 9: 5 unaccounted for").

---

## 12. Communication

### 12.1 In-app chat

- **Crew chat:** everyone.
- **Direct messages:** private side deals. Everyone can see *that* two players messaged, but not what they said (host setting, on by default).
- **Evidence cards:** a player can share a **verified** item from their case file into a chat, such as a camera result. "Verified" means only **"from their own case file"**: the app really showed it to that player. That doesn't make the cameras right: a Hacker's loop or a Forger's fake sighting (R3b) can make a camera feed false, so every card says so: "Verified: from their own case file. Cameras can be tampered with." (`EVIDENCE_CARD_NOTE` in `apps/web/src/game/describeEvent.ts`). Claims typed in chat, or screenshots from WhatsApp, can't be verified.
- **Alibi button:** posts a formal Alibi to the ledger (§5.4).
- **Claim button:** posts a formal role claim to the ledger ("I'm the Lookout"), true or not (§8). Bots claim and bluff only this way, since they don't read chat.

### 12.2 Outside the app

Players are expected to talk in WhatsApp, other social media, and in person. The game doesn't try to stop that. The ledger and evidence cards exist so that the facts stay trustworthy even when the talk happens elsewhere.

### 12.3 Suspicion board

Each player has a private board where they can tag every other player as *trusted*, *unsure* or *suspicious*, with optional notes. Only they can see it.

---

## 13. Ledger, case file and catching up

| View | Contents | Visible to |
|---|---|---|
| **Public ledger** | Round summaries (Haul change, Heat), who has locked in a move each round (never the move), events, alibis, meeting times, vote results, shakedown results, Haul target checks, each round's Heat breakdown (§7) | Everyone |
| **Case file** | Who you saw in your room, Security/Lookout/Server results, your own moves and splits, private event results | You only |
| **While you were away** | A 2–4 line summary of what changed since your last visit, shown at the top of the screen | You only |
| **End-of-game reveal** | Every role; every player's real room and split for each round; every stash over time; every ability used; every token earned and perk bought (M2-11) | Everyone, after the game ends |

Seats also show each person's **presence** (online now, or last seen), from the server and never in the ledger (owner decision, 2 Nov).

The end-of-game reveal works like a timeline you can scrub through, round by round, so the group can relive the big moments ("you were in the Vault in round 4?!").

---

## 14. Notifications

- A round has resolved, with a short summary.
- One hour left to submit your move (scaled down for short games).
- A meeting has been proposed, scheduled, is starting in 10 minutes, or is open.
- Someone called an emergency meeting.
- You were shaken down, or someone else was, and what they had.
- A Haul target was met or missed at a meeting.
- The game is over and the reveal is ready.

Notifications respect the host's quiet hours.

---

## 15. Host controls

*Roles v3 + Extension (approved 3 Nov; R6a/R6b build the new settings). The saboteur ("Mole") setting is removed.*

| Setting | Options (default first) |
|---|---|
| Session length | 1 h, Quick (15 min), 3 h, 1 day, 3 days, 1 week *(server default `1h`; Quick forces the Starter deck, events off and no shop, §8.1)* |
| Deck | Standard, Starter, Everything, or pick roles one by one (per-role toggles on any preset; locked to Starter in Quick), §8.1 |
| Deal style | Balanced (a tested mix for the crew size), Truly random, §8.1 |
| Role list shown to players | Exact roles dealt, Possible roles (could be in the game), Hidden (nothing), §8.1 |
| Vote visibility | Hidden until the meeting closes, Open, Secret, §11.2 |
| Event cards | On, Off (Off and locked in Quick), §10 |
| Unique roles | On, Off, §8.1 |
| Two players | Duel mode: no votes; once between meetings call out your rival, §16.1 |

- Also at setup: job, meeting window length, quiet hours.
- During the game: pause or resume, extend the current round, replace an inactive player with a bot (offered automatically after 2 missed rounds in a row), add bots to empty seats before the game starts.
- Before the start, the host can hand the host role to another person in the lobby (never a bot) and then leave; the host can't leave without handing over first. *(Owner request, M2-5b.)*

---

## 16. Player-count scaling summary

| Players | Rooms | Wildcards / Lone wolves (Balanced, §8.1) | Notes |
|---|---|---|---|
| 2 | 5 | None | Needs bots to vote properly. Without bots, use Duel mode (§16.1). |
| 3–4 | 5 | 3: none; 4: about one | Tight and personal. Every shortfall is easy to narrow down. |
| 5–8 | 7 | About two | The sweet spot. |
| 9–12 | 9 | Three or four | Chaotic. Lots of witnesses and lots of alliances. |

The Balanced mixes are fixed per player count by the balance pass (starting values in §8.1); one vote rule applies at every size (§11.2).

### 16.1 Duel mode (exactly 2 humans, no bots)

There are no votes and no meetings. Instead, **once between meetings** each player can **call out** the other; with no meetings, these limits (and every "once between meetings" power) **reset after rounds 3 and 6** (owner, 3 Nov). If the opponent pocketed anything during that stretch of three rounds, the caller takes everything the opponent pocketed in it. If not, the caller pays them [8] (the shakedown pay, §11.3; was 5 × the act number). Haul targets and Heat work as normal.

*Duel mode (provisional, task 15):*
- A host setting, valid only with exactly 2 players. No meetings, no emergency meetings and no votes; the meeting-only roles (Smooth Talker, Muscle, Priest, Snitch, Detective) are never dealt. Events can be on.
- **Timing:** a call-out can be made while any of the stretch's rounds (1–3, 4–6, 7–9) is being planned, at most once per player per stretch, and can't be withdrawn. It stays private until the stretch's last round resolves and its alibi window closes (§5.4); then every call-out of that stretch is settled (in seat order if both called), and the Haul target is checked straight after, with no meeting (§11.4 order: call-outs → target check). So a call-out covers the whole stretch, the last round included, however early it was made.
- **Caught:** the caller takes everything the opponent pocketed that stretch (their real splits, whatever they claimed), out of the opponent's stash: never the Fence safe, and never more than the stash holds. The Haul is untouched.
- **Wrong call:** the caller pays the opponent [8] from their own stash, never more than it holds *(provisional reading for R6a: the Extension fixed the shakedown pay at 8 and dropped act multiples; was 5 × the act number, `duel.wrongCallOutPerAct`)*.
- **Shop in Duel (provisional reading for R6a):** three perks, drawn only from those that work without meetings. Learn deals Peek or Tail; Protect deals Alibi or Recharge; Sway deals Rig with events on, and with events off it deals whichever Learn or Protect perk wasn't dealt (§8.3).
- **Stretches:** a Duel stretch closes when round 3's or round 6's call-outs and target check settle; that is when "between meetings" limits reset (§4).
- The result is public: who called, whether the opponent had pocketed, and how much moved. A Heat raid in the stretch's last round ends the game before its call-outs are settled.

---

## 17. Game engine, simulator and bots

### 17.1 Yes, we need a dedicated rules engine

All the rules live in **one engine that has no knowledge of the UI or the clock**. The web app, the mobile apps, the server, the bots and the simulator all use the same engine. That way rules never drift between platforms, and we can run thousands of simulated games to balance the numbers.

### 17.2 Engine design

- **Language:** TypeScript. The engine runs on the Node server (authoritative) and in the simulator; the web client may import its types. Native apps (Flutter) only consume `viewFor` JSON from the server.
- **Deterministic:** every game has a random seed. The same seed and the same inputs always produce the same game, which makes replays, bug reports and simulations reproducible.
- **Content as data:** rooms, roles, jobs, events, targets and Heat formulas are JSON config, not code. Balancing means editing numbers, not rewriting logic.
- **Event-sourced:** the game is a log of events, and the current state is built by replaying that log. The ledger, case files, the "while you were away" summary and the end-of-game reveal are all views over that same log.
- **Visibility-scoped events:** every event is tagged *public*, *private to player X* (opens up at the reveal), *secret to player X* (never opens up; Secret-mode ballots, §11.2), or *reveal-only*. A projection function, `viewFor(state, playerId)`, returns only what that player is allowed to see. The server is authoritative, and clients never receive hidden information.
- **Phase state machine:** `Setup → Planning → Resolving → (MeetingScheduled → MeetingOpen) → Checkpoint → … → FinalCheck → Reveal`.
- **Commands in, events out:** `submitMove`, `postAlibi`, `useAbility`, `proposeMeeting`, `acceptMeeting`, `callEmergency`, `castVote`, `sealVote`, plus `advance()`, which the scheduler (or the simulator) calls when a deadline passes.

### 17.3 Bots

Bots implement the same `Agent` interface a human client does: they receive their own `viewFor` and return commands. They can't cheat, because they can only see what a human in their seat would see.

**Personalities**, defined by tunable parameters:

| Bot | Greed | Lies | Suspicion | Notes |
|---|---|---|---|---|
| Honest | Low | Never | Medium | Hands in nearly everything and votes on the evidence |
| Opportunist | Medium | When safe | Medium | Pockets loot when it's alone in a room |
| Greedy | High | Often | Low | Stress-tests the Heat and checkpoint rules |
| Cautious | Low | Rarely | High | Spends turns on the Rooftop and checks Security often |
| Mole | n/a | Often | Fakes it | Tries to make the heist fail without being noticed |
| Random | Random | Random | Random | Baseline for comparison |

Under the hood, each bot keeps a **suspicion score** for every other player, updated from shortfalls, alibis, witness sightings, its own powers and perks (an Audit, a Detective check, a Peek), and role claims (a claim it knows is false, a role claimed twice, a changed claim). It votes when one player's score passes its threshold. At a vote it misjudges like people do: a small misreading of its own plus a hunch the whole crew shares at that meeting, which can carry a majority to a clean player (this keeps shakedown accuracy near the 50–70% target). Bots communicate only through alibis and role claims (§12.1): under roles v3 (R6a) holders of a failure-winner card or an evidence-leaving power (Hacker, Forger) bluff a low-risk role and the rest claim truthfully when accused (roles-v3.md §8; today's R4b bots still use the crew/dark tables of docs/roles-v2.md §4). They back meeting times people propose and only propose one themselves late in the stretch before the meeting (§11.1). ("Act" and "stretch" here and in §17.4 are engine and sim terms; players never see them.)

### 17.4 Simulator

A command-line tool that runs batches of all-bot games:

- **Inputs:** player count (2–12), mix of bot personalities, job, role pool, config overrides, number of games, seed.
- **Outputs:** CSV/JSON results and a summary report.

**Balance metrics and targets** (run on the sharded "Sim suite" GitHub workflow; the two owner gates decide the balance pass, the rest are guides):

| Metric | Target |
|---|---|
| Heist success rate (owner gate) | 55–70% |
| Heat-bust rate | 10–20% of failures come from Heat |
| Pocketing vs. honest | Moderate pocketing should win more often than pure honesty. Heavy pocketing should lose more often than it wins. |
| Shakedown accuracy | 50–70% of shakedowns catch a real cheater |
| Per-role parity (owner gate) | ≤ 0.10: each role's win credit ÷ (1 ÷ crew size), all 20 roles, Balanced deal, counts 4–12 (roles-v3.md §9) |
| Mole, Fence (watched, no gate) | Reported by ending (success vs failure wins); tuned via the tip-off, safe cap and lean points |
| Comeback rate | The leader after meeting 1 (round 3) wins less than 50% of the time |
| Decided early | Less than 15% of games are effectively settled before round 7 |

These results are measured at every player count from 2 to 12, so the scaling tables in §6, §7, §11 and §16 can be tuned from data.

### 17.5 System architecture (overview)

- **Game server (Node):** runs the engine, stores the event logs, runs the scheduler for round deadlines and meeting windows, runs bots, and handles chat.
- **Real-time updates:** WebSockets for chat, meeting windows and live updates.
- **Push notifications:** FCM for Android, APNs for iOS, and web push for browsers.
- **Clients:** a responsive React web app (the launch product, installable as a PWA) and, later, a **Flutter** app for Android and iOS. Both are thin clients over the server's `viewFor` JSON; only the web app shares the engine's TypeScript types.

---

## 18. Visual direction

Chosen direction: **Option A, a cartoon cutaway of the building.** The bank is seen from the side like a dollhouse, players are characters with expressions, and they move between rooms when a round resolves. Detailed UI design comes later.

---

## 19. Open questions

1. Should a failed heist still show a "best of the losers" ranking? *(Provisionally yes, labelled as a loss; see §3.)*
2. Should a shakedown ever reveal the Mole's role, or only their stash?
3. Should rounds stay at 9, or should very long sessions get more rounds (for example 12 in a week-long game)?
4. Are clean-threshold and compensation values the right size? This needs simulation.
5. Should a player have to post an alibi every round, or should it stay optional?
6. How long should the notice period be for an emergency meeting in a week-long game?

---

## 20. Roadmap

1. **Engine plus simulator** with the bank job, core roles and bots. Tune the numbers from simulation results.
2. **Playable web prototype** with a minimal UI, chat and ledger. Playtest with real friends.
3. **Mobile apps**, push notifications, and the cartoon art style.
4. **More content:** the museum and casino jobs, more roles and more events.
5. **Nice-to-haves:** stats across games within a friend group, cosmetics.
