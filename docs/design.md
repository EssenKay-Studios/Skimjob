# Skimjob — Game Design Document

**For R6 rules, [`docs/extension.md`](extension.md) is the spec and wins on any conflict; sections here are brought in line as R6a lands.**

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

*(extension.md "Winning and losing", Build notes "Win rule"; R6a.)*

- **One crew, at most one winner** (players still level after the tie-breaks share it). There are no teams or factions.
- **Score** = stash, plus the Fence safe for the Fence, plus the Inside Man's bonus (+1 per 5 loot the Haul ends above the final target). Whole numbers only.
- Every player is ranked by score, then by the **tie-breaks**: fewer shakedowns, then more loot handed in (tracked, revealed only at the end). The **top group** is everyone still level at the top.
- **The heist succeeds** if, after the final meeting, the Haul is at or above the final target and Heat is below 100. The top group wins, whatever their roles.
- **The heist fails** if Heat reaches 100 at any point (a **raid**) or the final target is missed. Nobody wins, except top-group players whose role wins that ending (`RoleDef.winsOn`): Getaway Driver ★ a raid; Embezzler ★ a missed target; Mole ★ and Fence ★ either. A ★ role outside the top group doesn't win.
- **The full ranking is always shown**; on a failure it is labelled as a loss unless someone qualified.
- Roles are read as they are at the end, so a Double-cross (§10) can hand over a failure win.

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
- **Rounds end early once the whole crew has locked in** (owner decision, 2 Nov): the round resolves a short grace period after the last lock-in, or at its deadline if that comes first, so the last player can still change their move. Changing a move during the grace doesn't restart it. *Grace (provisional, `timing.ts`, scaled by TIME_SCALE):* Quick 5 s, 1 hour 10 s, 3 hours 30 s, 1 day 2 min, 3 days and 1 week 5 min. Alibi windows, meeting windows, emergency notices and the Muscle's window always run their full length.
- The host can set "quiet hours", such as midnight to 7am, during which rounds don't resolve and no notifications are sent.
- **Between meetings** (extension.md, owner ruling 2): players see "once between meetings", not "once per act". A stretch runs from the close of one regular meeting (after rounds 3, 6, 9) to the close of the next; uses recharge when that meeting closes, after its vote, shakedown and target check. Emergency meetings never recharge anything. In Duel, a stretch closes when round 3's or 6's call-outs and target check settle. The engine keeps acts internally.
- **Police moments** (§10) run on game time: only while round deadlines run; they freeze during a meeting (including one waiting to open), like rounds. They never get a client-visible timer.

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
| Missed checkpoint | +15 |
| Events | Varies (event Heat × min(1, crew ÷ 5) for crews of 2–4, §10) |
| Police activity (the Mole's tip-off or the hidden background patrol, §10) | +4 × min(1, crew ÷ 5) |

Scaling by fractions of the crew means a crew of 12 and a crew of 3 feel the same pressure when the same *share* of players goes to the Vault.

Each round's room-and-baseline Heat change is rounded to a whole number (halves round up), and Heat never drops below 0, so time on the Rooftop can't be banked ahead. *(provisional)*

**Heat breakdown** (extension.md "What the app works out for you"): each round's public summary (`roundResolved.heatParts`) carries its parts: the baseline (which takes up any rounding), each room that changed Heat, and the event card. Police activity and a missed target are their own public events under the round, so the view's per-round breakdown adds base, rooms, police activity, missed target and events. *(R6a provisional: a missed target sits under the stretch's last round.)*

*Sanity check (placeholder numbers):* the baseline alone adds 36 over 9 rounds. With a quarter of the crew in the Vault every round, total Heat is about 81, which is risky but survivable. With half the crew in the Vault, Heat goes bust unless people spend turns on the Rooftop.

---

## 8. Roles

Every player is dealt **one secret role** at the start of the game. Roles are designed so that **revealing your role is risky**: each one has a weakness once people know about it. Players can claim any role, truthfully or as a bluff. A formal claim (the **Claim** button, §12.1) goes on the public ledger: once per player between meetings, any role the game knows (even one that can't be in this game, so a refusal never hints at the hidden role pool), never in Duel mode. Like an alibi it changes no rule; it is evidence the crew weighs.

**The roles are the 20 of extension.md "Roles"**, with today's powers. R6a changed, for every role: each reward is now **one private token** (§8.3), "once per act" reads **once between meetings** (§4.1), the scoring decimals are gone (§3), and a **temperament tag** (Team player, Wildcard, Lone wolf) replaces the faction. The tag changes no rule. ★ marks the four roles that can also win a failed heist (`RoleDef.winsOn`, §3).

| Tag | Roles | Token trigger (`RoleDef.rewards`) |
|---|---|---|
| Team player | Rookie, Inside Man, Mastermind | The Haul target met at meeting 1 or 2 (the final check ends the game) |
| | Lookout / Auditor / Detective | Someone it saw / a visitor of the audited room that round / a player it checked is caught (shaken down dirty), earlier this game |
| | Snitch | Its secret target is caught (replaces the old +1 ballot weight) |
| | Smooth Talker | Its ballot was for the player then caught |
| | Muscle | Its cancel saved a clean player: a token **and** the power back; a dirty one names it in the ledger |
| | Priest | A blessing pays out (a blessing lasts until the next regular meeting closes) |
| | Bagman | It hands in everything 3 rounds running (meetings don't break the run; the count restarts after each token) |
| | Cleaner | Every 2nd Rooftop round |
| | Fixer | Its save stops a raid (any raid, police activity included) |
| Wildcard | Getaway Driver ★ | Heat first reaches 75 (once per game) |
| | Fence ★ | The safe reaches 10 |
| | Hacker | Its loop hid a visitor who pocketed from a Security watcher of that room |
| | Blackmailer | A vote it stole decides a shakedown (it wouldn't have passed without it) |
| | Forger | Someone it framed is shaken down clean |
| Lone wolf | Mole ★ | Each tip-off, when it lands (§10) |
| | Embezzler ★ | Its first (non-zero) take |

*What changed from role deck v2 (R6a; the sections below were the v2 detail):*
- **No automatic reveals.** Nobody is told anyone else's role or side at the deal or later (no `alliesLearned`, no `roleState.allies`). Roles are learned only by choice: Peek, Inside tip, Detective, the Blackmailer's guess, claims and evidence cards.
- **Rookie** has no multiplier; the **Inside Man** scores +1 per 5 loot the Haul ends above the final target.
- **Mole:** once between meetings, any time (a `useAbility`, not part of the move): the tip-off is queued and **lands at the next hidden police moment** as public "police activity +4", the same as a background patrol (§10). Only the Mole is told it was its own (`tipOffLanded`). A tip-off still queued at the end is lost.
- **Hacker:** a looped room's Security feed reads "camera offline" (`roomWatched.offline`), exactly as a Power cut reads for every feed.
- **Fence:** a shakedown shows the safe but never takes it; the clean check counts it (§11.3).
- **Detective:** "dirty" means at or above the clean line (6), the same number as the shakedown's.
- Minimum crew sizes, Duel exclusions, the Embezzler's take, the Forger's feeds, the Priest's blessing, the Fixer's save (Heat set to 95; it also stops a raid from police activity), the Cleaner's double Rooftop visit and the Getaway Driver's Rooftop that cools nothing are unchanged from the v2 rules (roles-v2.md, the R2–R5 notes in git history).

### 8.1 Dealing roles

*(extension.md "Roles" Decks, "Host settings", Build notes "Tags, decks and dealing"; R6a.)*

- **Decks:** Starter (Rookie, Inside Man, Lookout, Bagman, Cleaner; no events, no shop, no tokens), **Standard** (the default, 11 roles: Lookout, Auditor, Detective, Smooth Talker, Muscle, Cleaner, Hacker, Fence, Getaway Driver, Mole, Embezzler; Rookies fill spare seats) and Everything (all 20). The host can switch roles on or off one by one (the `roles` setting, which replaces the preset when not empty). **Quick games force Starter** with events off.
- **Balanced** (default): a fixed mix per crew size from content (`BALANCED_MIX`: Lone wolves / Wildcards, starting from roles-v2 §3's most-weighted row under the round(n ÷ 3) cap; *R6a provisional: 5–6 players deal 1 / 1*). The rest are Team players; seats the deck can't fill go to Team players, Rookies last. The host can't change the mix.
- **Truly random:** each seat drawn uniformly from the eligible deck, at most one Mole and one Embezzler.
- **Role list shown** (host setting): **Exact** roles dealt (default, `roleListShown`, in content order), the roles that **could** be in the game (Possible), or nothing (Hidden).
- **Dropped:** the saboteur Off / Maybe / On setting and its caps. A stored saboteur field is migrated on read: *Off* becomes the deck with every Wildcard and Lone wolf toggled off; *Maybe* and *On* become the plain deck.
- **Eligibility** is unchanged: Snitch and Detective 4+; Inside Man, Smooth Talker, Muscle and Priest 5+; Blackmailer and Forger 7+; the Mastermind only with events on; meeting roles never in Duel. **Unique roles** (default on): each role at most once. Mole and Embezzler are always at most one each.

### 8.2 Shakedowns and roles

A shakedown reveals a player's **stash**, not their role. Roles only come out at the end, or when a player chooses to say what they are, truthfully or not.

### 8.3 Perks

*Role deck v2 §1 (`docs/roles-v2.md`); R1 builds the vocabulary, R2/R3 give roles the triggers that earn them (`RoleDef.rewards`; R2a: Rookie, Inside Man, Lookout, Auditor, Detective; R2b: Smooth Talker, Muscle, Priest, Bagman, Cleaner, Fixer, Mastermind, §8).*

**Tokens and the shop** (extension.md "Tokens and the perk shop"; R6a). Every role reward is one private **token** (`tokenEarned`). At setup the seeded RNG deals a **shop of three perks**, one per column, public (`shopDealt`): Learn (Peek, Ballot, Tail), Protect (Shield, Alibi, Recharge), Sway (+Vote, Emergency, Rig). Costs are content: Peek and Shield 2, the rest 1. `buyPerk` spends tokens any time (private `perkBought`, nothing shown until the perk is used). Use a perk any time after buying it, **at most one per round** (the automatic Shield and Emergency don't count); unspent tokens are worth nothing. With events off the Sway perk is +Vote or Emergency; **Duel** deals Peek or Tail, Alibi or Recharge, and Rig (events on) or a seeded pick from the undealt Learn and Protect perks. Starter and Quick have no shop and no tokens. Spending a perk is a private `perkUsed`, with `useAbility`; a refused spend keeps it. The Shield is spent by itself.

| Perk | Effect (R1, provisional details) |
|---|---|
| **Peek** | Learn one other player's role, as it is now. Any time. |
| **Shield** | Spent by itself: your next passed shakedown is cancelled. The ledger says only "cancelled", as for the Muscle; a Muscle cancel first keeps the Shield. |
| **+Vote** | +1 ballot weight in the open meeting (once per meeting); counts toward the majority, not the public tally or quorum, like the Smooth talker. |
| **Ballot** | In an open meeting, see one other player's ballot live, as it changes, in your own view only (never in an event). **Works in Secret mode too** (owner decision on role deck v2: the one exception to secret ballots, §11.2). Refused in Open mode, where ballots are public. |
| **Tail** | While planning, also see who is in one more room when the round resolves (like the Lookout; a Power cut blinds it, a camera loop doesn't). |
| **Alibi** | Your posted alibi for the latest resolved round, if it is true, is stamped **Verified** in public (`alibiVerified`). A false alibi can't be stamped. One stamp per player per round. |
| **Recharge** | One used-up use of your power between these meetings comes back, or a once-per-game use (Muscle). Refused if nothing is used. |
| **Emergency** | *(R2b, the Smooth Talker's reward)* Spent by itself: once your own emergency meeting is used, calling another spends it. |
| **Rig** | Draw two different cards for the next round (events on); the first flips unless you pick the other, until that round starts. Another player's Rig of the same round never refuses yours (a refusal would hint at who holds what); if several players rig a round, the oldest Rig's pick flips. |

- **Shakedown window:** opens after every passed shakedown when a Muscle is dealt or the Shield is in the shop (Exact role list; otherwise when a Muscle could be dealt), so it never shows more than the public list does (§11.3).
- **Double-cross** (§10): tokens, perks and a spent Tail stay with the player *(provisional)*.

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
| **Quiet night** | Heat −10. |
| **Shift change** | The Vault yields double this round, and its Heat pressure is ×1.5. |
| **Power cut** | No witnesses and no cameras this round. Nobody sees anybody. |
| **Payday** | The Lobby yields 4 this round. |
| **Lockdown** | One random room is closed this round. |
| **Audit** | This round's shortfall is shown **per room** ("the Vault came up 4 short"). |
| **Raid rumour** | The player with the biggest stash secretly loses 3. Only they are told. |
| **Inside tip** | One random player privately learns another player's role. |
| **Double-cross** | Two random players are offered a role swap. It happens only if both secretly accept. |

**Police activity** (extension.md "Situations", Build notes "Police activity"; owner, 3 Nov, option A): the Police patrol is no longer a card. When a Mole could be in the game (dealt, with the Exact list; in the eligible deck otherwise), the engine draws a hidden schedule of **police moments** from the seeded RNG (reveal-only `policeScheduled`): each gap is uniform in [0.5, 1.5] × the preset's round length (planning plus alibi window), in game time (§4.1), and each moment brings a background patrol with chance 1 in 4 (content `POLICE_ACTIVITY`). At most one activity per moment: a queued Mole tip-off takes the next free moment and replaces a patrol drawn for it. Either way the crew sees one public `policeActivity` (+4 × min(1, crew ÷ 5), no source) with an immediate raid check; the Mastermind doesn't foresee it. The server fires moments with `advance { policeMoment }` and never exposes a timer for them; the simulator takes one moment per round. *(R6a provisional: moments are refused while a meeting is open; the server freezes them then.)*

A **Power cut** blinds every feed, which reads "camera offline", the same as a Hacker's loop reads for one room.

*Events deck (provisional, task 14):*
- The deck holds one of each card; every flip from round 2 draws from the **full deck**, so cards can repeat *(owner answers, 1 Nov)*. Events are a host setting (§15), off in starter mode.
- **Event Heat for small crews:** a card's Heat (Quiet night; police activity likewise) and the extra Heat of a surge (Shift change's ×1.5 beyond ×1) are scaled by **min(1, crew ÷ 5)**, rounded, so at 3 players Quiet night removes 6. From 5 players cards play at full strength. *(Owner answers, 1 Nov.)*
- The card is flipped as the round starts, so players can plan around it; its effects apply when the round resolves (§5.2 step 1). Lockdown names its closed room on the flip (any room but the Lobby, where missed moves go). Double-cross offers go privately to the two players on the flip, and each can accept or decline until the round deadline; the swap happens at step 1, so the new roles play that round. Each role card keeps its uses so far; Moles are told if their fellow Mole changed.
- **Shift change** also raises the Vault's Heat pressure ×1.5 (balance pass 2; was ×2); **Payday** doubles the Lobby's loot (2 → 4).
- **Power cut:** no room-mates, no Security and no Lookout results. The Server room still counts pockets.
- **Audit:** every room in play is listed with what it came up short (0 included).
- **Raid rumour:** compares stashes, not the Fence safe (which it never touches); ties are broken at random; with every stash empty nobody is hit. The lost loot is gone.
- **Inside tip:** the tip is a player's current role.

---

## 11. Crew meetings and voting

### 11.1 Scheduling

- **Regular meeting:** each act has one meeting, which must take place before that act's checkpoint. Any player can propose a time, and it's locked in once a majority of the **people** (human players) accepts; bots' backing doesn't count toward the lock (owner decision, 2 Nov). With no people at all (simulator, all-bot tests), a majority of the crew locks it. Bots never propose a time, they only back existing proposals. If nobody schedules one by the act deadline, the server picks a time.
- **Emergency meeting:** each player can call **one** emergency meeting per game, at any point. Others are notified and it opens after a short notice period that the host sets.
- **Window length:** set by the host, from 5 to 30 minutes.

*Meeting timing (provisional):* the act's slot can be proposed and locked in at any time during the act (the proposer counts as accepting, so one person in a crew of bots locks a slot by proposing it; a majority is more than half the crew's people), but the meeting only **opens after the act's last round has resolved**: rounds 1–3, then the Act 1 meeting, then checkpoint 1. An emergency meeting can open mid-act; rounds pause while any meeting is open, and only one meeting is open at a time. Only one emergency meeting can be waiting to open at once.

### 11.2 Voting

- During the window, each player either votes for one player to be shaken down or votes to skip.
- **Vote visibility** is a host setting:
  - *Hidden then revealed* (default): nobody can see votes while they're being cast, and everyone's votes go into the ledger afterwards.
  - *Open*: votes are visible as they're cast.
  - *Secret*: only the tally is ever shown, even at the end-of-game reveal. The one exception is the **Ballot** perk (§8.3): its holder sees one chosen ballot, live, in their own view only (owner decision on role deck v2).
- **Players who can't make it** can leave a sealed vote in advance. Otherwise they count as abstaining.
- **To pass**, a shakedown needs **more than half of the votes cast**, and at least half the crew has to take part (sealed votes count).
- **One rule for every crew size** (extension.md; R6a dropped the ⅓ plurality rule for 9–12).
- When the window closes, the ballots are cleared from the screen. The **result** stays in the ledger permanently.

*Smooth talker (provisional):* "more than half of the votes cast" counts the Smooth talker's ballot twice; "at least half the crew has to take part" counts people. The tally shown counts one per ballot (see §8).

*Ballots (provisional):* you can't vote to shake yourself down, and you can change your vote until the window closes. A sealed vote counts in the **next meeting that opens, regular or emergency**, and is then used up; sealing again replaces it, it can't be withdrawn, and a player who turns up can override it with a live vote.

### 11.3 Shakedown results

- The target's stash is revealed to everyone and goes into the Haul. A Fence's safe is shown too, but not taken.
- **Clean line (fixed, extension.md "Shakedowns"):** if the stash **plus any Fence safe** is under **6** (content `shakedown.cleanBelow`, shared with the Detective's "dirty" line), the target is declared clean and the crew pays them **8** (`shakedown.payout`) out of the Haul, so false accusations hurt everyone. *(Provisional: never more than the Haul holds.)* Every meeting uses the same numbers.
- No player is ever eliminated.
- *Shakedown pause (provisional):* when a Muscle is dealt or the Shield is in the shop (§8.3), a passed shakedown is applied only after a short window in which the Muscle may cancel it (§8); a Shield cancels it when the window ends. The checkpoint (§11.4) comes after that window.

### 11.4 Order at a checkpoint

**Meeting → shakedown applied → checkpoint checked.** At the end of the game, this means the final meeting can still rescue a failing heist by shaking down the greediest player. That stops everyone from grabbing everything in the last round.

### 11.5 Checkpoint targets (cumulative)

| Checkpoint | Target |
|---|---|
| End of Act 1 | 7 × crew size |
| End of Act 2 | 15 × crew size |
| Final | 23 × crew size *(R5; was 24)* |

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
| **Public ledger** | Round summaries (Haul change, Heat), who has locked in a move each round (never the move), events, alibis, meeting times, vote results, shakedown results, checkpoints | Everyone |
| **Case file** | Who you saw in your room, Security/Lookout/Server results, your own moves and splits, private event results | You only |
| **While you were away** | A 2–4 line summary of what changed since your last visit, shown at the top of the screen | You only |
| **End-of-game reveal** | Every role; every player's real room and split for each round; every stash over time; every ability used | Everyone, after the game ends |

Seats also show each person's **presence** (online now, or last seen), from the server and never in the ledger (owner decision, 2 Nov).

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

- Setup (extension.md "Host settings"): session length (default 1 h; Quick forces Starter), deck (Standard default, Starter, Everything) and per-role toggles, deal style (Balanced default, Truly random), role list shown (Exact default, Possible, Hidden), vote visibility, events (on), unique roles (on), Duel with two players, meeting window length, quiet hours. The saboteur setting is gone (migrated on read, §8.1).
- During the game: pause or resume, extend the current round, replace an inactive player with a bot (offered automatically after 2 missed rounds in a row), add bots to empty seats before the game starts.
- Before the start, the host can hand the host role to another person in the lobby (never a bot) and then leave; the host can't leave without handing over first. *(Owner request, M2-5b.)*

---

## 16. Player-count scaling summary

| Players | Rooms | Balanced deal (§8.1) | Notes |
|---|---|---|---|
| 2 | 5 | Team players | Needs bots to vote properly. Without bots, use Duel mode (§16.1). |
| 3–4 | 5 | content `BALANCED_MIX` | Tight and personal. Every shortfall is easy to narrow down. |
| 5–8 | 7 | content `BALANCED_MIX` | The sweet spot. |
| 9–12 | 9 | content `BALANCED_MIX` | Chaotic. Lots of witnesses. |

### 16.1 Duel mode (exactly 2 humans, no bots)

There are no votes. Instead, once between meetings (stretches close after rounds 3 and 6, owner ruling 7), each player can **call out** the other. If the opponent pocketed anything during that stretch, the caller takes everything the opponent pocketed. If not, the caller pays them 8 (`duel.wrongCallOut`, the clean payout number). Checkpoints and Heat work as normal.

*Duel mode (provisional, task 15):*
- A host setting, valid only with exactly 2 players. No meetings, no emergency meetings and no votes; the meeting-only roles (Smooth Talker, Muscle, Priest, Snitch, Detective) are never dealt. Events can be on.
- **Timing:** a call-out can be made while any of the act's rounds is being planned, at most once per player per act, and can't be withdrawn. It stays private until the act's last round resolves and its alibi window closes (§5.4); then every call-out of that act is settled (in seat order if both called), and the checkpoint is checked straight after, with no meeting (§11.4 order: call-outs → checkpoint). So a call-out covers the whole act, the last round included, however early it was made.
- **Caught:** the caller takes everything the opponent pocketed that act (their real splits, whatever they claimed), out of the opponent's stash: never the Fence safe, and never more than the stash holds. The Haul is untouched.
- **Wrong call:** the caller pays the opponent 8 (content) from their own stash, never more than it holds.
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
| Heist success rate (owner gate) | 55–70% |
| Heat-bust rate | 10–20% of failures come from Heat |
| Pocketing vs. honest | Moderate pocketing should win more often than pure honesty. Heavy pocketing should lose more often than it wins. |
| Shakedown accuracy | 50–70% of shakedowns catch a real cheater |
| Per-role parity (owner gate) | ≤ 0.10: win credit ÷ (1 ÷ crew size), all 20 roles, Balanced deal, 4–12 players (extension.md Build notes, "Sim") |
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
