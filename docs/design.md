# Skimjob — Game Design (R7 rules spec)

*The single rules spec for R7 Simplified, frozen in step S1 (4 Nov 2026) from the owner-approved plan (`docs/simplified.md` Part A, with the owner's 4, 6 and 7 Nov decisions). The plan and its run method stay in `simplified.md`; the reasons behind each choice are in `docs/decisions.md`. Numbers marked **[tunable]** are starting values for the simulator; the content package (`packages/content`) holds them, and the S5 balance pass (§21) sets them. Calls marked *provisional* are PM or builder readings for the owner to confirm. Tests cite sections as `// design §5.3`.*

---

## 1. Overview

**Pitch:** *Steal from your crew — just don't sink the job.*

Skimjob is a social deduction heist game for groups of friends, in a browser (and later an Android/iOS app). A crew robs one bank together over a session the host sets, from 15 minutes to a week. Each round every player secretly picks a room, grabs coins there (more coins ring more of the room's alarm bell) and drags each coin into the **crew duffel** or **their own pocket**. The duffel is split equally among everyone; the pocket is yours alone. If too much goes missing the heist fails and nobody wins; otherwise the biggest stash wins (every tie for it too), or the whole crew together if every stash is equal.

- **Players:** 3–12; bots fill empty seats. Best at 4–8.
- **Session length:** set by the host, 15 minutes to 1 week (§17). The rules are the same at every length; only the pace changes.
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
| **Duffel** | The crew bag being split: this round's hand-ins, the kitty, and any coins set aside for this split. Split equally every round (§7). |
| **Set aside** | Coins returned by a shakedown or the Priest wait in the duffel for the **next** split, never one already under way (§7.1). |
| **Share** | Your equal cut of every split so far (the fair share): the same for everyone, and public. One round's split gives each player **this round's cut**. |
| **Pocket** | Coins a player skimmed: theirs alone. |
| **Stash** | A player's private total: share + pocket − coins taken back − perks bought (§7.6). The biggest stash wins. |
| **Kitty** | Leftover change from a split that didn't divide evenly, carried into the next split. |
| **Missing** | Coins taken this round that didn't reach the duffel: "N coins went missing", never who (§7.4). |
| **Honesty** | Coins that reached the duffel ÷ coins taken from the bank, shown as a meter against the two-thirds line (§7.5). |
| **Bell** | Each room's alarm bell: 4 bulbs [tunable] (§5). |
| **Ring** | One noisy coin; it lights one bulb. |
| **Raid** | The police hitting one room when its last bulb lights (§5.3). |
| **Taped off** | A raided room, closed for 2 rounds [tunable]. |
| **Wanted** | Up to 3 sheriff stars; +1 per raid (§5.4). |
| **Bust** | Wanted reaches 3: the whole heist fails at once (§5.5). |
| **Rooftop escape** | On a bust, only the players on the Rooftop that round get away (§5.5). |
| **Meeting** | A vote on a shakedown: regular, police briefing or emergency (§9). |
| **Shakedown** | Opening one player's stash and setting what's above the share aside for the next split (§9.6). |
| **Protected** | A player a shakedown passed against: no shakedown can target them again until the next regular meeting (§9.7). |
| **Plan board** | The shared, non-binding board for planning each round (§10). |
| **Lead** | One case-board entry that combines the facts about one thing in one round (§15.4). |
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
3. **Split your coins in secret:** each coin goes into the duffel or your pocket.
4. Optionally **use your role's power** (§11) and **one perk** (§12).
5. **Lock in.** A move can be changed until the round ends.

- **A short bank** *(owner, 6 Nov)*: when the bank can't cover every grab, coins are handed out one at a time, round-robin, from a seeded random seat, until the bank is empty. A grab that is cut loses its pocket-bound coins first, then its duffel-bound ones. Rings count the coins actually grabbed. When the **maximum** possible grabs (every player's highest grab, from public information) add up to more than the bank holds, the preview says "the bank may run short this round".
- A move in a coin room asks for at least 1 coin (a short bank can still leave it with 0, as above).
- **No room has a visitor limit,** the Rooftop included: a limit would reveal secret moves ("the Office is full") and reward whoever locks in first.

### 3.3 Missed move

A player who hasn't locked in when the round's deadline passes plays the **Lobby, 1 coin, handed in**. A missed move never shows as locked in *(owner, 6 Nov)*. If the Lobby is taped off (§5.3), the player **sits the round out**: in no room, grabbing and ringing nothing, and not on the Rooftop, so not escaping a bust (§5.5) *(owner, 7 Nov)*.

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
5. **Split** (only if no bust): first the Priest's absolve resolves (§11.1; its coins are set aside for the next split, not this one), then the duffel is split equally; the leftover change is the kitty (§7.2).
6. **Cooling:** every room turns off 1 bulb, then each Rooftop player cools the hottest room by 1 more (§5.6).
7. **Information goes out:** who was in your room, Security and power results, the round summary (taken, duffel, missing, honesty, share), raids and Wanted.
8. **End check:** bank empty or round cap reached (§6.2). If the game ends, nothing below runs.
9. **Meeting check** (only if the game goes on): a police briefing after a raid; a regular meeting when the bank passes a third (§9.1).
10. **Result window** (only if the game goes on, after any meeting from step 9 closes): any player may spend an emergency from the crew's pool (§9.3) before the next round's planning starts.

Raids come before cooling, so the Rooftop can't save a room in the same round, and the bell preview stays exact (unless the bank runs short, §3.2).

---

## 5. Bells, raids, Wanted and the bust

### 5.1 Bells

Every room has an **alarm bell with 4 bulbs** [tunable]. Every bell is **public**, always, with two exceptions: a room the Hacker hides this round (§11) shows "?" to everyone else, and a taped-off room's bell is off (§5.3).

### 5.2 Rings

- Each ring lights one bulb in that room; rings from everyone in the room add up.
- Ring counts per coin come from the room's noise (§3.1). The Locksmith's coins each ring one time fewer, never below 0, so a Locksmith's Office or Vault grab is silent *(owner, 4 Nov)*. Soft shoes ring nothing. The Mole adds one ring to any room except the Rooftop or a taped-off room (§11.1).
- **Preview:** while planning, the bell shows the bulbs your own grab would add. Other players' rings are unknown until the round resolves.

### 5.3 Raids

When a room's **4th bulb** lights:
- everyone inside **loses that round's grab**: the police seize it and it leaves the game. Seizure happens **before** the split, so seized coins are never handed in or pocketed;
- the room is **taped off for 2 rounds** [tunable] ("CLOSED 2" counting down): nobody can pick it, and its bell resets to 0 *(owner, 6 Nov)*. While taped off, its bell is **off**: not shown, and nothing can ring it (no grabs; the Mole and the Hacker can't target it). It reappears at 0 when the room reopens, also when the Fixer reopens it early;
- **Wanted goes up 1 star**;
- a **police briefing** is called (§9.2).

### 5.4 Wanted

Three sheriff stars at the top of the screen, public. Wanted never goes down *(owner, 6 Nov: nothing in R7 lowers it)*.

### 5.5 The bust and the Rooftop escape

- **Wanted 3 stars or more** [tunable] is a **bust**: the heist ends at once, before that round's split.
- Only the players **on the Rooftop that round escape**; everyone else is arrested and loses everything.
- **The biggest stash among the escapees wins** (every escapee tied for it), whatever their role (the Mole and Fixer included). Escapees keep only the stash they already had. If nobody was on the Rooftop, nobody wins.
- **What is lost** *(owner, 6 Nov)*: the arrested players' stashes, that round's unsplit duffel and pockets, and the kitty leave the game ("lost in the bust"). The ranking and the reveal still show every stash.
- The Rooftop can't be raided: nothing grabs coins there, and the Mole can't ring it, so a bust always has an escape *(owner, 6 Nov)*.
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

There are no acts, checkpoints or targets. A game that empties the bank early simply ends early. No meeting is held after the last round *(owner, 6 Nov: the end checks run straight after the round)*.

### 6.3 The getaway car

At the end, the kitty and any unsplit duffel pay for the getaway car and leave the game.

---

## 7. Equal shares, the kitty and honesty

### 7.1 The duffel

Each round the **duffel** holds everything handed in that round, plus the kitty, plus the coins **set aside** for this split: those returned by shakedowns and the Priest since the last split. Coins returned during this round's split step (a Priest's absolve) are set aside for the next split.

### 7.2 Split and kitty

The duffel is **split equally among all players**. The leftover change that doesn't divide evenly is the **kitty**, carried into the next split. On a bust there is no split for that round (§4.2).

### 7.3 Share

Each player's equal cut of every split so far (the fair share): the same for everyone, public, shown with every round summary. One round's split adds **this round's cut** to it.

### 7.4 Missing

Each round the summary shows coins taken from the bank, the duffel split, and **"N coins went missing"**, never who.
*Confirmed (owner, 6 Nov):* N = coins taken that round (excluding seized coins) − coins handed in that round, never negative.

### 7.5 Honesty *(owner, 4 Nov)*

- **Honesty = coins that reached the duffel ÷ coins taken from the bank**, over the whole game, shown as a meter against the **two-thirds line**.
- **A coin counts once,** when it first reaches the duffel: handed in, or recovered by a shakedown or the Priest. Coins carried in the kitty or re-split never count again.
- **Seized coins count neither as taken nor as missing.**
- Before any coin has been taken, the meter reads full *(owner, 6 Nov)*.

### 7.6 Stashes

Stashes are **private** (open only in a shakedown and at the reveal).

**Stash = share received + coins pocketed − coins taken back by shakedowns and the Priest − coins spent on perks.**

Seized coins were never pocketed or handed in, so raids subtract nothing.

### 7.7 Conservation

At every point: bank left + the duffel (coins waiting to be split, the kitty and set-aside coins included) + every stash + seized + spent on perks + getaway car + lost in a bust (§5.5) = starting bank. The engine tests this as a property.

---

## 8. Winning

### 8.1 Success

The heist **succeeds** when the game ends by the bank or the round cap, **honesty is at or above two-thirds**, and there was no bust. Then **the biggest stash wins**: every player tied for it wins (§8.5).

### 8.2 The whole crew wins together

*(Owner, 6 Nov.)* If the heist succeeds and **every stash is equal**, **the whole crew wins together** (everyone is tied for the biggest stash, §8.5). An honest player who bought a perk ends lower and doesn't win.

### 8.3 Bust

Only Rooftop players escape; the biggest stash among them wins (every escapee tied for it, §8.5); nobody on the Rooftop means nobody wins (§5.5).

### 8.4 Sunk by theft

If honesty is **below two-thirds** at the end (bank or round cap), the heist fails: **nobody wins, except the Mole or the Fixer, if one of them holds (or ties for) the biggest stash of all players** (§8.5; §11, their handlers).

### 8.5 Ties

*(Owner, 6 Nov.)* **Everyone tied at the top wins.** There is no tie-break, and a game can have any number of winners.

**Who can win, by ending** (owner rules, §8.1–§8.4):
- **Success:** every player tied for the biggest stash of all players; the whole crew when every stash is equal (§8.2).
- **Bust:** every Rooftop escapee tied for the biggest stash among the escapees, any role (§5.5).
- **Sunk by theft:** every Mole or Fixer holder (each copy under its own handler, §11.3) who holds or ties for the biggest stash of **all** players. A tie with a player who can't win still goes to the Mole or Fixer holders in it. Otherwise nobody.

### 8.6 The ranking

The full ranking by stash is always shown at the end; on a failure it's labelled as a loss unless someone won (§8.3, §8.4).

---

## 9. Meetings and shakedowns

### 9.1 Regular meetings

A regular meeting is held **each time a third of the bank is gone** (after the round in which the bank first drops to two-thirds or below, then to one-third or below, of its start). Only regular meetings **recharge "once between meetings" powers**. If one round crosses both thirds, one regular meeting is held *(owner, 6 Nov)*.

### 9.2 Police briefings

A **police briefing** follows every raid, after that round's resolution. It votes like any meeting but **recharges nothing**. A round with two raids calls one briefing *(owner, 6 Nov)*. If a regular meeting and a briefing fall due after the same round, one meeting is held and it counts as regular *(owner, 6 Nov)*.

### 9.3 Emergency meetings

*(Owner, 6 Nov.)* The crew shares an **emergency pool**: **1** emergency meeting per game for 3–6 players, **2** for 7–12 [tunable, in content by crew size]. It replaces any per-player allowance.
- **Any player** may spend one from the pool, but only in the **result window**: after a round's result is shown (§4.2 step 7, and after any meeting held for that round) and before the next round's planning starts. Not during planning, a meeting or after the last round.
- The emergency opens after a **notice** so players can get online: a server value per preset [tunable], not a host setting *(owner, 6 Nov)*. It recharges nothing, and nothing refills the pool.
- A call **can't be withdrawn**, and the emergency stays spent even if its meeting misses the quorum or the vote passes nobody *(owner, 6 Nov)*.
- **The caller is named** on the public ledger ("B called an emergency meeting"), like a vote, and the pool's count left is public *(owner, 6 Nov: a public act that spends a shared resource, so the crew can weigh it)*.
- *(Owner, 6 Nov.)* The result window lasts a short time per preset [tunable] and is skipped when the pool is empty; only one emergency can be called per window. No round clock runs during it: the next round's deadline starts when the window closes (or when the called meeting closes).

### 9.4 Scheduling and pausing

- Rounds **pause** while a meeting is open (or waiting to open), so nothing resolves mid-vote; only one meeting is open at a time. A meeting stays open through a Bail choice (§9.6).
- In sessions of **3 hours or less**, meetings open automatically for the preset's window (§17.1). In longer ones any player can propose a slot (at most 64 characters); it locks once **more than half of the human seats** back it (the proposer counts; bots' backing doesn't count toward this lock, though bots vote like any player, §9.5). Bots only back proposals, never propose. If nobody locks a slot, the server picks one. With no humans (simulator), a majority of the crew locks it.
- **Window length:** fixed by the preset in automatic presets; in scheduled presets the host picks it within the preset's range (§17.1).

### 9.5 Voting

- Each player votes to shake down one other player, or to skip. You can't vote for yourself or for a **protected** player (§9.7), and you can change your vote until the window closes.
- **To pass**, a shakedown needs at least **half the crew voting** (every seat, bots included; live or sealed ballots) and **more than half of the votes cast** for that target. *(Owner, 6 Nov.)* A skip counts as a vote cast; the Smooth Talker's ballot, a skip included, counts twice. Bots are players and count in both. The tally shown counts one per ballot *(owner, 6 Nov)*.
- **Sealed votes:** a player can leave a vote in advance; it counts in the next meeting that opens and is then used up. A live vote overrides it. A sealed vote naming a player who is protected when the meeting opens counts as a skip *(owner, 6 Nov)*.
- **Vote visibility** is a host setting: *Hidden then revealed* (default: secret while voting, in the ledger afterwards), *Open* (live), or *Secret* (only the tally, ever; the one exception is the **Check ballot** perk, §12).
- Meeting motions register by id (the shakedown is R7's only motion; §19 seam 10).

### 9.6 Shakedown result

- The target's stash is opened and compared with their share. **Whatever is above the share** (the pocketed coins still held) is **set aside** in the duffel for the next split; it counts toward honesty when it lands (§7.5).
- **Coins already spent on perks are gone and are not taken.**
- A target at or below the share is **clean**, and nothing happens.
- The result is public: the target, their stash and how much went back.
- **Bail is a choice** *(owner, 6 Nov)*: when a shakedown passes against a player holding Bail (§12), **before the stash opens** the holder privately chooses:
  - **use Bail:** the shakedown falls through, the stash stays closed, the public ledger says only "a shakedown fell through", and the Bail is spent;
  - **don't use it:** the stash opens as normal and the Bail is kept.
  
  The choice window is short [tunable]; no answer means don't use. Bots decide by their policy (§19.3). The choice is private (it opens at the reveal); only "a shakedown fell through" is public.
- No player is ever eliminated.

### 9.7 Shakedown protection

*(Owner, 6 Nov.)* Once a shakedown **passes** against a player, bailed or not, that player is **protected**: no further shakedown can target them until the **next regular meeting** (§9.1) opens, where they can be voted on again. Police briefings and emergency meetings don't lift it. The protection is public, shown on the player's seat and in the ledger ("protected until the next regular meeting"). It limits only shakedowns: the Priest's absolve (§11.1) still works. A player protected after the last regular meeting (once the bank is at or below one-third) stays protected for the rest of the game.

---

## 10. The plan board

- **A shared board for each round,** open the whole round: a miniature of the bank where anyone drags crew avatars onto rooms ("A → Office"), and each player marks their own spot (✋). Players tap **I agree**; the board shows how many have agreed ("4 of 6 agreed") and each seat shows whether its player has.
- **Claims:** a player's spot is a **room claim**; a **power claim** (a pledge) says where they will use their power ("Hacker → Vault"). The two have their own drawn icons (a door for a room, a bolt for a power). A claim is not a commitment and can be a bluff.
- **The plan ledger:** under the avatars, one short line per player with their claims ("Cleo · Office · Detective → Eli"). It is linked both ways with the board: tapping a line opens that player's pop-up and marks their head on the board; tapping a head opens the pop-up and marks their line.
- **Few words:** labels stay short; explanations sit behind "i" InfoTips (§15.6).
- **Nothing is binding;** breaking the plan is the betrayal.
- **Async-friendly:** the plan persists and can change until the deadline.
- **Bots** take a sensible spot and sometimes break it.
- **The plan is evidence:** when the round resolves, its final plan, its pledges and a compact edit history ("B moved themselves to the Vault 2 minutes before the deadline") go into the log as one public **said** snapshot (§19 seam 5), read by bots, the case board and the reveal.
- **Build:** the live board runs server-side like chat (fast updates, not in the game log); only the per-round snapshot enters the engine.
- **The channel:** over the game socket every seat gets the whole board live. Two things stay apart: the **proposed plan** (any seat may put any crew avatar, bots too, on a room or take it off) and each seat's **own claims** (room claim, optional power claim, agree), which only that seat sets. A room claim names a room in play; a power claim names a role with a targeted power and a room in play or another player (any role: it may be a bluff). The board takes edits from the round's start until the round resolves, the span of its deadline, but not past the deadline itself; after that it stays as it was until the next round starts a fresh, empty one. Each effective edit is also kept in a compact, bounded history (who moved whom or what, when, and how long before the deadline) for the round's snapshot. Rate-limited per seat. Nothing on it is private.

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
| **Hacker** | Shadows | One open room's bell is hidden from everyone this round (it shows "?"); not a taped-off room. | Once between meetings |
| **Electrician** | Shadows | Black out one room next round: nobody there sees who else is there, and its cameras are offline. Its bell still rings. A cut on Security takes Security's own cameras offline too, so a watcher there sees nothing *(owner, 8 Nov)*. Announced at the start of that round as "Power cut in the Office", with no source. | Once between meetings |
| **Priest** | Eyes | Secretly absolve one player: whatever they hold above their share is set aside in the duffel for the next split (coins spent on perks are not taken). The Priest learns how much. Not the same player twice in a row; the absolved player is told "your sins were absolved". | Once between meetings |
| **Mole** | Shadows | Secretly ring any room once, except the Rooftop or a taped-off room (a police tip-off). Wins a heist sunk by theft if theirs is (or ties for) the biggest stash of all players. | Once between meetings |
| **Fixer** | Shadows | Tear the tape off a raided room and reopen it from next round. Wins a heist sunk by theft if theirs is (or ties for) the biggest stash of all players. | Once per game |

*Readings (owner, 6 Nov):* the Hacker sees the real bell; the hidden bell reappears when the next round starts, and a raid is always public. The Mole's ring is applied at step 2 of §4.2, can cause a raid, shows as an ordinary ring, and can't target the Rooftop (§5.5) or a taped-off room (§5.3). A Lookout's or Security's look into a blacked-out room shows nobody. No power or perk can target yourself; a player put on a feed by Plant evidence still shows in their real room too.

*The Priest* *(owner, 6 Nov)*: the target is chosen while planning and resolved at the split step (§4.2 step 5) of that round, after this round's pocketing and purchases, against their share **before** this round's split. The returned coins are **set aside** in the duffel for the next split, not this one, and earn honesty credit when they reach it; in the last round they join the kitty and go to the getaway car (§6.3). **On a bust the absolve never resolves** (a bust skips the split step): the target keeps their whole stash (an escapee keeps it for the win) and the Priest's use is still spent.

### 11.2 The frequency rule

- Powers that only **narrow suspicion** are **every round**.
- Powers that can **prove theft or open blind spots** are **once between meetings** (recharged only by regular meetings, §9.1). The first stretch runs from the start of the game.
- A **big swing** is **once per game**.

### 11.3 Dealing

- **Every player gets a role** *(owner, 6 Nov)*: the roles dealt equal the number of players (3–12), with the counts by crew size read from content (§19 seam 8). There is no plain crew.
- **Any role may repeat:** up to 10 players get 10 distinct roles at most (one each); at 11–12 players the extra seats get a repeated role, any role (the Mole and Fixer included), with **at most two copies** of a role.
- Every role, the Mole and Fixer included, is dealt at **random** with the seeded RNG, within the **eyes/shadows balance**: a deal has roughly equal numbers of each (they differ by at most one).
- **Copies are separate holders:** each holder has their own uses and their own "once between meetings" or "once per game" charge (§19 seam 9, per holder); the Priest's "not the same player twice in a row" is per Priest; each Mole or Fixer copy wins under its own handler (§8.4, §8.5). Two copies acting on one target in one round: §11.4.
- Roles are **secret**; holding a role is an event in the log (§19 seam 9). The game shows a **role list** per host setting: *Exact* (default: the roles dealt, with counts, e.g. "Lookout ×2"), *Possible* (the pool), or *Hidden*.
- **Claims:** a player can formally claim a role ("I'm the Lookout"), true or a bluff, as a **said** entry in the ledger. A claim changes no rule.
- **Alibis** *(owner, 6 Nov)*: a player can post an alibi (a room and a round, "I was in the Office in round 3") as a **said** entry at any time; there is no alibi window. Stamped alibi (§12) checks it.
- **Limits** *(owner, 9 Nov)*: one alibi per player per round, and one role claim per player per stretch (§9.1).
- No role should be so strong or weak that claiming it hurts its holder; §21 gates each role's win rate (per seat holding it, copies included).

### 11.4 Copies acting on the same target

*(Owner, 6 Nov.)* At 11–12 players a role can have two holders (§11.3). When both use their power on the **same target in the same round**, the uses resolve **one after another**, in seat order from a seeded random seat. Effects that add up simply **stack**. A use that then finds nothing left to act on, because the other copy's use this round already did it, **has no effect and is not spent** (the charge stays for later); its holder is told privately "already done this round" (§18). By role:
- **Lookout, Detective, Auditor:** they only learn, so nothing interferes; each holder learns the same result, and both uses count.
- **Locksmith, Smooth Talker:** passive and personal (your own coins, your own vote), so they never share a target; two Smooth Talkers' ballots each count twice.
- **Hacker:** the second Hacker on an already hidden room has no effect and is not spent (it learns the room was already hidden).
- **Electrician:** the second Electrician on a room already blacked out for next round has no effect and is not spent.
- **Priest:** the first absolve takes whatever is above the share; the second finds nothing above it, **learns 0** with "already absolved this round", has no effect and is not spent, and doesn't count toward its "not the same player twice in a row". The target is told "your sins were absolved" once. If the first absolve found nothing either (the target was already clean), the second is an ordinary absolve of a clean player: spent, and it learns 0, like a single Priest's.
- **Mole:** rings stack: two Mole rings on one room are two rings.
- **Fixer:** the second Fixer on a room the first already reopened has no effect and is not spent.

---

## 12. Perks and the black market

- **There are no tokens.** Perks are bought with coins **from your own stash**, which lowers your score. The coins **leave the game** (paid to fixers and cops); buying doesn't change the duffel or honesty.
- **The shop:** each game deals **one perk per tier** (3 items), picked with the game's seed. In Open vote mode the Check ballot is never dealt, since ballots are already public there *(owner, 9 Nov)*. The "This game" rulebook lists only those.
- **Stock** *(owner, 6 Nov)*: each of the 3 items has unlimited stock, and any player may buy any item, again in later rounds.
- **One perk per player per round**, each single-use, bought and used while planning, except **Bail**, the one held item: you keep it until a shakedown passes against you and you choose to use it (§9.6). You can hold only one Bail at a time *(owner, 6 Nov)*. *(Owner, 6 Nov.)* You pay from your stash as it stood at the start of the round; this round's pocket can't pay.
- **Every purchase is logged without a name:** "🛒 Someone bought Soft shoes (2 coins)". A round's purchases are logged together as planning closes, in the black market's order, so neither their order nor their timing shows who bought. Who bought it opens at the reveal.
- **Laundering is allowed:** coins spent on perks can't be taken by a shakedown or the Priest, but they no longer count toward winning.

| Tier | Cost [tunable] | Perk | Effect |
|---|---|---|---|
| 1 | 1 | **Tail** | Next round, also see who was in one extra room. |
| 1 | 1 | **Stamped alibi** | Your real room this round is stamped "verified" in the ledger (only if your alibi is true). |
| 1 | 1 | **Check ballot** | See one player's vote at the next meeting (also in Secret mode). |
| 2 | 2 | **Soft shoes** | Next round, your coins don't ring at all. |
| 2 | 2 | **Blackout** | Next round, one room goes dark: no sightings, cameras offline. Its bell still rings. Announced like a power cut. |
| 3 | 3 | **Bail** | When a shakedown passes against you, you may use it before your stash opens: the shakedown falls through (the ledger says only "a shakedown fell through"). Unused, you keep it (§9.6). |
| 3 | 3 | **Plant evidence** | One player of your choice appears in one room's camera, Lookout and Tail feeds this round. |

---

## 13. Events

From **round 2**, each round has a **4-in-10 chance** [tunable] that one card flips at the start of the round (6 in 10: nothing happens), drawn with the game's seed. *(Owner, 6 Nov.)* The host can turn events off. Every flip draws **at random from the whole deck**, so a card can repeat and the deck never runs out; a card that can't apply (Lockdown with no room to close, Shift change with the Vault taped off) is redrawn, seeded, from the cards that can, so a flip always lands a card *(owner, 8 Nov)*.

| Card | Effect |
|---|---|
| **Lockdown** | One room is closed this round (never the Lobby or the Rooftop). |
| **Shift change** | Vault visitors can grab 1 extra coin this round. |
| **Audit** | Every room shows how many coins reached the duffel from it this round. |
| **Inside tip** | One random player privately learns another player's role (the learner is any player; the player learned is another player). |

---

## 14. Learn the game

**Learn the game** is a single-player guided game (you plus bots), about 5 minutes: a small bank, about 6 short rounds [tunable], a fixed set of roles (Lookout, Locksmith, Detective, Hacker; one per seat, so you plus 3 bots), no shop and no events, with scripted pop-ups and guides at every step. It is a **ruleset and content entry** (§19 seam 3), not engine branches, and it is built as its own PR once the core game works (S4).

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

Each player has a private board: tags (trusted / unsure / suspicious), notes and pins (whole leads or single facts, §15.4). Only they can see it. It lives outside the game log, on the server *(owner, 6 Nov)*.

### 15.4 The case board (the ledger)

- **Evidence only, from your own `viewFor`:** public facts (coins taken, the duffel split, missing, bells, raids, Wanted, purchases, events, emergencies called, who is protected), what you saw or learned (your sightings, Security and power results), what people said (plans, claims, alibis) and what the crew did (votes, shakedowns). Nothing hidden is revealed, only shown better. Coins per room are not public, so the checks below reason from bells and who was there. Lock-in marks, presence and meeting-time housekeeping live on the seats and the meeting panel.
- **Trust levels** (§19 seam 2): **Fact** (from the game), **Seen by you** (you or your power), **Shared evidence** ("from X's case file"), **Said** (a claim, in handwriting).
- **One Leads list, newest first.** A lead combines the facts about one thing in one round: a room (its bell and rings, a raid and what was seized, who you saw, who claimed it, the plan), a meeting (a shakedown result, protection), the black market (an anonymous purchase), missing coins, Wanted rising, the round itself (its event card, a power cut) or the crew (role claims, votes, emergencies called). A lead with a contradiction carries a ⚠. Tapping a lead opens its facts, each with its trust level.
- **⚠ "doesn't add up" warnings, never verdicts.** A contradiction is two facts in your view that can't both be true, judged only from what you can see. Each kind names the players it points at:
  - **Seen elsewhere:** you or your power saw a player in one room, but their plan spot, alibi or claim for that round says another → names that player.
  - **Not seen:** a player claims a room you or your power watched that round, and you didn't see them there → names that player. Skipped for a blacked-out room (its power cut is public, and nobody is seen there).
  - **Changed story:** a player's alibi or later claim differs from their plan spot → names that player.
  - **Too quiet:** a room rang fewer times than the players counted in it (seen there, or claiming it) must ring at the least. The least assumes the best case for each of them: the room's quietest grab, one ring less per coin for anyone who could be a Locksmith (per the role list), and no rings for anyone who could be wearing Soft shoes (any bought the round before). → names every player counted in that room.
  - **Too loud:** a room rang more than the players counted in it could ring at the most (their biggest grabs, with that round's event) → names nobody (an unseen visitor or a Mole's ring); the lead still carries its ⚠.
  - **Over-claimed role:** more players claim a role than were dealt it (with the Exact list; otherwise more than the deal allows) → names every claimant of that role.

  No bell check runs on a hidden bell. A sighting can be planted (Plant evidence), so a warning is never proof. The checks are pure functions over your own view.
- **Pins:** private (§15.3). You can pin a whole lead or a single fact inside it; pins stay across rounds and are listed together under **Pinned**.
- **Players:** a strip of seats, each with their ⚠ count, pin count and your tag; tapping one shows the leads that name them.
- **Suspect card:** names the **most likely liar** with a one-line reason ("Said Security in R4; you saw Dev in the Vault."). When you have **2 or more pins**, it reads only the pinned facts ("from 3 pins"); otherwise all leads. Each player is ranked by the contradictions in those facts that name them, one point each [tunable: a weight per kind of contradiction]; ties go to the player with the most recent contradiction, then to seat order; the reason quotes their most recent one. It never names you, and with no contradiction it names nobody. It uses only your own `viewFor` (public facts, your sightings and your power results), never hidden information, so it is a lead, not proof.
- **While you were away:** a short recap of what changed since your last visit, once.

### 15.5 The reveal

When the game ends, every reveal event opens (§18): every role, every move and split, every stash over time, every power and perk used. The reveal is a timeline scrubbed round by round, replaying each round's plan against what everyone really did.

### 15.6 UI principles

- **One look everywhere:** the hand-drawn notebook style of `docs/ui-style.md`, from the shared kit and `theme.css` tokens only.
- **One screen, no long scroll:** the bank board in the middle (coins, bells, tape, Wanted, the bank pile), a "This round" panel (your move and its preview, the plan board, the event card), and the ledger, chat and rules in tabs or drawers; bottom sheets on phones, three columns on laptops. Checked at 360, 390, 768, 1024 and 1280 px.
- **The move as a picture:** tap coins, drag each into the duffel or the pocket; the bell previews the rings.
- **Info on everything:** one shared `InfoTip` (tap, hover or focus; ≥ 44 px target) on every icon, room, bell, perk, role and meter, with its line from content (§20).
- **"This game" rulebook:** only this game's roles (per the role list), rooms, events and 3 shop items, plus a **Terms** glossary (§20.5), one tap from anywhere.
- **Role icons:** every role has its own drawn icon (Lookout binoculars, Locksmith key, Detective magnifier, Auditor adding machine, Smooth Talker two speech bubbles, Hacker laptop, Electrician plug, Priest praying hands, Mole a mole, Fixer scissors), used everywhere the role appears: role card, roles in play, rulebook, plan-board claims, case board and power buttons.
- **Board motion:** a raided, taped-off room shows a constant siren, and its bell is off until it reopens (§5.3); the Vault door swings slowly shut and open; the Office screen cycles and its desk lamp flicks off and on; a security camera pans across the Lobby. All of it stops under `prefers-reduced-motion` (doors open, lamp on, camera still).
- **Crowded rooms:** avatars shrink to fit their room, so a room holds every visitor (6 of 12 in the Vault).
- **Grab:** the control for choosing your coins is labelled "Grab".
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
| 15 minutes *(provisional: a playtest length kept from R6's Quick timing, docs/cleanup-audit.md note 1)* | 75 s | Automatic, 2-minute window |
| 1 hour | 5 min | Automatic, 3-minute window |
| 3 hours | 15 min | Automatic, 5-minute window |
| 1 day | 2 h | Scheduled by the crew, 5–15 min |
| 3 days | 6 h | Scheduled by the crew, 10–30 min |
| 1 week | 14 h | Scheduled by the crew, 10–30 min |

These are server data, tuned after playtests.

### 17.2 The engine has no clock

The engine knows rounds and phases, not time. The server's scheduler calls `advance()` when a deadline passes (round end, early end, the result window's close, emergency notice, meeting notice, the Bail choice window's close, meeting close).

### 17.3 Deadlines and lock-ins

- A round ends at its deadline, or a short **grace** after everyone has locked in, whichever comes first; changing a move during the grace doesn't restart it. Grace [tunable] *(owner, 6 Nov)*: 15 min 5 s (provisional), 1 h 10 s, 3 h 30 s, 1 d 2 min, 3 d 5 min, 1 w 5 min.
- A missed move is the Lobby, 1 coin, handed in (§3.3).
- **Lock-ins are public** (who has locked in, never what); **presence is public** (online now, or last seen), from the server and never the log. Bots show as bots.

### 17.4 Notifications

A round resolved (with a one-line summary); an hour left to move (scaled for short games); a meeting proposed, scheduled, about to start or open; an emergency called; your Bail choice (to the holder only); a shakedown result; a raid and Wanted; the game over and the reveal ready.

---

## 18. Visibility

Every event has one visibility; `viewFor(state, playerId)` returns only what that player may see.

| Level | Who sees it | R7 contents |
|---|---|---|
| **Public** | Everyone, live | Every bell (except a hidden one, and a taped-off room's, which is off), rings and raids, taped rooms, Wanted, the bank count; each round's taken / duffel / missing / honesty / share / kitty; lock-in marks; event cards; power-cut announcements (no source); anonymous purchases; meeting slots, results and votes (per the visibility setting); shakedown results; "a shakedown fell through"; who is protected (§9.7); emergencies called, with the caller, and the pool left (§9.3); said entries (plan snapshots, pledges, alibis, claims); verified stamps |
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
| Lookout | Each round, also see who was in one more room. | Like everyone: the biggest stash (or a tie for it) on a good heist. | Knows who was where, sometimes a little too well. |
| Locksmith | Each of your coins rings one time less. | Like everyone: the biggest stash (or a tie for it) on a good heist. | A room rang less than its visitors' claims add up to. |
| Detective | Each round, learn how many coins one player grabbed last round. | Like everyone: the biggest stash (or a tie for it) on a good heist. | Knows exact grab counts nobody announced. |
| Auditor | Once between meetings, learn how many coins reached the duffel from one room last round. | Like everyone: the biggest stash (or a tie for it) on a good heist. | Talks about one room's hand-ins with odd certainty. |
| Smooth Talker | Your vote counts twice. | Like everyone: the biggest stash (or a tie for it) on a good heist. | A vote passed with fewer hands than it should have. |
| Hacker | Once between meetings, hide one open room's bell from everyone this round. | Like everyone: the biggest stash (or a tie for it) on a good heist. | A bell shows "?" and someone seems calm about it. |
| Electrician | Once between meetings, cut the power in one room next round: no sightings, no cameras. | Like everyone: the biggest stash (or a tie for it) on a good heist. | A power cut lands where someone wanted no witnesses. |
| Priest | Once between meetings, secretly take back whatever one player holds above their share (not on a bust). | Like everyone: the biggest stash (or a tie for it) on a good heist. | Coins come back with no shakedown. |
| Mole | Once between meetings, secretly ring any room once (not the Rooftop or a taped-off room). | The biggest stash (or a tie for it) on a good heist, or the biggest of all on a heist sunk by theft. | A bell rang more than the people in the room can explain. |
| Fixer | Once a game, tear the police tape off a raided room and reopen it. | The biggest stash (or a tie for it) on a good heist, or the biggest of all on a heist sunk by theft. | A taped-off room is suddenly open again. |

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

### 20.5 Terms and InfoTips

**Terms:** the rulebook's glossary; each line is also the InfoTip wherever its word appears.

| Term | Text |
|---|---|
| Duffel | The crew bag. Split equally every round. |
| Share | Your equal cut of every split so far. |
| Pocket | Coins you skimmed. Yours alone. |
| Stash | Your private total: share + pocket. The biggest wins. |
| Kitty | Leftover change, carried into the next split. |
| Shakedown | A vote that opens one stash; what's above the share goes into the next split. |
| Protected | Shaken down already: safe until the next regular meeting. |
| Wanted | One star per raid. Three is a bust. |
| Raid | The 4th bulb lights: grabs there are seized. |
| Bust | Wanted 3. Only the Rooftop gets away. |
| Honesty | Coins that reached the duffel ÷ coins taken. Line: ⅔. |

**Other InfoTips:**

| Thing | Text |
|---|---|
| Bell | Every noisy coin lights a bulb. Light the 4th and the police raid the room. |
| Bank | Coins left to steal. The game ends when it's empty, or after the last round. |
| Duffel (your move) | Coins here are shared equally by the whole crew. |
| Pocket (your move) | Coins here are yours alone. Nobody sees them, unless you're shaken down or absolved. |
| Missing | Coins taken this round that never reached the duffel. Nobody knows whose. |
| Taped off | A raided room stays closed for a couple of rounds. The sign counts down. |
| Emergency | The crew shares a few emergency meetings. Anyone can call one after a round's result. |
| Plan board | Drag the crew onto rooms. Nothing is binding. |
| I agree | Tap when the plan suits you. Anyone can still break it. |
| Leads | What happened, newest first. ⚠ means two facts don't add up. |
| Pins | Pin a lead or one fact. Only you see your pins. |
| Suspect | Who your facts point at: your pins if you have 2 or more, otherwise every lead. A hunch, not proof. |

---

## 21. S5 balance gates

*Accepted by the owner (6 Nov) as starting targets; the S5 pass tunes the [tunable] numbers against them on the Sim suite workflow. Applies at **3, 6 and 12 players**, standard bot mix, events on, the standard deal and shop. A gate passes or fails only when its whole 95% interval is inside or outside the band; otherwise it's inconclusive (`docs/decisions.md` "Balance").*

| # | Gate | Target | Crew sizes |
|---|---|---|---|
| G1 | **Heist success** (bank or cap, honesty ≥ ⅔, no bust) | 55–70% of games | 3, 6, 12 |
| G2 | **Raids** | 1–3 raids per game on average; at least one raid in 50–90% of games | 3, 6, 12 |
| G3 | **Bust rate** | 8–20% of games | 3, 6, 12 |
| G4 | **Rooftop stalls** (a round with more than half the crew on the Rooftop) | ≤ 15% of rounds; ≤ 10% of games end at the round cap with over a quarter of the bank left | 3, 6, 12 |
| G5 | **Role win rate vs. the cell average** (a role's win credit per seat holding it, so each copy counts separately, ÷ the average win credit per seat in the same cell, a cell being one crew size (and bot mix / events setting), **pooled over all endings**; shared wins split; the split by ending is reported, not gated) | Every role within 0.75–1.33 | 6, 12 (reported at 3) |
| G6 | **Whole-crew wins:** the share of successful games won by the whole crew, every stash equal (§8.2) | 5–20% of successful games | 3, 6, 12 |
| G7 | **Perks don't decide games** | Buyers' win rate ÷ non-buyers' within 0.8–1.25; no single perk's buyers above 1.3× the cell average (pooled over all endings, as in G5) | 6, 12 (reported at 3) |
| G8 | **Sunk by theft** (report only) | Reported, with Mole and Fixer wins in it | 3, 6, 12 |

*Watch in S5:* with the per-coin rule, a Locksmith's grab is always silent, so Soft shoes adds nothing for them; G5 should show whether the Locksmith sits high.

`docs/balance/baseline.json` is refreshed in S5 against these gates.
