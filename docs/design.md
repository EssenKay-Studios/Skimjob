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

- **The heist succeeds** if, after the final meeting, the Haul is at or above the final target and Heat is below 100. Players are then ranked by stash, and the biggest stash wins. Some roles change how they score (see §8). A Mole never wins a successful heist, however big its stash: the biggest stash among the others wins.
- **The heist fails** if Heat reaches 100 at any point, or the final target is missed. Every crew member loses. Roles with a "wins on failure" condition, such as the Mole, win instead.
- **Ties** go to whoever was shaken down fewer times, then to whoever handed in more total loot. The engine tracks that figure but only reveals it at the end. *(Provisional: players still tied on all three share the win.)*
- **Scores:** a Rookie's ×1.2 can give fractions; scores are kept to one decimal place. *(Provisional.)*
- **A failed heist still shows the stash ranking** ("best of the losers"), clearly labelled as a loss. Nobody wins by it; only roles with a wins-on-failure condition win. *(Provisional, §19.1.)*

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
| 9–12 | Everything above, plus **Teller line**: 4 loot. **Manager's office**: 5 loot, adds half the vault pressure. |

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
| Events / Mole tip-off | Varies |

Scaling by fractions of the crew means a crew of 12 and a crew of 3 feel the same pressure when the same *share* of players goes to the Vault.

Each round's room-and-baseline Heat change is rounded to a whole number (halves round up), and Heat never drops below 0, so time on the Rooftop can't be banked ahead. *(provisional)*

*Sanity check (placeholder numbers):* the baseline alone adds 36 over 9 rounds. With a quarter of the crew in the Vault every round, total Heat is about 81, which is risky but survivable. With half the crew in the Vault, Heat goes bust unless people spend turns on the Rooftop.

---

## 8. Roles

Every player is dealt **one secret role** at the start of the game. Roles are designed so that **revealing your role is risky**: each one has a weakness once people know about it. Players can claim any role, truthfully or as a bluff.

| Role | Power | Weakness if revealed |
|---|---|---|
| **Rookie** | No power. Final stash counts ×1.2. | Seen as an easy target to pin blame on. |
| **Lookout** | Each round, also sees who was in one extra room. | People lie around them more carefully, or try to frame them. |
| **Hacker** | Once per act, can **loop the cameras** so one room shows as empty on Security that round. | Every empty camera result looks like their doing. |
| **Fence** | Can move up to 5 loot per act into a hidden safe that shakedowns can't touch. | Assumed to be hoarding, so becomes the first shakedown target. |
| **Insider** | Can't pocket loot. Scores 0.3 points for every loot the Haul ends above the final target. | Others pocket more, knowing the Insider will cover the Haul. |
| **Smooth talker** | Their vote counts double. | Others coordinate their votes against them. |
| **Muscle** | Once per game, can cancel a shakedown after the vote passes. | Everyone knows a vote against their friends may get blocked. |
| **Blackmailer** | Once per act, secretly guesses one player's role. If right, steals 3 from that player's stash. | Gets shaken down quickly, and everyone hides their roles harder. |
| **Snitch** | Secretly assigned a target. Gets +10 if that target is shaken down while holding more than the clean threshold. | Their target has a reason to frame them. |
| **Driver** | If the heist fails **because of Heat**, the Driver escapes and wins if they have the biggest stash. | People suspect them of trying to push Heat up. |
| **Mole** *(optional)* | Wins only if the heist fails. Once per act, can **tip off** the cops (+6 Heat, hidden). | Revealed means hunted, and revealing it is rarely worth it. |

*Fence safe timing (provisional):* the safe move is part of the Fence's move and happens after that round's split, so it can include loot pocketed that round; it can't move more than the stash holds.

*Info and vote roles (provisional, task 12):*
- **Hacker:** the loop is part of the Hacker's move and names any room in play. Only **Security** shows it as empty; the Lookout's extra room and room-mates still see who was there.
- **Smooth talker:** the double vote counts toward the majority (§11.2), not toward quorum, which counts voters. The public tally counts one per ballot, so it never points at the Smooth talker; only a result the plain count can't explain shows that one was on the winning side. A sealed vote counts double too.
- **Muscle:** when a vote passes a shakedown, a short **shakedown window** opens before it is applied (§11.3). The Muscle can cancel it then, including a shakedown of themselves. The cancel stays private until the window ends; the ledger then says the shakedown was cancelled, not who cancelled it. The window opens after every passed shakedown whenever the Muscle is in the game's role pool, dealt or not, so it never shows that a Muscle is in the crew.
- **Blackmailer:** the guess is part of the Blackmailer's move. It resolves after that round's splits and Fence safe moves, takes at most what the target's stash holds and never touches the safe. The target is told privately how much was taken, but not by whom; a wrong guess, or a right one on an empty stash, tells the target nothing.
- **Snitch:** the target is drawn at random from the other players at setup. "Holding more than the clean threshold" means the shakedown was **not clean** (stash at least 3 × the act number). The +10 goes into the Snitch's stash, each time it happens, and a cancelled shakedown pays nothing.

