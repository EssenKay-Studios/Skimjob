# Skimjob — Game Design Document

*Version 0.1 — 31 Oct 2026. All numbers are placeholders until the simulator has been run. Balance pass 1 (1 Nov 2026) changed the Deposit-box Heat, Teller-line loot, Insider scoring and checkpoint targets; see `docs/balance/balance-1.md`.*

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
| **Act** | A group of 3 rounds. Each act ends with a crew meeting and a checkpoint. |
| **Checkpoint** | A minimum the Haul has to reach by the end of each act. |
| **Shakedown** | The result of a successful vote: the target's stash is revealed and taken into the Haul. |
| **Alibi** | A formal, logged claim of which room you were in. It can be a lie. |
| **Case file** | A player's private log of everything they personally saw. |
| **Ledger** | The public log of everything everyone can see. |

---

## 3. Winning and losing

- **Two sides** *(role deck v2 §0, `docs/roles-v2.md`)*: every role belongs to a faction. **Crew** roles help the job; **saboteurs** (the Mole) wreck it; **accomplices** help the saboteurs. Saboteurs and accomplices together are the **dark side**. The winning side's **biggest stash wins** (after role scoring, §8, and the tie-breaks below).
- **The heist succeeds** if, after the final meeting, the Haul is at or above the final target and Heat is below 100. The biggest **Crew** stash wins. Saboteurs and accomplices can't win a success, however big their stash.
- **The heist fails** if Heat reaches 100 at any point, or the final target is missed. The crew loses, and the biggest stash among the **saboteurs and accomplices** wins. A failure with no dark side dealt is won by nobody (accomplices are never dealt without a saboteur). Loot taken by sabotage is just stash, so "steal, then sink the job" is the saboteurs' plan.
- **Ties** go to whoever was shaken down fewer times, then to whoever handed in more total loot. The engine tracks that figure but only reveals it at the end. *(Provisional: players still tied on all three share the win.)*
- **Scores:** a Rookie's ×1.2 can give fractions; scores are kept to one decimal place. *(Provisional.)*
- **A failed heist still shows the whole stash ranking** ("best of the losers"), clearly labelled as a loss for the crew; only the dark side's best stash wins. *(Provisional, §19.1.)*
- Roles are read as they are at the end of the game, so a Double-cross (§10) can change a player's side.

---

## 4. Game structure

```
Setup → [Act 1: R1 R2 R3 → Crew meeting → Checkpoint 1]
      → [Act 2: R4 R5 R6 → Crew meeting → Checkpoint 2]
      → [Act 3: R7 R8 R9 → Final meeting → Final check]
      → Reveal and replay
```

| Act | Name | Feel |
|---|---|---|
| 1 | Casing the joint | Trust is high and skims are small. Not much information yet. |
| 2 | The job | The first shortfalls appear, and with them accusations, alibis and alliances. |
| 3 | The getaway | Everyone can see the maths. Greed, Heat and suspicion all peak. |

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
- Rounds are **paused** while a vote window is open, so nothing resolves in the middle of a vote.
- The host can set "quiet hours", such as midnight to 7am, during which rounds don't resolve and no notifications are sent.

---

## 5. A round in detail

### 5.1 Planning (simultaneous and secret)

Every player submits a **move**:
1. **Room**: where they go this round.
2. **Split**: how much of that room's loot goes to the Haul. The rest goes to their stash.
3. **Ability** (optional): a role power, if their role has one.

Moves can be changed until the round deadline. If a player misses the deadline, they get a **default move**: Lobby, hand everything in.

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
- Alibis are posted **before the next round's planning**: a short alibi window follows every round. When its deadline passes (the server times it), the round's alibis close and the next round starts; after an act's last round, the act's meeting comes next. An emergency meeting may interrupt the window, which then resumes. *(Owner answers, 1 Nov.)*
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
| 5–8 | **Deposit boxes**: 5 loot, holds 2 people (if more than 2 go, everyone there gets 3), adds half the vault pressure. **Server room**: 0 loot, learn *how many* players pocketed loot this round, but not who. |
| 9–12 | Everything above, plus **Teller line**: 3 loot. **Manager's office**: 4 loot, adds half the vault pressure. *(1 Nov: were 4 and 5; see decisions.md.)* |

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
| Missed checkpoint | +15 |
| Events / Mole tip-off | Varies (event Heat × min(1, crew ÷ 5) for crews of 2–4, §10) |

Scaling by fractions of the crew means a crew of 12 and a crew of 3 feel the same pressure when the same *share* of players goes to the Vault.

