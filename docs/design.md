# Skimjob — Game Design (R7 rules spec)

*The single rules spec for R7 Simplified, frozen in step S1 (4 Nov 2026) from the owner-approved plan (`docs/simplified.md` Part A, with the owner's 4 and 6 Nov decisions). The plan and its run method stay in `simplified.md`; the reasons behind each choice are in `docs/decisions.md`. Numbers marked **[tunable]** are starting values for the simulator; the content package (`packages/content`) holds them, and the S5 balance pass (§21) sets them. Calls marked *provisional* are PM or builder readings for the owner to confirm. Tests cite sections as `// design §5.3`.*

---

## 1. Overview

**Pitch:** *Steal from your crew — just don't sink the job.*

Skimjob is a social deduction heist game for groups of friends, in a browser (and later an Android/iOS app). A crew robs one bank together over a session the host sets, from an hour to a week. Each round every player secretly picks a room, grabs coins there (more coins ring more of the room's alarm bell) and drags each coin into the **crew duffel** or **their own pocket**. The duffel is split equally among everyone; the pocket is yours alone. If too much goes missing the heist fails and nobody wins; otherwise the biggest stash wins, or the whole crew together if nobody stole.

- **Players:** 3–12; bots fill empty seats. Best at 4–8.
- **Session length:** set by the host, 1 hour to 1 week (§17). The rules are the same at every length; only the pace changes.
- **Platforms:** the responsive web app is the launch product; native apps come later as thin clients of the same server. A player can switch devices mid-game.

### 1.1 Design principle

No role is good or evil, and nothing pays anyone to be nice. Every player faces the same temptation: hand in or pocket. The players' own attitude makes a crew honest or greedy, and the crew's attitude decides how well everyone does. Roles are tools that can be used either way; perks are for the buyer's own benefit.

### 1.2 Pillars

1. **One simple choice a round:** a room, some coins, two bags.
2. **Everything visible is a thing:** coins, bells, a bank pile, three stars, a meter. No hidden formulas.
3. **Discussion is the game.** The app supplies the facts; the arguing happens in chat, WhatsApp or in person.
4. **Async-first.** A week-long game needs about 15 minutes a day; only meetings ask people to be online together.
5. **Nobody sits out.** No player is eliminated; getting caught costs coins, never the seat.
6. **A big reveal at the end** replays who really did what.

---

## 2. Words

| Word | Meaning |
|---|---|
| **Coin** | The only loot. Every coin comes out of the bank. |
| **Bank** | The fixed pile of coins the crew is robbing (§6). |
| **Grab** | The coins a player takes in their room this round. |
| **Crew duffel** | Where handed-in coins go. Split equally every round (§7). |
| **Pocket** | Coins a player keeps for themselves this round. |
| **Stash** | A player's private total (§7.6). The biggest stash wins. |
| **Crew take** | The coins split this round: hand-ins, coins recovered by shakedowns and the Priest, and the kitty. |
| **Kitty** | What didn't divide evenly; it stays on the table for the next split. |
| **Fair share** | The coins split to each player so far: the same for everyone, and public. |
| **Missing** | Coins taken this round that didn't reach the duffel: "N coins went missing", never who (§7.4). |
| **Honesty** | Coins that reached the table ÷ coins taken from the bank, shown as a meter against the two-thirds line (§7.5). |
| **Bell** | Each room's alarm bell: 4 bulbs [tunable] (§5). |
| **Ring** | One noisy coin; it lights one bulb. |
| **Raid** | The police hitting one room when its last bulb lights (§5.3). |
| **Taped off** | A raided room, closed for 2 rounds [tunable]. |
| **Wanted** | Up to 3 sheriff stars; +1 per raid (§5.4). |
| **Bust** | Wanted reaches 3: the whole heist fails at once (§5.5). |
| **Rooftop escape** | On a bust, only the players on the Rooftop that round get away (§5.5). |
| **Meeting** | A vote on a shakedown: regular, police briefing or emergency (§9). |
| **Shakedown** | Opening one player's stash and putting what's above the fair share back on the table (§9.6). |
| **Protected** | A player a shakedown passed against: no shakedown can target them again until the next regular meeting (§9.7). |
| **Plan board** | The shared, non-binding board for planning each round (§10). |
| **Emergency pool** | The crew's shared emergency meetings: 1 for 3–6 players, 2 for 7–12 [tunable] (§9.3). |
| **Perk** | A single-use item from the black market, paid in coins from your stash (§12). |
| **Event card** | A one-sentence twist that may flip at the start of a round (§13). |

---

## 3. Rooms and coins

### 3.1 The rooms

Each room offers a number of coins **per visitor** per round [tunable]. Visitors don't share a room's limit.

| Room | Coins per visitor | Noise | In play |
|---|---|---|---|
| **Lobby** | 1 | Silent | Always |
| **Office** | 2 | The 1st coin is silent; each extra coin rings once | Always |
| **Deposit boxes** | 2 | As the Office | 5+ players |
| **Manager's office** | 2 | As the Office | 9+ players |
| **Server room** | 2 | As the Office | 5+ players |
| **Vault** | 3 | Every coin rings [tunable: or the 1st is silent; the simulator picks] | Always |
| **Security** | 0 | — Watch one room's cameras: see who was in it this round | Always |
| **Rooftop** | 0 | — Lie low: automatically cools the hottest room (§5.6); the only escape on a bust (§5.5) | Always |

Rooms in play by crew size: 3–4 players 5 rooms; 5–8 players 7 rooms; 9–12 players 8 rooms, so the witnesses per room stay roughly steady.

### 3.2 A move

1. **Pick a room** that is in play and not closed (taped off, §5.3, or locked down, §13).
2. **Grab 1 coin up to the room's limit** (0 in Security and on the Rooftop). Fewer coins mean less noise; the bell previews the rings before you lock in (§5.2).
3. **Split your coins in secret:** each coin goes into the crew duffel or your pocket.
4. Optionally **use your role's power** (§11) and **one perk** (§12).
5. **Lock in.** A move can be changed until the round ends.

- **A short bank** *(provisional, PM, 4 Nov)*: when the bank can't cover every grab, coins are handed out one at a time, round-robin, from a seeded random seat, until the bank is empty. A grab that is cut loses its pocket-bound coins first, then its duffel-bound ones. Rings count the coins actually grabbed. When the **maximum** possible grabs (every player's highest grab, from public information) add up to more than the bank holds, the preview says "the bank may run short this round".
- A move in a coin room asks for at least 1 coin (a short bank can still leave it with 0, as above).
- **No room has a visitor limit,** the Rooftop included: a limit would reveal secret moves ("the Office is full") and reward whoever locks in first.

### 3.3 Missed move

A player who hasn't locked in when the round's deadline passes plays the **Lobby, 1 coin, handed in**. A missed move never shows as locked in *(provisional, builder S1)*.

### 3.4 Who you see

After the round, each player learns **who else was in their room** (none in a blacked-out room, §11, §12). Security shows who was in one chosen room (cameras offline in a blacked-out room). These results are private to the player.

---

## 4. A round

### 4.1 Phases

**Round start** (event card, §13; power-cut announcements) → **Planning** (moves, powers, perks, plan board, chat; until everyone has locked in plus a short grace, or the deadline, §17.3) → **Resolution** (§4.2) → a meeting if one is due (§9) → the **result window**, when an emergency can be called (§9.3) → the next round, or the end (§6.2).

### 4.2 End-of-round order *(owner, 4 Nov)*

1. **Moves resolve:** grabs come out of the bank; powers and perks that act this round apply (Locksmith, Soft shoes, Hacker, Mole's ring, Plant evidence…).
2. **Rings light bulbs:** each ring lights one bulb in its room (§5.2).
3. **Raid check:** every room whose 4th bulb lit is raided: its visitors' grabs are seized, the room is taped off for 2 rounds, and Wanted goes up 1 star per raided room (§5.3).
4. **Bust check:** if Wanted is 3 or more (two raids in one round can jump it), the game ends at once (§5.5); that round's duffel is **not** split.
5. **Split** (only if no bust): first the Priest's absolve resolves (§11.1), then the crew take is split equally; the remainder stays as the kitty (§7.2).
6. **Cooling:** every room turns off 1 bulb, then each Rooftop player cools the hottest room by 1 more (§5.6).
7. **Information goes out:** who was in your room, Security and power results, the round summary (taken, crew take, missing, honesty, fair share), raids and Wanted.
8. **End check:** bank empty or round cap reached (§6.2). If the game ends, nothing below runs.
9. **Meeting check** (only if the game goes on): a police briefing after a raid; a regular meeting when the bank passes a third (§9.1).
10. **Result window** (only if the game goes on, after any meeting from step 9 closes): any player may spend an emergency from the crew's pool (§9.3) before the next round's planning starts.

Raids come before cooling, so the Rooftop can't save a room in the same round, and the bell preview stays exact (unless the bank runs short, §3.2).

---

## 5. Bells, raids, Wanted and the bust

### 5.1 Bells

Every room has an **alarm bell with 4 bulbs** [tunable]. Every bell is **public**, always, except a room the Hacker hides this round (§11): it shows "?" to everyone else.

### 5.2 Rings

- Each ring lights one bulb in that room; rings from everyone in the room add up.
- Ring counts per coin come from the room's noise (§3.1). The Locksmith's coins each ring one time fewer, never below 0, so a Locksmith's Office or Vault grab is silent *(owner, 4 Nov)*. Soft shoes ring nothing. The Mole adds one ring to any room except the Rooftop (§11.1).
- **Preview:** while planning, the bell shows the bulbs your own grab would add. Other players' rings are unknown until the round resolves.

### 5.3 Raids

When a room's **4th bulb** lights:
- everyone inside **loses that round's grab**: the police seize it and it leaves the game. Seizure happens **before** the split, so seized coins are never handed in or pocketed;
- the room is **taped off for 2 rounds** [tunable] ("CLOSED 2" counting down): nobody can pick it, and its bell resets to 0 *(provisional, builder S1)*;
- **Wanted goes up 1 star**;
- a **police briefing** is called (§9.2).

### 5.4 Wanted

Three sheriff stars at the top of the screen, public. Wanted never goes down *(provisional, builder S1: nothing in R7 lowers it)*.

### 5.5 The bust and the Rooftop escape

- **Wanted 3 stars or more** [tunable] is a **bust**: the heist ends at once, before that round's split.
- Only the players **on the Rooftop that round escape**; everyone else is arrested and loses everything.
- **The biggest stash among the escapees wins**, whatever their role (the Mole and Fixer included). Escapees keep only the stash they already had. If nobody was on the Rooftop, nobody wins.
- **What is lost** *(provisional, PM, 4 Nov)*: the arrested players' stashes, that round's unsplit duffel and pockets, and the kitty leave the game ("lost in the bust"). The ranking and the reveal still show every stash.
- The Rooftop can't be raided: nothing grabs coins there, and the Mole can't ring it, so a bust always has an escape *(provisional, builder S1)*.
- So at Wanted 2 every player weighs "keep grabbing, or go up and wait?"

### 5.6 Cooling

At the end of every round, after the split:
1. every room turns off 1 bulb (never below 0);
2. then **each player on the Rooftop automatically cools the hottest room by 1 more bulb**, one after another, each time the room that is hottest at that moment. Ties are broken with the game's seeded randomness. Nobody chooses the room.

### 5.7 Crew size

Bigger crews get more rooms (§3.1). If big crews still get raided too often, the raid line rises behind the scenes [tunable, per crew size]; players only ever see a strip of bulbs.

---

## 6. The bank and the end of the game

### 6.1 The bank

- The bank holds **16 coins per player** [tunable], shown as a pile of money in the Vault art that visibly shrinks. Its count is public.
- Every coin grabbed comes out of the bank, whether it's handed in, pocketed or seized.

### 6.2 How the game ends

The game ends after the round in which:
- **the bank is empty**;
- the **round cap** is reached: **12 rounds** [tunable]; or
- **a bust** happens (§5.5), at once, mid-resolution.

There are no acts, checkpoints or targets. A game that empties the bank early simply ends early. No meeting is held after the last round *(provisional, builder S1: the end checks run straight after the round)*.

### 6.3 The getaway car

At the end, whatever is left on the table (the kitty and any coins waiting to be split) pays for the getaway car and leaves the game.

---

## 7. Equal shares, the kitty and honesty

### 7.1 Crew take

Each round the **crew take** is everything handed in that round, plus coins returned by shakedowns and the Priest since the last split, plus the kitty.

### 7.2 Split and kitty

The crew take is **split equally among all players**. Whatever doesn't divide evenly stays on the table as the **kitty**, for the next split. On a bust there is no split for that round (§4.2).

### 7.3 Fair share

The coins split to each player so far: the same for everyone, public, shown with every round summary.

### 7.4 Missing

Each round the summary shows coins taken from the bank, the crew take, and **"N coins went missing"**, never who.
*Confirmed (owner, 6 Nov):* N = coins taken that round (excluding seized coins) − coins handed in that round, never negative.

### 7.5 Honesty *(owner, 4 Nov)*

- **Honesty = coins that reached the table ÷ coins taken from the bank**, over the whole game, shown as a meter against the **two-thirds line**.
- **A coin counts once,** when it first reaches the table: handed in, or recovered by a shakedown or the Priest. Coins carried in the kitty or re-split never count again.
- **Seized coins count neither as taken nor as missing.**
- Before any coin has been taken, the meter reads full *(provisional, builder S1)*.

### 7.6 Stashes

Stashes are **private** (open only in a shakedown and at the reveal).

**Stash = fair share received + coins pocketed − coins taken back by shakedowns and the Priest − coins spent on perks.**

Seized coins were never pocketed or handed in, so raids subtract nothing.

### 7.7 Conservation

At every point: bank left + table (kitty and coins waiting to be split) + every stash + seized + spent on perks + getaway car + lost in a bust (§5.5) = starting bank. The engine tests this as a property.

---

## 8. Winning

### 8.1 Success

The heist **succeeds** when the game ends by the bank or the round cap, **honesty is at or above two-thirds**, and there was no bust. Then **the biggest stash wins**.

### 8.2 The whole crew wins together

*(Owner, 4 Nov.)* If **nobody pocketed a single coin all game** and the heist succeeds, **the whole crew wins together**; perk spending and clean shakedowns don't matter. Otherwise the biggest stash wins (§8.1). Only stealing and getting away with it separates players.

### 8.3 Bust

Only Rooftop players escape; the biggest stash among them wins; nobody on the Rooftop means nobody wins (§5.5).

### 8.4 Sunk by theft

If honesty is **below two-thirds** at the end (bank or round cap), the heist fails: **nobody wins, except the Mole or the Fixer, if one of them holds (or ties for) the biggest stash of all players** (§8.5; §11, their handlers).

### 8.5 Ties

**Who can win, by ending** (owner rules, §8.1–§8.4):
- **Success:** the biggest stash among all players; the whole crew together if no coin was pocketed (§8.2).
- **Bust:** the biggest stash among the Rooftop escapees, any role (§5.5).
- **Sunk by theft:** a Mole or Fixer holder, only if they hold (or tie for) the biggest stash of **all** players; each copy of the role wins under its own handler (§11.3). A tie with a player who can't win still goes to the Mole or Fixer *(provisional, PM, 4 Nov)*. Otherwise nobody.

**Tie-breaks** *(provisional, PM, 4 Nov)*: among the players who can win in that top group, the one with **fewer shakedowns passed against them** wins (a bailed one, which fell through, doesn't count, *owner, 6 Nov*); players still tied **share the win**. Mole and Fixer holders tied for the biggest stash (two copies of one role included) still go through this, then share.

### 8.6 The ranking

The full ranking by stash is always shown at the end; on a failure it's labelled as a loss unless someone won (§8.3, §8.4).

---

## 9. Meetings and shakedowns

### 9.1 Regular meetings

A regular meeting is held **each time a third of the bank is gone** (after the round in which the bank first drops to two-thirds or below, then to one-third or below, of its start). Only regular meetings **recharge "once between meetings" powers**. If one round crosses both thirds, one regular meeting is held *(provisional, builder S1)*.

### 9.2 Police briefings

A **police briefing** follows every raid, after that round's resolution. It votes like any meeting but **recharges nothing**. A round with two raids calls one briefing *(provisional, builder S1)*. If a regular meeting and a briefing fall due after the same round, one meeting is held and it counts as regular *(provisional, builder S1)*.

### 9.3 Emergency meetings

*(Owner, 6 Nov.)* The crew shares an **emergency pool**: **1** emergency meeting per game for 3–6 players, **2** for 7–12 [tunable, content table by crew size]. It replaces any per-player allowance.
- **Any player** may spend one from the pool, but only in the **result window**: after a round's result is shown (§4.2 step 7, and after any meeting held for that round) and before the next round's planning starts. Not during planning, a meeting or after the last round.
- The emergency opens after a **notice** so players can get online: a server value per preset [tunable], not a host setting *(provisional, builder S1 fix)*. It recharges nothing, and nothing refills the pool.
- A call **can't be withdrawn**, and the emergency stays spent even if its meeting misses the quorum or the vote passes nobody *(provisional, builder S1 fix)*.
- **The caller is named** on the public ledger ("B called an emergency meeting"), like a vote, and the pool's count left is public *(provisional, builder S1 fix: a public act that spends a shared resource, so the crew can weigh it)*.
- *Provisional (builder S1 fix):* the result window lasts a short time per preset [tunable] and is skipped when the pool is empty; only one emergency can be called per window. No round clock runs during it: the next round's deadline starts when the window closes (or when the called meeting closes).

### 9.4 Scheduling and pausing

- Rounds **pause** while a meeting is open (or waiting to open), so nothing resolves mid-vote; only one meeting is open at a time. A meeting stays open through a Bail choice (§9.6).
- In sessions of **3 hours or less**, meetings open automatically for the preset's window (§17.1). In longer ones any player can propose a slot (at most 64 characters); it locks once **more than half of the human seats** back it (the proposer counts; bots' backing doesn't count toward this lock, though bots vote like any player, §9.5). Bots only back proposals, never propose. If nobody locks a slot, the server picks one. With no humans (simulator), a majority of the crew locks it.
- **Window length:** fixed by the preset in automatic presets; in scheduled presets the host picks it within the preset's range (§17.1).

### 9.5 Voting

- Each player votes to shake down one other player, or to skip. You can't vote for yourself or for a **protected** player (§9.7), and you can change your vote until the window closes.
- **To pass**, a shakedown needs at least **half the crew voting** (every seat, bots included; live or sealed ballots) and **more than half of the votes cast** for that target. *(provisional, PM, 4 Nov)* A skip counts as a vote cast; the Smooth Talker's ballot, a skip included, counts twice. Bots are players and count in both. The tally shown counts one per ballot *(provisional)*.
- **Sealed votes:** a player can leave a vote in advance; it counts in the next meeting that opens and is then used up. A live vote overrides it. A sealed vote naming a player who is protected when the meeting opens counts as a skip *(provisional, builder S1 fix)*.
- **Vote visibility** is a host setting: *Hidden then revealed* (default: secret while voting, in the ledger afterwards), *Open* (live), or *Secret* (only the tally, ever; the one exception is the **Check ballot** perk, §12).
- Meeting motions register by id (the shakedown is R7's only motion; §19 seam 10).

### 9.6 Shakedown result

- The target's stash is opened and compared with the fair share. **Whatever is above the fair share** (the pocketed coins still held) goes **back on the table**, to be split next round; it counts toward honesty when it lands (§7.5).
- **Coins already spent on perks are gone and are not taken.**
- A target at or below the fair share is **clean**, and nothing happens.
- The result is public: the target, their stash and how much went back.
- **Bail is a choice** *(owner, 6 Nov)*: when a shakedown passes against a player holding Bail (§12), **before the stash opens** the holder privately chooses:
  - **use Bail:** the shakedown falls through, the stash stays closed, the public ledger says only "a shakedown fell through", and the Bail is spent;
  - **don't use it:** the stash opens as normal and the Bail is kept.
  
  The choice window is short [tunable]; no answer means don't use. Bots decide by their policy (§19.3). The choice is private (it opens at the reveal); only "a shakedown fell through" is public. A bailed shakedown doesn't count in the tie-break (§8.5).
- No player is ever eliminated.

### 9.7 Shakedown protection

*(Owner, 6 Nov.)* Once a shakedown **passes** against a player, bailed or not, that player is **protected**: no further shakedown can target them until the **next regular meeting** (§9.1) opens, where they can be voted on again. Police briefings and emergency meetings don't lift it. The protection is public, shown on the player's seat and in the ledger ("protected until the next regular meeting"). It limits only shakedowns: the Priest's absolve (§11.1) still works. A player protected after the last regular meeting (once the bank is at or below one-third) stays protected for the rest of the game.

---

## 10. The plan board

- **A shared board for each round,** open the whole round: a miniature of the bank where anyone drags crew avatars onto rooms ("A → Office"), and each player marks their own spot (✋). Seats show who has agreed.
- **Pledges:** "I'll use my power on the Vault." A pledge is a claim, not a commitment, and can be a bluff.
- **Nothing is binding;** breaking the plan is the betrayal.
- **Async-friendly:** the plan persists and can change until the deadline.
- **Bots** take a sensible spot and sometimes break it.
- **The plan is evidence:** when the round resolves, its final plan, its pledges and a compact edit history ("B moved themselves to the Vault 2 minutes before the deadline") go into the log as one public **said** snapshot (§19 seam 5), read by bots, the case board and the reveal.
- **Build:** the live board runs server-side like chat (fast updates, not in the game log); only the per-round snapshot enters the engine.

---

## 11. Roles

### 11.1 The roles

Every role has a one-sentence power, a "How you win" line and a "How to spot it" line (§20.2). **Eyes** spot theft; **shadows** make it possible.

| Role | Kind | Power | Frequency |
|---|---|---|---|
| **Lookout** | Eyes | You also see who was in one extra room. | Every round |
| **Locksmith** | Shadows | Each of your coins rings one time fewer (an Office or Vault grab is silent). | Every round (passive) |
| **Detective** | Eyes | Learn how many coins one player grabbed last round (not how many they kept). | Every round |
| **Auditor** | Eyes | Learn how many coins reached the duffel from one room last round. | Once between meetings |
| **Smooth Talker** | Eyes | Your vote counts twice. | Every meeting (passive) |
| **Hacker** | Shadows | One room's bell is hidden from everyone this round (it shows "?"). | Once between meetings |
| **Electrician** | Shadows | Black out one room next round: nobody there sees who else is there, and its cameras are offline. Its bell still rings. Announced at the start of that round as "Power cut in the Office", with no source. | Once between meetings |
| **Priest** | Eyes | Secretly absolve one player: whatever they hold above the fair share goes back on the table (coins spent on perks are not taken). The Priest learns how much. Not the same player twice in a row; the absolved player is told "your sins were absolved". | Once between meetings |
| **Mole** | Shadows | Secretly ring any room once, except the Rooftop (a police tip-off). Wins a heist sunk by theft if theirs is the biggest stash of all players. | Once between meetings |
| **Fixer** | Shadows | Tear the tape off a raided room and reopen it from next round. Wins a heist sunk by theft if theirs is the biggest stash of all players. | Once per game |

*Readings (provisional, builder S1):* the Hacker sees the real bell; the hidden bell reappears when the next round starts, and a raid is always public. The Mole's ring is applied at step 2 of §4.2, can cause a raid, shows as an ordinary ring, and can't target the Rooftop (§5.5). A Lookout's or Security's look into a blacked-out room shows nobody. No power or perk can target yourself; a player put on a feed by Plant evidence still shows in their real room too.

*The Priest* *(provisional, PM, 4 Nov)*: the target is chosen while planning and resolved at the split step (§4.2 step 5) of that round, after this round's pocketing and purchases, against the fair share **before** this round's split. The returned coins go onto **the table** for the next split and earn honesty credit when they reach it; in the last round they join the kitty and go to the getaway car (§6.3). **On a bust the absolve never resolves** (a bust skips the split step): the target keeps their whole stash (an escapee keeps it for the win) and the Priest's use is still spent *(provisional, PM, 4 Nov)*.

### 11.2 The frequency rule

- Powers that only **narrow suspicion** are **every round**.
- Powers that can **prove theft or open blind spots** are **once between meetings** (recharged only by regular meetings, §9.1). The first stretch runs from the start of the game.
- A **big swing** is **once per game**.

### 11.3 Dealing

- **Every player gets a role** *(owner, 6 Nov)*: the roles dealt equal the number of players (3–12), with the counts by crew size read from a content table (§19 seam 8). There is no plain crew.
- **Any role may repeat:** up to 10 players get 10 distinct roles at most (one each); at 11–12 players the extra seats get a repeated role, any role (the Mole and Fixer included), with **at most two copies** of a role.
- Every role, the Mole and Fixer included, is dealt at **random** with the seeded RNG, within the **eyes/shadows balance**: a deal has roughly equal numbers of each (they differ by at most one).
- **Copies are separate holders:** each holder has their own uses and their own "once between meetings" or "once per game" charge (§19 seam 9, per holder); the Priest's "not the same player twice in a row" is per Priest; each Mole or Fixer copy wins under its own handler (§8.4, §8.5). Two copies acting on one target in one round: §11.4.
- Roles are **secret**; holding a role is an event in the log (§19 seam 9). The game shows a **role list** per host setting: *Exact* (default: the roles dealt, with counts, e.g. "Lookout ×2"), *Possible* (the pool), or *Hidden*.
- **Claims:** a player can formally claim a role ("I'm the Lookout"), true or a bluff, as a **said** entry in the ledger. A claim changes no rule.
- **Alibis** *(provisional, builder S1)*: a player can post an alibi (a room and a round, "I was in the Office in round 3") as a **said** entry at any time; there is no alibi window. Stamped alibi (§12) checks it.
- No role should be so strong or weak that claiming it hurts its holder; §21 gates each role's win rate (per seat holding it, copies included).

### 11.4 Copies acting on the same target

*(Provisional, PM, 6 Nov.)* At 11–12 players a role can have two holders (§11.3). When both use their power on the **same target in the same round**, the uses resolve **one after another**, in seat order from a seeded random seat. Effects that add up simply **stack**. A use that then finds nothing left to act on, because the other copy's use this round already did it, **has no effect and is not spent** (the charge stays for later); its holder is told privately "already done this round" (§18). By role:
- **Lookout, Detective, Auditor:** they only learn, so nothing interferes; each holder learns the same result, and both uses count.
- **Locksmith, Smooth Talker:** passive and personal (your own coins, your own vote), so they never share a target; two Smooth Talkers' ballots each count twice.
- **Hacker:** the second Hacker on an already hidden room has no effect and is not spent (it learns the room was already hidden).
- **Electrician:** the second Electrician on a room already blacked out for next round has no effect and is not spent.
- **Priest:** the first absolve takes whatever is above the fair share; the second finds nothing above it, **learns 0** with "already absolved this round", has no effect and is not spent, and doesn't count toward its "not the same player twice in a row". The target is told "your sins were absolved" once. If the first absolve found nothing either (the target was already clean), the second is an ordinary absolve of a clean player: spent, and it learns 0, like a single Priest's.
- **Mole:** rings stack: two Mole rings on one room are two rings.
- **Fixer:** the second Fixer on a room the first already reopened has no effect and is not spent.

---

## 12. Perks and the black market

- **There are no tokens.** Perks are bought with coins **from your own stash**, which lowers your score. The coins **leave the game** (paid to fixers and cops); buying doesn't change the crew take or honesty.
- **The shop:** each game deals **one perk per tier** (3 items), picked with the game's seed. The "This game" rulebook lists only those.
- **Stock** *(provisional, PM, 4 Nov)*: each of the 3 items has unlimited stock, and any player may buy any item, again in later rounds.
- **One perk per player per round**, each single-use, bought and used while planning, except **Bail**, the one held item: you keep it until a shakedown passes against you and you choose to use it (§9.6). You can hold only one Bail at a time *(owner, 6 Nov)*. *Provisional (builder S1):* you pay from your stash as it stood at the start of the round; this round's pocket can't pay.
- **Every purchase is logged at once, without a name:** "🛒 Someone bought Soft shoes (2 coins)". Who bought it opens at the reveal.
- **Laundering is allowed:** coins spent on perks can't be taken by a shakedown or the Priest, but they no longer count toward winning.

| Tier | Cost [tunable] | Perk | Effect |
|---|---|---|---|
| 1 | 1 | **Tail** | Next round, also see who was in one extra room. |
| 1 | 1 | **Stamped alibi** | Your real room this round is stamped "verified" in the ledger (only if your alibi is true). |
| 1 | 1 | **Check ballot** | See one player's vote at the next meeting (also in Secret mode). |
| 2 | 2 | **Soft shoes** | Next round, your coins don't ring at all. |
| 2 | 2 | **Blackout** | Next round, one room goes dark: no sightings, cameras offline. Its bell still rings. Announced like a power cut. |
| 3 | 3 | **Bail** | When a shakedown passes against you, you may use it before your stash opens: the shakedown falls through (the ledger says only "a shakedown fell through"). Unused, you keep it (§9.6). |
| 3 | 3 | **Plant evidence** | One player of your choice appears in one room's camera, Lookout and Tail feeds this round (Tail: *provisional*). |

---

## 13. Events

From **round 2**, each round has a **4-in-10 chance** [tunable] that one card flips at the start of the round (6 in 10: nothing happens), drawn with the game's seed. *Provisional (builder S1):* the host can turn events off; cards are drawn without replacement (each at most once a game), so with about 4–5 flips expected the deck often runs out late in a game, and after that no card flips; a card that can't apply means no event that round.

| Card | Effect |
|---|---|
| **Lockdown** | One room is closed this round (never the Lobby or the Rooftop, *provisional*). |
| **Shift change** | Vault visitors can grab 1 extra coin this round. |
| **Audit** | Every room shows how many coins reached the duffel from it this round. |
| **Inside tip** | One random player privately learns another player's role (the learner is any player; the player learned is another player, *provisional*). |

---

## 14. Learn the game

**Learn the game** is a single-player guided game (you plus bots), about 5 minutes: a small bank, about 6 short rounds [tunable], a fixed set of roles (Lookout, Locksmith, Detective, Hacker; one per seat, so you plus 3 bots, *provisional*), no shop and no events, with scripted pop-ups and guides at every step. It is a **ruleset and content entry** (§19 seam 3), not engine branches, and it is built as its own PR once the core game works (S4).

---

## 15. Lobby, chat, the case board and the reveal

### 15.1 Lobby and sign-in

- **Invite link + nickname** (guests may host), plus **Google sign-in** for a persistent identity, on when the server has Google credentials (details: `docs/decisions.md` "Server and timing"; no email is collected, a player is keyed by Google's stable id).
- The host sets the game up (§16), adds bots to empty seats, can remove any other seat, and can hand the host role to another person (never a bot) before leaving the lobby. A game needs 3+ seats; bots fill the rest.

### 15.2 Chat

- **Crew chat** for everyone; **direct messages** for side deals (that two players messaged is public if the host setting is on, which it is by default; never what they said).
- **Evidence cards:** a player can share an item from their own case file. "Verified" means only that the app really showed it to them; cameras can be tampered with (Blackout, Plant evidence), and every card says so.
- Plain text only, 500 characters, 8 messages per 10 s; bots don't chat. Discussion can happen anywhere (WhatsApp, in person); the ledger keeps the facts trustworthy.

### 15.3 Notes and pins

Each player has a private board: tags (trusted / unsure / suspicious), notes and pinned case-board entries. Only they can see it. It lives outside the game log, on the server *(owner, 6 Nov)*.

### 15.4 The case board (the ledger)

- **Evidence only:** public facts (coins taken, crew take, missing, bells, raids, Wanted, purchases, events, emergencies called, who is protected), what you saw or learned, what people said (plans, pledges, alibis, claims), and what the crew did (votes, shakedowns). Lock-in marks, presence and meeting-time housekeeping live on the seats and the meeting panel.
- **Trust levels** (§19 seam 2): **Fact** (from the game), **Seen by you** (you or your power), **Shared evidence** ("from X's case file"), **Said** (a claim, in handwriting).
- **Three views of the same entries:** Rounds (default; each header reads "Taken · Crew take · Missing · Honesty"), Players (players × rounds) and Rooms (rooms × rounds).
- **⚠ "doesn't add up" flags, never verdicts:** a claim contradicts what you saw; a claim differs from the plan; more claims than a bell allows; a role claimed more often than it was dealt (with the Exact list; otherwise more often than the deal allows, *provisional*). The checks are pure functions over your own view.
- **Dossiers, filters, pins** and a **Full log** tab. Built only from your own `viewFor`: nothing new is revealed, only shown better.
- **While you were away:** a short recap of what changed since your last visit, once.

### 15.5 The reveal

When the game ends, every reveal event opens (§18): every role, every move and split, every stash over time, every power and perk used. The reveal is a timeline scrubbed round by round, replaying each round's plan against what everyone really did.

### 15.6 UI principles

- **One look everywhere:** the hand-drawn notebook style of `docs/ui-style.md`, from the shared kit and `theme.css` tokens only.
- **One screen, no long scroll:** the bank board in the middle (coins, bells, tape, Wanted, the bank pile), a "This round" panel (your move and its preview, the plan board, the event card), and the ledger, chat and rules in tabs or drawers; bottom sheets on phones, three columns on laptops. Checked at 360, 390, 768, 1024 and 1280 px.
- **The move as a picture:** tap coins, drag each into the duffel or the pocket; the bell previews the rings.
- **Info on everything:** one shared `InfoTip` (tap, hover or focus; ≥ 44 px target) on every icon, room, bell, perk, role and meter, with its line from content (§20).
- **"This game" rulebook:** only this game's roles (per the role list), rooms, events and 3 shop items, one tap from anywhere.
- **Teaching pop-ups** ("What just happened / What it means / What you can do") the first time each thing happens, controlled by a per-user **Tips** setting, on by default.
- **Opponents' roles:** the roles-in-play strip opens each role's card, "How to spot it" included; explanations name the candidates ("a room rang with nobody claiming it: the Mole, or someone lying").

---

## 16. Host controls

- **Setup:** session length (§17, default 1 hour), vote visibility (§9.5), role list shown (§11.3), events on/off (§13), DM notices (§15.2), meeting window length (§9.4).
- **During the game:** pause and resume (every clock stops; players can still plan and chat); extend the current round or meeting by a per-preset amount; replace a seat with a bot (Opportunist) after 2 missed rounds in a row (never the host's seat), handed back by the host or the player. Details: `docs/decisions.md` "Host controls" *(owner, 6 Nov)*.
- Quiet hours (no deadlines or notifications at night) come with the mobile apps (M3) and must freeze deadlines.

---

## 17. Session timing

### 17.1 Round length

The server divides the host's session length by the **round cap** (§6.2) to get the round deadline; a game that empties the bank early ends early. Meeting windows pause round clocks, so a game can run a little past its session length.

| Session | Round (cap 12) | Meetings |
|---|---|---|
| 1 hour | 5 min | Automatic, 3-minute window |
| 3 hours | 15 min | Automatic, 5-minute window |
| 1 day | 2 h | Scheduled by the crew, 5–15 min |
| 3 days | 6 h | Scheduled by the crew, 10–30 min |
| 1 week | 14 h | Scheduled by the crew, 10–30 min |

These are server data, tuned after playtests.

### 17.2 The engine has no clock

The engine knows rounds and phases, not time. The server's scheduler calls `advance()` when a deadline passes (round end, early end, the result window's close, emergency notice, meeting notice, the Bail choice window's close, meeting close).

### 17.3 Deadlines and lock-ins

- A round ends at its deadline, or a short **grace** after everyone has locked in, whichever comes first; changing a move during the grace doesn't restart it. Grace [tunable] *(owner, 6 Nov)*: 1 h 10 s, 3 h 30 s, 1 d 2 min, 3 d 5 min, 1 w 5 min.
- A missed move is the Lobby, 1 coin, handed in (§3.3).
- **Lock-ins are public** (who has locked in, never what); **presence is public** (online now, or last seen), from the server and never the log. Bots show as bots.

### 17.4 Notifications

A round resolved (with a one-line summary); an hour left to move (scaled for short games); a meeting proposed, scheduled, about to start or open; an emergency called; your Bail choice (to the holder only); a shakedown result; a raid and Wanted; the game over and the reveal ready.

---

## 18. Visibility

Every event has one visibility; `viewFor(state, playerId)` returns only what that player may see.

| Level | Who sees it | R7 contents |
|---|---|---|
| **Public** | Everyone, live | Every bell (except a hidden one), rings and raids, taped rooms, Wanted, the bank count; each round's taken / crew take / missing / honesty / fair share / kitty; lock-in marks; event cards; power-cut announcements (no source); anonymous purchases; meeting slots, results and votes (per the visibility setting); shakedown results; "a shakedown fell through"; who is protected (§9.7); emergencies called, with the caller, and the pool left (§9.3); said entries (plan snapshots, pledges, alibis, claims); verified stamps |
| **Private** | One player, until the reveal | Your role, move, split and stash; who was in your room; Security, Lookout, Tail, Detective, Auditor and Priest results; Inside tip; perks you hold; your Bail choice; "already done this round" when another copy of your role used it on the same target first (the Priest learns 0, §11.4); "your sins were absolved"; the Hacker's real bell |
| **Reveal** | Everyone, at the end | Every private event: roles, every move and split, every stash over time, every power use (the Mole's ring, the Hacker's hide, Plant evidence), every buyer, every Bail choice; the seed |
| **Secret** | Only the voter, forever | Secret-mode ballots (except one seen through Check ballot) |

Which facts are public is **content** (§19 seam 1): in R7 every fact above is public.

---

## 19. Architecture constraints

### 19.1 The engine

- **Pure, deterministic and event-sourced:** seeded RNG only, no clock, state = fold over the log, numbers and texts in `packages/content`. Same seed + same commands = same game.
- **Visibility-scoped:** `public`, `private:<player>`, `reveal`, `secret:<player>`; `viewFor` returns a deep copy and never leaks. Every new event type gets a leak test.
- **Commands in, events out;** `advance()` names the deadline that passed. Every ending goes through one end-of-game path.
- Dependency direction: `content` ← `engine` ← `bots` ← `sim` / `server`.

### 19.2 Seams for Skimjob Advanced

R7 builds these ten seams (seams, not stub code; `docs/advanced.md` is additive only). Reviewers check them on every S3/S4 PR.

1. **Which facts are public is content.** Bells, the duffel total per round, the bank pile, missing coins and honesty are entries in a content fact catalogue with a visibility (all public in R7); the engine emits each through one helper that reads it.
2. **Case-board trust levels are generic data** ("Fact", "Seen by you", "Shared evidence", "Said"); an entry's level comes from its event's source, with its badge from content.
3. **Rulesets are content.** A game names its ruleset (`simplified`; Learn the game is another); a ruleset only selects content (fact visibility, rooms, roles, perks, events). Engine and UI never branch on its name.
4. **Roles, perks and events register by id:** a content entry plus one handler, **including any role-specific win rule** (the Mole's and Fixer's live in their handlers, not in the end-of-game code).
5. **Player statements are one "said" event type** (plans, claims, alibis, pledges). Advanced's records will be **one generic record command** whose per-role format comes from content, so a new role needs no new command, event type or screen; records show in the case board through seam 2. R7 builds no record command.
6. **Bots read facts only through `viewFor`.**
7. **Holder secrecy and result routing are content settings per role;** R7 builds only "secret holder, private result".
8. **The deal reads its counts from content** (how many roles of which kinds, by crew size, and how many copies a role may have).
9. **Holding a role is an event,** not a setup field; use counts and charges are tracked per role and holder, so two copies of a role never share them.
10. **Meeting motions register by id** (the shakedown in R7).

### 19.3 Bots and the simulator

- **Bots are players:** they get only `viewFor()`, emit the same commands, use their own seeded RNG, and rebuild suspicion from their view each time. Personalities (Honest, Opportunist, Greedy, Cautious, Random; the Mole and Fixer play to their win; each has a Bail-use and an emergency-call policy) are parameter sets in `packages/bots`. Bots use the plan board, claims and alibis; they don't chat.
- **The simulator** (`apps/sim`) runs batches of all-bot games by crew size, bot mix, overrides and seed, and reports the gates of §21 (`docs/testing.md`).

### 19.4 System

One authoritative Node server (engine, event log in Postgres, scheduler, bots, chat, the plan board's live channel) serves the web app, the API and the sockets on one origin. Clients are thin: they read `viewFor` JSON, and the web app imports engine and content for types, names, numbers and texts only.

---

## 20. Content text

One-line texts the UI, the rulebook and the tips read from content, so they never drift. Plain, short and friendly. Numbers in these lines come from content when rendered.

### 20.1 Rooms

| Room | Text |
|---|---|
| Lobby | 1 coin, and not a sound. The safe choice. |
| Office | Up to 2 coins. The first is quiet; the second rings the bell. |
| Deposit boxes | Up to 2 coins. The first is quiet; the second rings the bell. |
| Manager's office | Up to 2 coins. The first is quiet; the second rings the bell. |
| Server room | Up to 2 coins. The first is quiet; the second rings the bell. |
| Vault | Up to 3 coins, and they ring the bell. Big money, big noise. |
| Security | No coins, but you watch one room's cameras and see who was there. |
| Rooftop | No coins. Lie low, cool the hottest bell, and it's the only way out of a bust. |

### 20.2 Roles

| Role | Power | How you win | How to spot it |
|---|---|---|---|
| Lookout | Each round, also see who was in one more room. | Like everyone: the biggest stash on a good heist. | Knows who was where, sometimes a little too well. |
| Locksmith | Each of your coins rings one time less. | Like everyone: the biggest stash on a good heist. | A room rang less than its visitors' claims add up to. |
| Detective | Each round, learn how many coins one player grabbed last round. | Like everyone: the biggest stash on a good heist. | Knows exact grab counts nobody announced. |
| Auditor | Once between meetings, learn how many coins reached the duffel from one room last round. | Like everyone: the biggest stash on a good heist. | Talks about one room's hand-ins with odd certainty. |
| Smooth Talker | Your vote counts twice. | Like everyone: the biggest stash on a good heist. | A vote passed with fewer hands than it should have. |
| Hacker | Once between meetings, hide one room's bell from everyone this round. | Like everyone: the biggest stash on a good heist. | A bell shows "?" and someone seems calm about it. |
| Electrician | Once between meetings, cut the power in one room next round: no sightings, no cameras. | Like everyone: the biggest stash on a good heist. | A power cut lands where someone wanted no witnesses. |
| Priest | Once between meetings, secretly take back whatever one player holds above the fair share (not on a bust). | Like everyone: the biggest stash on a good heist. | Coins come back to the table with no shakedown. |
| Mole | Once between meetings, secretly ring any room once (not the Rooftop). | The biggest stash on a good heist, or the biggest of all on a heist sunk by theft. | A bell rang more than the people in the room can explain. |
| Fixer | Once a game, tear the police tape off a raided room and reopen it. | The biggest stash on a good heist, or the biggest of all on a heist sunk by theft. | A taped-off room is suddenly open again. |

Bust (every role): "On a bust, only the Rooftop gets away."

### 20.3 Perks

| Perk | Text |
|---|---|
| Tail | Next round, also see who was in one more room. |
| Stamped alibi | If your alibi is true, the ledger stamps it "verified". |
| Check ballot | See one player's vote at the next meeting. |
| Soft shoes | Next round, your coins make no sound at all. |
| Blackout | Next round, one room goes dark: no sightings, no cameras. |
| Bail | When a shakedown passes against you, you can make it fall through. |
| Plant evidence | Put one player on one room's cameras this round. |

### 20.4 Events

| Card | Text |
|---|---|
| Lockdown | One room is closed this round. |
| Shift change | Vault visitors can grab 1 extra coin this round. |
| Audit | This round, every room shows how many coins reached the duffel from it. |
| Inside tip | Someone just learned another player's role. |

### 20.5 InfoTips

| Thing | Text |
|---|---|
| Bell | Every noisy coin lights a bulb. Light the 4th and the police raid the room. |
| Wanted | One star per raid. Three stars is a bust: only the Rooftop gets away. |
| Bank | Coins left to steal. The game ends when it's empty, or after the last round. |
| Honesty meter | How much of what was taken reached the table. Below the line at the end, the heist fails. |
| Fair share | What each player has been paid from the table so far. The same for everyone. |
| Kitty | Coins that didn't split evenly. They wait for the next split. |
| Duffel | Coins here are shared equally by the whole crew. |
| Pocket | Coins here are yours alone. Nobody sees them, unless you're shaken down or absolved. |
| Stash | Everything you hold. The biggest stash wins, if the heist holds or you escape a bust. |
| Crew take | This round's coins on the table, about to be split equally. |
| Missing | Coins taken this round that never reached the duffel. Nobody knows whose. |
| Raid | The police hit a room: its visitors lose this round's grab, and Wanted goes up a star. |
| Taped off | A raided room stays closed for a couple of rounds. The sign counts down. |
| Protected | Shaken down already. No new shakedown until the next regular meeting. |
| Emergency | The crew shares a few emergency meetings. Anyone can call one after a round's result. |

---

## 21. S5 balance gates

*Provisional (PM): set in S1 for the owner to confirm; the S5 pass tunes the [tunable] numbers against them on the Sim suite workflow. Applies at **3, 6 and 12 players**, standard bot mix, events on, the standard deal and shop. A gate passes or fails only when its whole 95% interval is inside or outside the band; otherwise it's inconclusive (`docs/decisions.md` "Balance").*

| # | Gate | Target | Crew sizes |
|---|---|---|---|
| G1 | **Heist success** (bank or cap, honesty ≥ ⅔, no bust) | 55–70% of games | 3, 6, 12 |
| G2 | **Raids** | 1–3 raids per game on average; at least one raid in 50–90% of games | 3, 6, 12 |
| G3 | **Bust rate** | 8–20% of games | 3, 6, 12 |
| G4 | **Rooftop stalls** (a round with more than half the crew on the Rooftop) | ≤ 15% of rounds; ≤ 10% of games end at the round cap with over a quarter of the bank left | 3, 6, 12 |
| G5 | **Role win rate vs. the cell average** (a role's win credit per seat holding it, so each copy counts separately, ÷ the average win credit per seat in the same cell, a cell being one crew size (and bot mix / events setting), **pooled over all endings**; shared wins split; the split by ending is reported, not gated) | Every role within 0.75–1.33 | 6, 12 (reported at 3) |
| G6 | **All-honest wins:** the share of successful games in which no coin was pocketed (§8.2) | 5–20% of successful games | 3, 6, 12 |
| G7 | **Perks don't decide games** | Buyers' win rate ÷ non-buyers' within 0.8–1.25; no single perk's buyers above 1.3× the cell average (pooled over all endings, as in G5) | 6, 12 (reported at 3) |
| G8 | **Sunk by theft** (report only) | Reported, with Mole and Fixer wins in it | 3, 6, 12 |

*Watch in S5:* with the per-coin rule, a Locksmith's grab is always silent, so Soft shoes adds nothing for them; G5 should show whether the Locksmith sits high.

`docs/balance/baseline.json` is refreshed in S5 against these gates.