*Win-condition roles (provisional, task 13):*
- **Driver:** wins a successful heist like anyone else. On a Heat failure it wins if it tops the whole crew's ranking (score, then the §3 tie-breaks), Moles included. A missed final target gives it nothing.
- **Mole:** wins any failed heist (Heat or target), never a successful one. The tip-off is part of the Mole's move, at most once per act: +6 Heat (balance pass 2; was +10) is added to that round's Heat (after rounding, before the cap), so it only shows as part of the round's public Heat change. Only the Mole is told it happened. Two Moles are told privately at the start who the other is.

### 8.1 Dealing roles

- The roles in play are drawn from the pool according to player count and the host's settings.
- **Mole availability:** none at 2–4 players; optional at 5–8, with a "maybe a Mole" setting where the chance is 50%; at 9–12, 1 or 2 Moles. When there are two, they know each other.
- **Starter mode** (first game in a group): only Rookie, Lookout, Insider and Fence are used, with no Mole and no events.

### 8.2 Shakedowns and roles

A shakedown reveals a player's **stash**, not their role. Roles only come out at the end, or when a player chooses to say what they are, truthfully or not.

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
- The deck holds one of each card; each flip draws from the cards not yet flipped, so no card repeats in a game (8 of the 10 are seen). Events are a host setting (§15), off in starter mode.
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
  - *Secret*: only the tally is ever shown, even at the end-of-game reveal. An Informant role could see the votes in this mode (future role).
- **Players who can't make it** can leave a sealed vote in advance. Otherwise they count as abstaining.
- **To pass**, a shakedown needs **more than half of the votes cast**, and at least half the crew has to take part (sealed votes count).
- When the window closes, the ballots are cleared from the screen. The **result** stays in the ledger permanently.

*Smooth talker (provisional):* "more than half of the votes cast" counts the Smooth talker's ballot twice; "at least half the crew has to take part" counts people. The tally shown counts one per ballot (see §8).

*Ballots (provisional):* you can't vote to shake yourself down, and you can change your vote until the window closes. A sealed vote counts in the **next meeting that opens, regular or emergency**, and is then used up; sealing again replaces it, it can't be withdrawn, and a player who turns up can override it with a live vote.

### 11.3 Shakedown results

- The target's stash is revealed to everyone, and all of it except any Fence safe goes into the Haul.
- **Clean threshold:** if the stash was below **3 × the act number** (3, 6 or 9), the target is declared clean. The crew pays them **5 × the act number** out of the Haul, so false accusations hurt everyone. *(Provisional: never more than the Haul holds.)* An emergency meeting uses the current act's numbers.
- No player is ever eliminated.
- *Muscle window (provisional):* when the role pool includes the Muscle, a passed shakedown is applied only after a short window in which the Muscle may cancel it (§8). The checkpoint (§11.4) comes after that window.

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
- **Evidence cards:** a player can share a **verified** item from their case file into a chat, such as a camera result. The app marks it as genuine. Claims typed in chat, or screenshots from WhatsApp, can't be verified.
- **Alibi button:** posts a formal Alibi to the ledger (§5.4).

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

- Setup: session length, job, role pool, Mole setting, events on or off, vote visibility, meeting window length, quiet hours, starter mode.
- During the game: pause or resume, extend the current round, replace an inactive player with a bot (offered automatically after 2 missed rounds in a row), add bots to empty seats before the game starts.

---

## 16. Player-count scaling summary

| Players | Rooms | Mole | Notes |
|---|---|---|---|
| 2 | 5 | No | Needs bots to vote properly. Without bots, use Duel mode (§16.1). |
| 3–4 | 5 | No | Tight and personal. Every shortfall is easy to narrow down. |
| 5–8 | 7 | Optional / maybe | The sweet spot. |
| 9–12 | 9 | 1–2 | Chaotic. Lots of witnesses and lots of alliances. |

### 16.1 Duel mode (exactly 2 humans, no bots)

There are no votes. Instead, once per act, each player can **call out** the other. If the opponent pocketed anything during that act, the caller takes everything the opponent pocketed that act. If not, the caller pays them 5 × the act number. Checkpoints and Heat work as normal.

*Duel mode (provisional, task 15):*
- A host setting, valid only with exactly 2 players. No meetings, no emergency meetings and no votes; the meeting-only roles (Smooth talker, Muscle, Snitch) are never dealt. Events can be on.
- **Timing:** a call-out can be made while any of the act's rounds is being planned, at most once per player per act, and can't be withdrawn. It stays private until the act's last round resolves; then every call-out of that act is settled (in seat order if both called), and the checkpoint is checked straight after, with no meeting (§11.4 order: call-outs → checkpoint). So a call-out covers the whole act, the last round included, however early it was made.
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

Under the hood, each bot keeps a **suspicion score** for every other player, updated from shortfalls, alibis, witness sightings and evidence cards. It votes when one player's score passes its threshold. Bots communicate only through alibis and simple structured chat lines ("I was in the Office", "I suspect Riya").

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