Each round's room-and-baseline Heat change is rounded to a whole number (halves round up), and Heat never drops below 0, so time on the Rooftop can't be banked ahead. *(provisional)*

*Sanity check (placeholder numbers):* the baseline alone adds 36 over 9 rounds. With a quarter of the crew in the Vault every round, total Heat is about 81, which is risky but survivable. With half the crew in the Vault, Heat goes bust unless people spend turns on the Rooftop.

---

## 8. Roles

Every player is dealt **one secret role** at the start of the game. Roles are designed so that **revealing your role is risky**: each one has a weakness once people know about it. Players can claim any role, truthfully or as a bluff. A formal claim (the **Claim** button, §12.1) goes on the public ledger: once per player per act, any role the game knows (even one that can't be in this game, so a refusal never hints at the hidden role pool), never in Duel mode. Like an alibi it changes no rule; it is evidence the crew weighs.

| Role | Power | Weakness if revealed |
|---|---|---|
| **Rookie** | No power. Final stash counts ×1.2. *Reward:* each Act 1/2 checkpoint made → a Tail. | Seen as an easy target to pin blame on. |
| **Lookout** | Each round, also sees who was in one extra room. *Reward:* someone it saw is shaken down dirty → a Peek. | People lie around them more carefully, or try to frame them. |
| **Auditor** | Once per act, learns the latest resolved round's shortfall for one room (what its visitors pocketed). *Reward:* a visitor of that room, that round, is shaken down dirty → a Ballot. | Liars shake it down to discredit it. |
| **Detective** *(4+ players, not in Duel)* | Once per act, learns whether one player's stash is at or above the clean threshold right now. *Reward:* a player it checked is shaken down dirty → a Shield. | Cheaters shake it down first (the Shield answers this). |
| **Inside Man** *(5+ players)* | Can't pocket loot. Scores 0.3 points for every loot the Haul ends above the final target. *Reward:* each Act 1/2 checkpoint made → a Peek. | Others pocket more, knowing the Inside Man will cover the Haul. |
| **Smooth Talker** *(5+ players, not in Duel)* | Their vote counts double (majority only). *Reward:* on the winning side of a dirty shakedown → one more emergency meeting (an Emergency perk). | Others coordinate their votes against them. |
| **Muscle** *(5+ players, not in Duel)* | Once per game, can cancel a shakedown after the vote passes. *Reward:* the target was clean → a Recharge (no compensation is paid); the target was dirty → the ledger names the Muscle. | Everyone knows a vote against their friends may get blocked. |
| **Priest** *(5+ players, not in Duel)* | Once per act, blesses another player for that act: blessed and shaken down clean → the bank pays the compensation, not the Haul. *Reward:* a Ballot when that happens. Blessed but caught dirty → no blessing next act. | Its flock becomes a free target. |
| **Bagman** | Each round it hands in everything (from a room that pays), the bank adds +1 to the Haul, hidden in the round's Haul change. *Reward:* every round of an act all-in → an Alibi. | The +1 shows in the Haul maths, so others hide skims behind it. |
| **Cleaner** | Its Rooftop visit counts as 2 visitors for Heat. *Reward:* every 2nd Rooftop round → a +Vote. | A Rooftop alibi is its easy cover; nobody believes it. |
| **Fixer** | Once per game, automatically: a raid stops with Heat at 95, and the Fixer loses ¼ of its stash (rounded, halves up). *Reward:* a Shield. | The crew gets reckless with Heat. |
| **Mastermind** *(events on only)* | Privately sees each next event card as a round starts (round 2's at setup). *Reward:* each Act 1/2 checkpoint made → a Rig. | Blamed for every bad card. |
| **Snitch** *(4+ players, not in Duel)* | Secretly assigned a target. Each time that target is shaken down while holding more than the clean threshold, its ballot weighs +1 for the rest of the game. | Their target has a reason to frame them. |
| **Getaway Driver** *(accomplice)* | Its Rooftop visit **adds** the Heat a visitor would remove (hidden in the round's Heat). *Reward:* Heat at 75 or more → it learns the saboteurs and they learn it. Knows nobody at the start. | Rooftop claims that don't cool Heat give it away. |
| **Fence** *(accomplice)* | Can move up to 5 loot per act into a hidden safe that shakedowns can't touch. *Reward:* safe at 10 or more → learns one saboteur. Knows nobody at the start. | Assumed to be hoarding, so becomes the first shakedown target. |
| **Hacker** *(accomplice)* | Once per act, can **loop the cameras** so one room shows as empty on Security that round. Knows one saboteur from the start. *Reward:* its loop hid a saboteur from a crew player watching on Security → a Peek. | Every empty camera result looks like their doing. |
| **Blackmailer** *(accomplice, 7+ players, not in Duel)* | Once per act, secretly guesses one player's role. If right, it **steals that player's vote** at the next meeting; the victim is told only "your vote is compromised". *Reward:* guessed a saboteur → they become mutual allies. Knows nobody at the start. | Players hide their roles; victims out it. |
| **Forger** *(accomplice, 7+ players, not in Duel)* | Once per act, plants a **fake sighting**: player X shows in room R on that round's watch feeds of R. *Reward:* a player it forged is shaken down clean → a Shield. Knows nobody, but the saboteurs are told who the Forger is at the deal. | Proof of the dark side: hunted at once. |
| **Embezzler** *(saboteur, optional)* | Once per act, moves up to 4 of the round's handed-in loot from the Haul to its stash after the splits, hidden in the round's Haul change. *Reward:* the take itself; its first take → learns one accomplice. | Its stash is always dirty, and a shakedown returns the take. |
| **Mole** *(saboteur, optional)* | Wins a failed heist with the dark side's best stash; never a successful one. Once per act, can **tip off** the cops (+6 Heat, hidden). *Reward:* each tip-off → learns one accomplice it didn't know. | Revealed means hunted, and revealing it is rarely worth it. |

*Factions (role deck v2, R1, R3a, R3b):* the Mole and the Embezzler are the **saboteurs**. The **accomplices** are the Getaway Driver, Fence and Hacker (R3a) and the Blackmailer and Forger (R3b). Everyone else is **crew**. `RoleDef.faction` replaces the old `winsOnFailure` / `winsOnSuccess` fields. The Driver was split: its crew half is the Fixer (R2b), its dark half the Getaway Driver (R3a), and the old Driver's failure win is gone.

*Accomplices and what the dark side learns (R3a, provisional details):*
- **Allies:** everything the dark side learns about itself is a private `alliesLearned { allies, via }`, added to `roleState.allies` (bots never vote to shake down a known ally). `via`: `deal` (the Hacker's saboteur; R3b: each saboteur is told the Forger), `fence`, `getaway`, `tipOff`, `blackmail`, `embezzle` (R3b). Picks are drawn at random from the ones the player doesn't know yet; only the player named is told, except the Getaway Driver's reveal, which goes both ways. In a Double-cross what a player learned stays with the player (like perks); saboteur mates are recomputed.
- **Getaway Driver:** passive: on the Rooftop it counts as −1 visitors for Heat (× `reverse`, 1). The reveal is checked after every round and after a missed checkpoint's penalty, once per Driver player, with the saboteurs as they are then; nothing if no saboteur is dealt. After a Double-cross nobody is re-told: a new Mole doesn't learn a Driver revealed earlier, and a player who takes the Driver card reveals again when Heat is high.
- **Fence:** the reveal is checked as the round resolves (after the safe move), once per game. A **Recharge never refills the safe allowance** (it is refused for the Fence).
- **Hacker:** the reward needs a **crew** Security watcher (not a Lookout or Tail, which a loop doesn't fool) watching the looped room while a saboteur was in it; fooling the dark side (a saboteur, or the Hacker watching its own loop) earns nothing. One Peek per loop, however many watchers.

*Blackmailer, Forger and Embezzler (R3b, provisional details):*
- **Blackmailer:** the guess is part of its move and resolves with the round. A right guess sends the victim a private `voteCompromised` (no name, no role). At the **next meeting that opens** (regular or emergency) the victim's ballot weighs 0 and the Blackmailer's ballot weighs exactly +1 more (`STOLEN_VOTE_WEIGHT`), whatever the victim's own weight (Smooth Talker, +Vote, Snitch reward: owner, 2 Nov); nothing is added if the Blackmailer doesn't vote; the public tally still counts one per ballot, so only a result the tally can't explain shows it, as with the Smooth Talker. Quorum still counts the victim's ballot. A right guess on a saboteur also sends both a private `alliesLearned` (`via: blackmail`), unless they already knew. A wrong guess tells nobody anything. Nothing is taken from any stash (the v1 steal is gone).
- **Forger:** `{ forge, target, room }` in its move, any player (itself included) and any room in play. That round, every **watch feed** of the room (Security, Lookout and Tail `roomWatched`) lists the target as if it were there, in seat order like a real sighting; room-mates' own sightings don't (they were there), a feed of the target itself doesn't, a player really in the room isn't listed twice, a Hacker loop still shows Security empty, and a Power cut shows nothing. To a watcher a forged sighting is a plain `roomWatched`; only the reveal-only `sightingForged { forger, target, room, shownTo }` tells it apart (end-of-game reveal). The Shield comes when a player it forged earlier in the game (not itself) is shaken down clean.
- **Embezzler:** the take comes right after the splits (and the Bagman's bonus), at most **this round's inflow** (what was handed in, plus any Bagman bonus), so the round's public Haul change is never negative and never gives a take away (PR #36 review); it is folded into that change; only the Embezzler is told (`abilityResolved embezzle`). While it holds a take (anything taken since its last shakedown) its shakedown is **never clean**, whatever the stash (no compensation; the Detective's check and the Muscle's clean test agree), and the shakedown takes the whole stash, take included, back into the Haul. Its first take of the game names one accomplice it doesn't know, if any.

*Fence safe timing (provisional):* the safe move is part of the Fence's move and happens after that round's split, so it can include loot pocketed that round; it can't move more than the stash holds.

*Info and vote roles (provisional, task 12):*
- **Hacker:** the loop is part of the Hacker's move and names any room in play. Only **Security** shows it as empty; the Lookout's extra room and room-mates still see who was there.
- **Smooth talker:** the double vote counts toward the majority (§11.2), not toward quorum, which counts voters. The public tally counts one per ballot, so it never points at the Smooth talker; only a result the plain count can't explain shows that one was on the winning side. A sealed vote counts double too.
- **Muscle:** when a vote passes a shakedown, a short **shakedown window** opens before it is applied (§11.3). The Muscle can cancel it then, including a shakedown of themselves. The cancel stays private until the window ends; the ledger then says the shakedown was cancelled, not who cancelled it (R2b: unless the target wasn't clean, when it names the Muscle). The window opens after every passed shakedown whenever the Muscle is in the game's role pool, dealt or not, so it never shows that a Muscle is in the crew.
- **Blackmailer:** see R3b above (role deck v2 replaced the v1 steal of 3 loot).
- **Snitch:** the target is drawn at random from the other players at setup. "Holding more than the clean threshold" means the shakedown was **not clean** (stash plus any Fence safe at least 3 × the act number). Each time, its ballot weighs +1 more for the rest of the game (role deck v2; was +10 loot), counting toward the majority like the Smooth talker's, not the tally or quorum; a cancelled shakedown gives nothing.

*Crew roles of role deck v2 (R2a, provisional details):*
- **"Dirty"** means a shakedown that wasn't clean. Rewards come as private `perkGranted` events: after the checkpoint (Rookie, Inside Man; the final check grants nothing, the game is over) or right after the dirty shakedown (Lookout, Auditor, Detective). "Saw", "audited" and "checked" count anything earlier in the game by that player, and nobody is rewarded for their own shakedown. Each reward's count (1) is overridable (`rewardCount`).
- **Auditor:** used with `useAbility` at any time after round 1 resolves; it audits the latest resolved round (so it can follow up an alibi). A Power cut doesn't stop it (it reads the books, not the cameras).
- **Detective:** used with `useAbility` at any time; the threshold is the current act's (3 × act), and the Fence safe counts, as in the clean check.

*Crew roles of role deck v2 (R2b, provisional details):*
- **Smooth Talker:** "the winning side" means its last ballot in that meeting was for the target. The extra meeting is an **Emergency** perk (a ninth perk kind, spent by itself): with your own emergency used, calling one spends it; the meeting's id is `emergency2-<player>`, `emergency3-<player>`….
- **Muscle:** whether the target was clean is the clean check at the window's end (stash plus Fence safe below 3 × act). Dirty → public `muscleNamed` after `shakedownCancelled`. Saving itself never earns the Recharge.
- **Priest:** `useAbility { bless, target }`, any time, on another player whose shakedown isn't already pending. The blessing covers shakedowns in that act's meetings (regular or emergency). A clean one pays the usual compensation, then public `blessingPaid` puts it back into the Haul (the bank paid); it doesn't say who blessed. "No blessing next act" when any player it blessed in the act before was shaken down dirty later that act.
- **Bagman:** the +1 needs a room with loot (the Rooftop doesn't count) and comes with a private note to the Bagman; the Alibi is granted as the act's last round resolves, so it can stamp that round's alibi.
- **Cleaner:** counts only in the Rooftop's Heat pressure (the room is content); the +Vote comes as its 2nd, 4th… Rooftop round resolves.
- **Fixer:** stops the raid of a round's Heat or of a missed checkpoint's +15. Public `raidStopped` (no name; Heat set to 95), private note of the loss; the loss leaves the game. If several are dealt (unique roles off), the first in seat order with its save left acts.
- **Mastermind:** the foreseen card is drawn early from the game's RNG (only when a Mastermind is dealt) and flips unless a Rig picks another; a Rig of a foreseen round offers the foreseen card first. Nothing is foreseen past round 9.

*Win-condition roles (provisional, task 13; role deck v2 R1):*
- **Mole:** a saboteur: wins a failed heist (Heat or target) if its score is the best of the dark side, never a successful one. The tip-off is part of the Mole's move, at most once per act: +6 Heat (balance pass 2; was +10) is added to that round's Heat (after rounding, before the cap), so it only shows as part of the round's public Heat change. Only the Mole is told it happened. Saboteurs know each other: when two or more are dealt, each is told privately at the start who the others are.

### 8.1 Dealing roles

*Role deck v2 §3 (`docs/roles-v2.md`).*

- **First the dark side is rolled** (saboteurs and accomplices) from the weights below, then each faction's roles are drawn at random from its own eligible pool, at most one of each; the crew fills the remaining seats (Rookies when the crew pool runs out).
- **Hard limits** at any crew size: at most ⌊n ÷ 3⌋ dark seats (accomplices are dropped first, then saboteurs); no accomplices without a saboteur; at most saboteurs + 1 accomplices.
- **Host saboteur setting** (the old Mole setting, same field): *off* deals crew only; *on* uses the weights; *maybe* is like *on* but with a 50% chance of no dark side at 4–8 players (at 9–12 it is the same as *on*).

| Players | Saboteurs / Accomplices (weight) | Fair success rate |
|---|---|---|
| 2–3 | 0 / 0 (crew only; 2p is Duel or bots) | n/a |
| 4 | 1 / 0 | 75% |
| 5–6 | 1 / 0 (50), 1 / 1 (50) | 67–83% |
| 7–8 | 1 / 1 (60), 2 / 0 (20), 1 / 2 (20) | 71–75% |
| 9–10 | 2 / 1 (60), 1 / 2 (20), 2 / 2 (20) | 60–70% |
| 11–12 | 2 / 2 (60), 2 / 1 (20), 3 / 1 (20) | 67–75% |

  The ⌊n ÷ 3⌋ cap trims the table: at **5** players 1 / 1 becomes 1 / 0 (no accomplice ever); at **7–8**, 1 / 2 becomes 1 / 1; at **9–10**, 2 / 2 becomes 2 / 1; at **11**, 2 / 2 becomes 2 / 1 and 3 / 1 becomes 3 / 0. Only 4, 6 and 12 play the table as written (R5 retunes the weights). The fair success rate s = crew seats ÷ n makes a crew seat's and a dark seat's chances equal.
- **Pools cap the roll (R1, provisional):** a faction can't deal more distinct roles than its pool holds. There are two saboteur roles (Mole, Embezzler since R3b), so the table's two-saboteur mixes deal both and a 3 / 1 roll at 11–12 deals two; an unfilled dark seat goes to the crew. Saboteurs are dealt by the setting, never from the host's role pool.
- **Inside Man:** dealt only in crews of 5 or more (a crew of 2–4 can't spare a player who never pockets). **Snitch and Detective** from 4 players (role deck v2 §3).
- **Smooth Talker, Muscle and Priest** from 5 players; the **Mastermind** only with events on (`RoleDef.needsEvents`).
- **Not in Duel:** roles that need meetings (`RoleDef.needsMeetings`: Smooth Talker, Muscle, Priest, Snitch, Detective, Blackmailer, Forger).
- **Blackmailer and Forger** from 7 players (R3b).
- **Unique roles** (host setting, default on): each special role is dealt at most once and Rookies fill the remaining crew seats. Off: crew and accomplice seats are drawn from their pools with replacement, so roles may repeat. Saboteurs are always distinct (one Mole and one Embezzler at most, owner answers 1 Nov; provisional).
- **Starter mode** (first game in a group): only the starter crew roles (Rookie, Inside Man, Lookout, Bagman, Cleaner; the Fence left in R2b), no dark side and no events.

### 8.2 Shakedowns and roles

A shakedown reveals a player's **stash**, not their role. Roles only come out at the end, or when a player chooses to say what they are, truthfully or not.

### 8.3 Perks

*Role deck v2 §1 (`docs/roles-v2.md`); R1 builds the vocabulary, R2/R3 give roles the triggers that earn them (`RoleDef.rewards`; R2a: Rookie, Inside Man, Lookout, Auditor, Detective; R2b: Smooth Talker, Muscle, Priest, Bagman, Cleaner, Fixer, Mastermind, §8).*

A perk is a **private token**. Earning one is a private `perkGranted` (only you are told); your own tokens show in your view, nobody else's. Spending one is a private `perkUsed`, with `useAbility`; a refused spend keeps the token. The Shield is the exception: it is spent by itself.

| Perk | Effect (R1, provisional details) |
|---|---|
| **Peek** | Learn one other player's role, as it is now. Any time. |
| **Shield** | Spent by itself: your next passed shakedown is cancelled. The ledger says only "cancelled", as for the Muscle; a Muscle cancel first keeps the Shield. |
| **+Vote** | +1 ballot weight in the open meeting (once per meeting); counts toward the majority, not the public tally or quorum, like the Smooth talker. |
| **Ballot** | In an open meeting, see one other player's ballot live, as it changes, in your own view only (never in an event). **Works in Secret mode too** (owner decision on role deck v2: the one exception to secret ballots, §11.2). Refused in Open mode, where ballots are public. |
| **Tail** | While planning, also see who is in one more room when the round resolves (like the Lookout; a Power cut blinds it, a camera loop doesn't). |
| **Alibi** | Your posted alibi for the latest resolved round, if it is true, is stamped **Verified** in public (`alibiVerified`). A false alibi can't be stamped. One stamp per player per round. |
| **Recharge** | Your power's uses this act come back, and one use this game (Muscle). Refused if nothing is used. |
| **Emergency** | *(R2b, the Smooth Talker's reward)* Spent by itself: once your own emergency meeting is used, calling another spends it. |
| **Rig** | Draw two different cards for the next round (events on); the first flips unless you pick the other, until that round starts. Another player's Rig of the same round never refuses yours (a refusal would hint at who holds what); if several players rig a round, the oldest Rig's pick flips. |

- **Shakedown window:** opens after every passed shakedown whenever a Muscle **or any role that can earn a Shield** (Detective, Fixer) could be dealt in this game, so the window never shows that either exists (§11.3).
- **Double-cross** (§10): perks and a spent Tail stay with the player; they were earned, not dealt *(provisional)*.

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

From round 2 onward, one event card is flipped at the start of each round and shown to everyone. Starter mode has no events.

| Event | Effect |
|---|---|
| **Police patrol** | Heat +5. |
| **Quiet night** | Heat −10. |
| **Shift change** | The Vault yields double this round, and its Heat pressure is ×1.5. |
| **Power cut** | No witnesses and no cameras this round. Nobody sees anybody. |
| **Payday** | The Lobby yields 4 this round. |
| **Lockdown** | One random room is closed this round. |
| **Audit** | This round's shortfall is shown **per room** ("the Vault came up 4 short"). |
| **Raid rumour** | The player with the biggest stash secretly loses 3. Only they are told. |
| **Inside tip** | One random player privately learns another player's role. |
| **Double-cross** | Two random players are offered a role swap. It happens only if both secretly accept. |

*Events deck (provisional, task 14):*
- The deck holds one of each card; every flip from round 2 draws from the **full deck**, so cards can repeat *(owner answers, 1 Nov)*. Events are a host setting (§15), off in starter mode.
- **Event Heat for small crews:** a card's Heat (Police patrol, Quiet night) and the extra Heat of a surge (Shift change's ×1.5 beyond ×1) are scaled by **min(1, crew ÷ 5)**, rounded, so at 3 players Police patrol adds 3 and Quiet night removes 6. From 5 players cards play at full strength. *(Owner answers, 1 Nov.)*
- The card is flipped as the round starts, so players can plan around it; its effects apply when the round resolves (§5.2 step 1). Lockdown names its closed room on the flip (any room but the Lobby, where missed moves go). Double-cross offers go privately to the two players on the flip, and each can accept or decline until the round deadline; the swap happens at step 1, so the new roles play that round. Each role card keeps its uses so far; Moles are told if their fellow Mole changed.
- **Shift change** also raises the Vault's Heat pressure ×1.5 (balance pass 2; was ×2, and Police patrol was +10); **Payday** doubles the Lobby's loot (2 → 4).
- **Power cut:** no room-mates, no Security and no Lookout results. The Server room still counts pockets.
- **Audit:** every room in play is listed with what it came up short (0 included).
- **Raid rumour:** compares stashes, not the Fence safe (which it never touches); ties are broken at random; with every stash empty nobody is hit. The lost loot is gone.
- **Inside tip:** the tip is a player's current role.

---

## 11. Crew meetings and voting

### 11.1 Scheduling

- **Regular meeting:** each act has one meeting, which must take place before that act's checkpoint. Any player can propose a time, and it's locked in once a majority accepts. If nobody schedules one by the act deadline, the server picks a time.
- **Emergency meeting:** each player can call **one** emergency meeting per game, at any point. Others are notified and it opens after a short notice period that the host sets.
- **Window length:** set by the host, from 5 to 30 minutes.

*Meeting timing (provisional):* the act's slot can be proposed and locked in at any time during the act (the proposer counts as accepting; a majority is more than half the crew), but the meeting only **opens after the act's last round has resolved**: rounds 1–3, then the Act 1 meeting, then checkpoint 1. An emergency meeting can open mid-act; rounds pause while any meeting is open, and only one meeting is open at a time. Only one emergency meeting can be waiting to open at once.

### 11.2 Voting

- During the window, each player either votes for one player to be shaken down or votes to skip.
- **Vote visibility** is a host setting:
  - *Hidden then revealed* (default): nobody can see votes while they're being cast, and everyone's votes go into the ledger afterwards.
  - *Open*: votes are visible as they're cast.
  - *Secret*: only the tally is ever shown, even at the end-of-game reveal. The one exception is the **Ballot** perk (§8.3): its holder sees one chosen ballot, live, in their own view only (owner decision on role deck v2).
- **Players who can't make it** can leave a sealed vote in advance. Otherwise they count as abstaining.
- **To pass**, a shakedown needs **more than half of the votes cast**, and at least half the crew has to take part (sealed votes count).
- **Big crews (9–12 players):** the player with the most votes is shaken down if they received **at least ⅓ of the votes cast** and **more votes than skip** (Smooth talker weight counts); a tie for the most votes, or skip leading or tied, means no shakedown. The quorum is the same. *(Owner answers, 1 Nov.)*
- When the window closes, the ballots are cleared from the screen. The **result** stays in the ledger permanently.

*Smooth talker (provisional):* "more than half of the votes cast" counts the Smooth talker's ballot twice; "at least half the crew has to take part" counts people. The tally shown counts one per ballot (see §8).

*Ballots (provisional):* you can't vote to shake yourself down, and you can change your vote until the window closes. A sealed vote counts in the **next meeting that opens, regular or emergency**, and is then used up; sealing again replaces it, it can't be withdrawn, and a player who turns up can override it with a live vote.

### 11.3 Shakedown results

- The target's stash is revealed to everyone, and all of it except any Fence safe goes into the Haul.
- **Clean threshold:** if the stash **plus any Fence safe** was below **3 × the act number** (3, 6 or 9), the target is declared clean, so a Fence with a full safe isn't clean and gets no compensation; the safe still can't be seized *(owner answers, 1 Nov)*. The crew pays them **5 × the act number** out of the Haul, so false accusations hurt everyone. *(Provisional: never more than the Haul holds.)* An emergency meeting uses the current act's numbers.
- No player is ever eliminated.
- *Muscle window (provisional):* when the role pool includes the Muscle, or any role that can earn a Shield (§8.3), a passed shakedown is applied only after a short window in which the Muscle may cancel it (§8); a Shield cancels it when the window ends. The checkpoint (§11.4) comes after that window.

### 11.4 Order at a checkpoint

**Meeting → shakedown applied → checkpoint checked.** At the end of the game, this means the final meeting can still rescue a failing heist by shaking down the greediest player. That stops everyone from grabbing everything in the last round.

### 11.5 Checkpoint targets (cumulative)

| Checkpoint | Target |
|---|---|
| End of Act 1 | 7 × crew size |
| End of Act 2 | 15 × crew size |
| Final | 24 × crew size |

A missed Act 1 or Act 2 checkpoint adds +15 Heat. Because targets are cumulative, the shortfall carries into the next act.

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
| **Public ledger** | Round summaries (Haul change, Heat), events, alibis, meeting times, vote results, shakedown results, checkpoints | Everyone |
| **Case file** | Who you saw in your room, Security/Lookout/Server results, your own moves and splits, private event results | You only |
| **While you were away** | A 2–4 line summary of what changed since your last visit, shown at the top of the screen | You only |
| **End-of-game reveal** | Every role; every player's real room and split for each round; every stash over time; every ability used | Everyone, after the game ends |

The end-of-game reveal works like a timeline you can scrub through, round by round, so the group can relive the big moments ("you were in the Vault in round 4?!").

---

## 14. Notifications

- A round has resolved, with a short summary.
- One hour left to submit your move (scaled down for short games).
- A meeting has been proposed, scheduled, is starting in 10 minutes, or is open.
- Someone called an emergency meeting.
- You were shaken down, or someone else was, and what they had.
- A checkpoint was made or missed.
- The game is over and the reveal is ready.

Notifications respect the host's quiet hours.

---

## 15. Host controls

- Setup: session length, job, role pool, unique roles (on by default, §8.1), saboteur setting (the Mole setting, §8.1), events on or off, vote visibility, meeting window length, quiet hours, starter mode. Defaults: events on, Mole "maybe", the full role pool.
- During the game: pause or resume, extend the current round, replace an inactive player with a bot (offered automatically after 2 missed rounds in a row), add bots to empty seats before the game starts.
- Before the start, the host can hand the host role to another person in the lobby (never a bot) and then leave; the host can't leave without handing over first. *(Owner request, M2-5b.)*

---

## 16. Player-count scaling summary

| Players | Rooms | Dark side (§8.1) | Notes |
|---|---|---|---|
| 2 | 5 | No | Needs bots to vote properly. Without bots, use Duel mode (§16.1). |
| 3–4 | 5 | 3: no; 4: one saboteur | Tight and personal. Every shortfall is easy to narrow down. |
| 5–8 | 7 | 1–2 saboteurs, 0–1 accomplices | The sweet spot. |
| 9–12 | 9 | 1–3 saboteurs, 0–2 accomplices | Chaotic. Lots of witnesses and lots of alliances. |

### 16.1 Duel mode (exactly 2 humans, no bots)

There are no votes. Instead, once per act, each player can **call out** the other. If the opponent pocketed anything during that act, the caller takes everything the opponent pocketed that act. If not, the caller pays them 5 × the act number. Checkpoints and Heat work as normal.

*Duel mode (provisional, task 15):*
- A host setting, valid only with exactly 2 players. No meetings, no emergency meetings and no votes; the meeting-only roles (Smooth Talker, Muscle, Priest, Snitch, Detective) are never dealt. Events can be on.
- **Timing:** a call-out can be made while any of the act's rounds is being planned, at most once per player per act, and can't be withdrawn. It stays private until the act's last round resolves and its alibi window closes (§5.4); then every call-out of that act is settled (in seat order if both called), and the checkpoint is checked straight after, with no meeting (§11.4 order: call-outs → checkpoint). So a call-out covers the whole act, the last round included, however early it was made.
- **Caught:** the caller takes everything the opponent pocketed that act (their real splits, whatever they claimed), out of the opponent's stash: never the Fence safe, and never more than the stash holds. The Haul is untouched.
- **Wrong call:** the caller pays the opponent 5 × the act number (content: `duel.wrongCallOutPerAct`) from their own stash, never more than it holds.
- The result is public: who called, whether the opponent had pocketed, and how much moved. A Heat raid in the act's last round ends the game before its call-outs are settled.

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

Under the hood, each bot keeps a **suspicion score** for every other player, updated from shortfalls, alibis, witness sightings, its own powers and perks (an Audit, a Detective check, a Peek), and role claims (a claim it knows is false, a role claimed twice, a changed claim). It votes when one player's score passes its threshold. At a vote it misjudges like people do: a small misreading of its own plus a hunch the whole crew shares at that meeting, which can carry a majority to a clean player (this keeps shakedown accuracy near the 50–70% target). Bots communicate only through alibis and role claims (§12.1): crew bots tell the truth when accused, dark bots bluff a hard-to-disprove crew role nobody has claimed (docs/roles-v2.md §4). They back meeting times people propose and only propose one themselves late in the act (§11.1).

### 17.4 Simulator

A command-line tool that runs batches of all-bot games:

- **Inputs:** player count (2–12), mix of bot personalities, job, role pool, config overrides, number of games, seed.
- **Outputs:** CSV/JSON results and a summary report.

**Balance metrics and rough targets:**

| Metric | Target |
|---|---|
| Heist success rate (normal mixes) | 55–70% |
| Heat-bust rate | 10–20% of failures come from Heat |
| Pocketing vs. honest | Moderate pocketing should win more often than pure honesty. Heavy pocketing should lose more often than it wins. |
| Shakedown accuracy | 50–70% of shakedowns catch a real cheater |
| Role win rates | Each role within ±5 percentage points of its fair share (1 ÷ crew size) |
| Mole win rate (when present) | 30–40% |
| Comeback rate | The leader after Act 1 wins less than 50% of the time |
| Decided early | Less than 15% of games are effectively settled before Act 3 |

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
