# Skimjob Extension: simplified rulebook

*2–3 Nov 2026 · Karthik. The single rules spec for the R6 build. It replaces `roles-v3.md` (draft PR #45, closed), keeping its decisions and amending five of them (see "Build notes"). **Approved for build 3 Nov 2026 — owner go-ahead given.** Built as R6a (rules, content, bots), one balance pass, then R6b (UI). [`design.md`](design.md) is brought in line as R6a lands; where they differ, this doc wins. Items marked *provisional* are PM readings that the owner may change. Companion proposal: [`rebuild.md`](rebuild.md).*

## Summary

The Extension is the current game made lighter to learn, without changing how it is built. It includes everything from the roles v3 spec (one crew, failure wins for four roles, no automatic reveals, temperament tags, the two deal modes). The Rebuild is the jobs redesign in [`rebuild.md`](rebuild.md) (not approved, out of scope).

**What changes for players:**

- No acts to learn. The crew meets every 3 rounds, and powers recharge between meetings.
- The Haul target shows as a progress bar to the next meeting.
- Fixed shakedown numbers.
- One voting rule for every crew size.
- No decimal scores.
- A smaller default deck of 11 roles.
- One token currency and a shop of 3 perks, in place of 8 fixed role rewards.
- Sabotage is announced the same way as bad luck.
- The app does the alibi arithmetic.

**What stays:** 9 rounds, rooms, Heat, alibis, all 20 roles and their powers, role claims, chat, evidence cards, no elimination, one winner.

**Cost:** roughly 1,300–1,600 lines of source changed or added, about 7% of the codebase, plus about 1,000–1,500 lines of tests. Most of it fits inside the R6 work that was already planned (R6a rules, R6b UI) and the balance pass that has to run anyway. For comparison, the Rebuild would change about half the code.

## The game in one minute

*Steal from your crew — just don't sink the job.* A crew robs one bank together, and only one of them wins: whoever ends with the biggest stash. If the heist fails, almost everyone loses.

- **Players:** 2–12, with bots to fill seats. Best with 4–8.
- **Where:** in a browser on any device. Talk happens in the in-app chat, on WhatsApp or in person.
- **Each round:** one secret choice: which room to rob, and how much of its loot goes to the crew versus your own pocket.
- **Everyone is one crew.** There are no teams. Everyone has a secret role with its own power. A few roles can also win when the heist fails.
- **Nobody is knocked out.** Getting caught costs loot, never your seat.

**How a game runs:** 9 rounds, with a crew meeting after rounds 3, 6 and 9. The host picks the real-time length (Quick 15 min up to 1 week); only the pace changes.

1. **Setup:** the host invites friends with a link, adds bots, and picks a deck. Everyone is dealt one secret role. Everyone sees which roles are in the game, but not who holds them.
2. **Rounds 1–3**, then meeting 1.
3. **Rounds 4–6**, then meeting 2.
4. **Rounds 7–9**, then the final meeting.
5. **The reveal:** every role, every move, round by round.

## A round, step by step

1. **Plan in secret:** pick a room and a split (how much goes to the crew's Haul, how much to your stash). Some roles also use a power here.
2. **Lock in:** everyone sees that you've locked in, never what you chose. You can change it until the round ends. If you don't move, you go to the Lobby and hand everything in. The round ends early once everyone has locked in.
3. **Resolve:** loot moves, Heat changes, and everyone learns who else was in their room. The public ledger shows how much the Haul grew and the new Heat.
4. **Alibis:** each player may post one ("I was in the Office"). It can be a lie, but it must name a room in play. Not posting one looks suspicious.
5. **Claim a role (optional):** once between meetings you can publicly claim a role, truthfully or as a bluff.

**What the app works out for you.** Players do the guessing, not the arithmetic.

- **The gap box:** once alibis are in, the app adds them up and compares the total with the Haul. For example: "Alibis say +14, the Haul grew 9: 5 unaccounted for." It includes event effects automatically.
- **The target bar:** "Haul 40 / 63 needed by the next meeting."
- **The Heat breakdown:** "+4 every round, +10 Vault, −5 Rooftop, +4 police activity."

## Rooms, loot and Heat

Richer rooms raise Heat. If Heat ever reaches 100, the cops raid and the heist fails on the spot. These rules are unchanged from the current game.

| Room | Loot | Effect | Players |
| --- | --- | --- | --- |
| Vault | 6 | Raises Heat | All |
| Office | 4 | — | All |
| Lobby | 2 | Where missed moves go | All |
| Security | 0 | Watch one room's cameras: see who was in it | All |
| Rooftop | 0 | Lowers Heat | All |
| Deposit boxes | 5 | Raises Heat; more than 2 visitors get 4 each | 5+ |
| Server room | 0 | Learn how many pocketed this round, not who | 5+ |
| Teller line | 4 | — | 9+ |
| Manager's office | 4 | Raises Heat (half the Vault's) | 9+ |

**Heat per round**

- +4 every round, no matter what.
- Vault: up to +20 by the share of the crew in it (a quarter of the crew = +5). Deposit boxes and Manager's office: up to +10.
- Rooftop: up to −20 by the share laying low.
- +15 if the Haul misses the target at meeting 1 or 2.
- Police activity (the Mole's tip-off or the Police patrol card): +4.
- Heat never drops below 0. In crews under 5, event Heat is scaled down.

## Meetings, votes and the Haul target

At each meeting the crew may vote to shake down one player, and then the Haul is checked against the target. That order always holds, so the final meeting can still rescue the job by catching the greediest player.

**Meetings**

- **Regular:** after rounds 3, 6 and 9. In games of 3 hours or less they open automatically. In longer games the crew agrees a time; if nobody does, the app picks one 1–2 hours after round 3, 6 or 9 ends.
- **Emergency:** each player can call one per game, at any time, after a short notice period.
- **Can't make it?** Leave a sealed vote.
- Rounds pause while a meeting is open.
- **Between meetings** *(provisional)*: a stretch runs from the close of one regular meeting to the close of the next. Powers recharge when the regular meeting **closes**, after its vote, shakedown and target check, so a power used during meeting 1 uses up the old charge. Emergency meetings never recharge anything (owner ruling 2). See Build notes.

**Voting (one rule for every crew size)**

- Vote to shake down one player, or vote to skip. You can't vote for yourself.
- A shakedown passes if at least half the crew votes and one player gets more than half of the votes cast.
- Who sees ballots is a host setting: hidden until the meeting closes (default), open as cast, or secret (totals only).

**Shakedowns (fixed numbers)**

- The target's stash is shown to everyone and goes into the Haul. A Fence's safe is shown too, but not taken.
- **Clean:** if the stash plus any safe is under **6**, the target is declared clean and the crew pays them **8** out of the Haul.
- If a Muscle or a Shield could stop it, there's a short pause before it goes through.

**The Haul target**, shown as a progress bar:

| By | Haul needed | If missed |
| --- | --- | --- |
| Meeting 1 | 7 × players | +15 Heat; the shortfall carries forward |
| Meeting 2 | 15 × players | +15 Heat; the shortfall carries forward |
| Final meeting | 23 × players | The heist fails |

The clean line (6) and payout (8) replace 3 × and 5 × the act number. They are starting values for the balance pass.

## Winning and losing

At most one player wins (players still tied at the top share the win, below), never a team. If the heist succeeds, the biggest stash wins, whatever the role.

| How the game ends | Who wins |
| --- | --- |
| Final target met and Heat below 100 | The biggest stash |
| Cops raid (Heat 100) | Nobody, unless the Getaway Driver, Mole or Fence has the biggest stash |
| Final target missed | Nobody, unless the Embezzler, Mole or Fence has the biggest stash |

- **Score** = your stash, plus your safe if you're the Fence, plus the Inside Man's bonus. Whole numbers only.
- **Ties** go to whoever was shaken down fewer times, then to whoever handed in more. Players still level after that share the win.
- **On a failed heist**, the ranking is still shown, marked as a loss.

Every role card carries one "How you win" line, so nobody has to look this table up.

## Roles

All 20 roles stay, with the same powers as today. What changes: every reward is now **one token** (spent in the shop), every "once per act" reads **once between meetings**, and the scoring decimals are gone. The tag only describes how selfish a power is; it is not a team. ★ marks the four roles that can also win when the heist fails.

**Decks**

- **Starter** (first game, no events): Rookie, Inside Man, Lookout, Bagman, Cleaner.
- **Standard** (the default): Lookout, Auditor, Detective, Smooth Talker, Muscle, Cleaner, Hacker, Fence ★, Getaway Driver ★, Mole ★, Embezzler ★. Rookies fill any spare seats.
- **Everything:** all 20. The host can also switch roles on or off one by one.

**Team players**

| Role | Power | Earns a token when |
| --- | --- | --- |
| Rookie | No power | The Haul target is met at a meeting (meeting 1 or 2; *provisional*) |
| Inside Man | Can't pocket; +1 score per 5 loot the Haul ends above the final target | The Haul target is met at a meeting (meeting 1 or 2; *provisional*) |
| Lookout | Sees who was in one extra room every round | Someone it saw is caught |
| Auditor | Once between meetings: how much went missing in one room last round | A visitor of that room is caught |
| Detective | Once between meetings: is one player's stash "dirty" (6 or more)? | That player is caught |
| Snitch | Has a secret target | Its target is caught |
| Smooth Talker | Its vote counts double | It helps catch a cheater |
| Muscle | Once per game: cancel a shakedown that passed | It saved an innocent (and it gets the power back); if it saved a cheater, it is named in the ledger |
| Priest | Once between meetings: bless a player; if they're shaken down clean, the bank pays the 8 | A blessing pays out |
| Bagman | When it hands in everything, the bank adds +1 to the Haul | It hands in everything 3 rounds running |
| Cleaner | Its Rooftop visit cools Heat like two people | Every 2nd Rooftop round |
| Fixer | Once, automatically: stops a raid at Heat 95, losing a quarter of its stash (any raid, at any moment, *provisional*: see Build notes) | That happens |
| Mastermind | Sees the next event card early (events on only) | The Haul target is met at a meeting (meeting 1 or 2; *provisional*) |

**Wildcards**

| Role | Power | Earns a token when | Also wins |
| --- | --- | --- | --- |
| Getaway Driver ★ | Its Rooftop visit doesn't really cool Heat | Heat reaches 75 | A raid, with the biggest stash |
| Fence ★ | Hides up to 5 loot between meetings in a safe that shakedowns show but can't take | The safe reaches 10 | Any failure, with the biggest stash (safe counts) |
| Hacker | Once between meetings: loops one room's cameras, which then read "camera offline" | A loop hid someone who pocketed | — |
| Blackmailer | Once between meetings: guess a player's role; if right, it steals their vote at the next meeting | A vote it stole decides a shakedown (owner ruling 5) | — |
| Forger | Once between meetings: plants a fake sighting on that round's camera and Lookout feeds | Someone it framed is shaken down clean | — |

**Lone wolves**

| Role | Power | Earns a token when | Also wins |
| --- | --- | --- | --- |
| Mole ★ | Once between meetings, any time: tips off the cops for +4 Heat, announced only as "police activity" | Each tip-off | Any failure, with the biggest stash |
| Embezzler ★ | Once between meetings: moves 1 loot from the Haul into its stash; while holding a take, a shakedown always catches it | Its first take | A missed target, with the biggest stash |

**Minimum crew sizes:** Snitch and Detective 4+; Inside Man, Smooth Talker, Muscle and Priest 5+; Blackmailer 7+; Forger 7+ (*provisional*: kept from roles v2, which this list doesn't change). Nobody is told anyone else's role. You learn roles only through powers, perks, event cards or claims.

## Tokens and the perk shop

Roles earn tokens; tokens buy perks from a shop of three. Players learn one rule ("my role earns tokens") instead of eight different rewards.

- Each game deals **one perk from each column** below into the shop, so every game has exactly three (Quick games have no shop; events-off and Duel games deal from the lists below).
- Tokens and purchases are private until a perk is used.
- Use a perk any time after buying it, at most one per round.
- Unspent tokens are worth nothing at the end.
- *Provisional:* everyone starts with 0 tokens. You can buy any time, as often as your tokens allow, and the same perk more than once. "Per round" runs from a round's planning to the next round's planning, including its alibi window and any meeting after it.
- *Events off (provisional):* Rig needs events, so the Sway perk is dealt from +Vote and Emergency only.
- *Duel (provisional):* still three perks, but only ones that work without meetings: Peek or Tail, Alibi or Recharge, and Rig if events are on. With events off, the third slot gets whichever Peek/Tail or Alibi/Recharge perk wasn't dealt.
- *Quick (provisional):* no tokens and no shop (see Host settings).

| Learn | Protect | Sway |
| --- | --- | --- |
| **Peek** (2): learn one player's role | **Shield** (2): your next passed shakedown is cancelled, automatically | **+Vote** (1): +1 vote at one meeting |
| **Ballot** (1): see one player's vote in a meeting | **Alibi** (1): your real room is stamped "verified" for one round | **Emergency** (1): call one more emergency meeting |
| **Tail** (1): watch one extra room next round | **Recharge** (1): a used-up power comes back | **Rig** (1): choose the next event card from two (events on only) |

These are the same nine perks the game already has. Only how they are earned and chosen changes.

## Situations

From round 2, one event card is flipped every round for everyone to see. Cards can repeat, and they're on by default. Three of them now look exactly like sabotage, so the crew can't tell bad luck from a role's power.

| Card | Effect this round | Looks the same as |
| --- | --- | --- |
| ~~Police patrol~~ | ~~+4 Heat at a random moment, announced as "police activity"~~ *(provisional: moved out of the deck, below)* | The Mole's tip-off |
| Quiet night | Heat −10 | — |
| Shift change | The Vault pays double, with 1.5× its Heat | — |
| Payday | The Lobby pays 4 | — |
| Power cut | Every camera reads "camera offline"; nobody sees anybody | The Hacker's loop, for one room |
| Lockdown | One room is closed | — |
| Audit | Everyone sees how much went missing in each room | — |
| Raid rumour | The biggest stash secretly loses 3 (only they're told) | — |
| Inside tip | One random player secretly learns another's role | — |
| Double-cross | Two players are offered a role swap; it happens only if both accept | — |

Police patrol drops from +5 to +4 to match the tip-off. Unlike the other cards, it isn't shown at the start of the round, so a tip-off and a patrol look the same.

*Provisional PM call (3 Nov), awaiting owner confirmation:* a patrol card that isn't shown leaves a round with no card, which gives the patrol away. So the **Police patrol leaves the deck** (9 cards; one is still flipped every round from round 2). Instead, every game, events on or off, has a hidden **background chance of police activity**: about 1 in 4 rounds [tunable] get "+4 Heat, police activity" at a random moment, in the same windows the Mole can tip off. The announcement is identical to a tip-off. Details are in Build notes, "Police activity". The Power cut is flipped publicly, so a single "camera offline" room in a round without a Power cut is always the Hacker's loop.

## Host settings

| Setting | Options (default first) |
| --- | --- |
| Session length | 1 h, Quick (15 min), 3 h, 1 day, 3 days, 1 week *(default 1 h, as the server's `DEFAULT_SETTINGS`; Quick is a playtest preset)* |
| Deck | Standard, Starter, Everything, or pick roles one by one |
| Deal style | Balanced (a tested mix for the crew size), Truly random |
| Role list shown to players | Exact roles dealt, roles that could be in the game, nothing |
| Vote visibility | Hidden until the meeting closes, open, secret |
| Event cards | On, off |
| Unique roles | On, off |
| Two players | Duel mode: no votes; once between meetings call out your rival |
| During the game | Pause, extend a round, swap an inactive player for a bot |

Quick games switch to the Starter deck automatically. 45-second rounds leave no time for powers and tokens.

*Quick and Starter (provisional):* Quick locks the deck picker, the per-role toggles and Event cards (Starter, events off), and the lobby says "Quick games use the Starter deck". The host's other choices come back if the session length changes. Quick games have **no tokens and no shop**: 45-second rounds leave no time for them, and Starter is the learning game. A longer game on the Starter deck has tokens and the shop as normal. Outside Quick, per-role toggles can add any role to any preset (it then shows as Custom). "Starter never deals a Wildcard or Lone wolf" describes the preset as dealt.

## Owner rulings (3 Nov)

The owner's answers of 3 Nov fill gaps the tables above leave open. All final.

1. **Getaway Driver, Fence, Mole and Embezzler** earn **1 token** for their trigger, not a free Peek.
2. **Emergency meetings don't recharge** "once between meetings" powers. Only the regular meetings after rounds 3, 6 and 9 do.
3. The **Detective's "dirty" line and the shakedown's clean line** stay one shared number (6), tuned together.
4. The **Mole** earns a token for every tip-off (at most 3 per game).
5. The **Blackmailer** earns a token when a vote it stole decides a shakedown.
6. A **Muscle** that saves an innocent gets a token **and** its power back.
7. **Duel mode:** "between meetings" limits reset after rounds 3 and 6.
8. The **role list shown to players** defaults to **Exact roles dealt** (closes the Exact vs Possible question).

Also decided on 3 Nov: the offline demo (M2-15) ships as a GitHub Pages site, and the deploy workflow is manual-only until a host is chosen. [`design.md`](design.md) carries these rules too.

## Build notes (engine, bots, sim)

For the builders. This section carries over everything from `roles-v3.md` (owner-approved 2 Nov) that this spec keeps. Numbers in [brackets] are tunables for the balance pass.

**What the Extension amends in roles v3** (where they differ, this doc wins):

1. The four reveal rewards that became Peeks (Getaway Driver, Fence, Mole, Embezzler), and every other role reward, are now **one token** each.
2. "Once per act" reads "once between meetings" everywhere players see it. The engine keeps acts internally.
3. Rookie ×1.05 and Inside Man +0.15 become no multiplier and +1 per 5 loot over the final target. Scores are whole numbers.
4. The Mole's tip-off is still any time, once between meetings, +4 Heat. But it is announced only as "police activity", the same as the Police patrol card (now +4, at a random moment). *(Provisional, 3 Nov: the card becomes a hidden background chance; see "Police activity" below.)*
5. The plurality rule for crews of 9–12 is dropped; one vote rule for every size.

**Win rule** (`end.ts`)

- Rank every player by score (stash + Fence safe + Inside Man bonus), then apply the tie-breaks (fewer shakedowns, then more handed in). The **top group** is everyone still level at the top.
- Success: the top group wins, whatever their roles.
- Failure: nobody wins, except top-group members whose role wins that ending. `RoleDef.faction` and `isDarkSide` go; a `winsOn: ("heat" | "target")[]` field replaces them: Getaway Driver `[heat]`, Mole `[heat, target]`, Embezzler `[target]`, Fence `[heat, target]`.
- A failure-winner outside the top group doesn't win. Tie-breaks come first. Roles are read at the end, so a Double-cross can hand over a failure win. The full ranking is always shown, labelled as a loss unless someone qualified.

**Reveals**

- Removed: every automatic ally reveal (Hacker knows a saboteur; Getaway Driver at Heat 75; Fence at safe 10; Mole per tip-off; Embezzler's first take; Forger known to saboteurs; saboteurs knowing each other; the Blackmailer/saboteur special case). The `alliesLearned` event and `roleState.allies` go.
- Kept: every power a player *chooses* to use to learn a role: Peek, Inside tip, Detective, the Blackmailer's guess, claims and evidence cards.

**Tokens and the shop**

- Each `RoleDef.rewards` trigger grants one token (a private event) instead of a named perk.
- At setup the shop is dealt from content with the seeded RNG: one perk per column (Learn / Protect / Sway). A `buyPerk` command spends tokens; the existing perk effects are reused unchanged. Shield stays automatic once bought.
- The shakedown pause opens when a Muscle is dealt or Shield is in the shop (with the Exact role list; otherwise when either could be).

**Tags, decks and dealing**

- Temperament tag replaces faction and changes no rule: Team player (13 roles), Wildcard (Getaway Driver, Fence, Hacker, Blackmailer, Forger), Lone wolf (Mole, Embezzler).
- **Balanced** (default): a fixed mix per player count, decided by the balance pass (start from roles-v2 §3's most-weighted row under the round(n ÷ 3) cap). The host can't change it. Seats the deck can't fill go to Team players, Rookies last.
- **Truly random:** each seat drawn uniformly from the eligible deck, at most one Mole and one Embezzler.
- Dropped: the saboteur Off / Maybe / On setting, "no wildcards without a lone wolf", and "at most lone wolves + 1 wildcards". A stored saboteur field is ignored on read: a saved *Off* becomes Balanced with every Wildcard and Lone wolf toggled off; *Maybe* and *On* become plain Balanced.
- Presets: Starter (unchanged), Standard (the 11 roles above), Everything; plus per-role toggles. Quick games force Starter. The sim matrix drops its saboteur axis.

**Kept from the 2 Nov owner answers:** Exact role list shown by default (Possible / Hidden as options); Fence safe shown on a shakedown but not seized; plain explainers: a "How you win" line and tag on every card, an Endings table in the rulebook, an end screen that says how it ended and badges the winner's reason, and tapping any role name shows its tag and win line.

**Bots**

- Every bot keeps a public ending forecast (chance of success, raid, missed target) from Haul pace, Heat and the role list, and an estimate of its own stash rank.
- Most roles win only on success: they keep the job alive and skim when the forecast is safe.
- The four ★ roles lean toward their failure once its forecast passes a lean point [0.4] *and* they rate themselves top; otherwise they play for success. The Mole tips off when Heat after the round would pass about [70].
- Votes are on suspicion only; no ally logic. ★ holders and evidence-leaving roles (Hacker, Forger) bluff a low-risk role (Rookie, Bagman, Cleaner) when accused; the rest claim truthfully with chance 1 − lie. Public tells: rising Heat points at the Driver or Mole; "camera offline" at the Hacker or a Power cut; a big shown safe at the Fence.
- Bots buy perks by simple priorities and spend tokens before the game ends.

**Sim**

- Gates: per-role parity ≤ 0.10 (win credit ÷ 1/n, all 20 roles, Balanced, 4–12 players) and success 55–70%.
- Reports: the ending split (success / raid / miss), no-winner rate, shared-win rate, wins by success vs failure for each ★ role, token earning and spending per role, and Truly random and the role-list settings (no gate).
- Watch: the Mole and Fence can win either way and may sit high; Hacker, Blackmailer, Forger and Inside Man may sit low. Tune stash-earning numbers first.
- Run it on the sharded "Sim suite" GitHub workflow, not babysat in a chat.
- Tunables include the clean line [6] and pay [8], shop costs, the Inside Man's [5], police activity's chance [1 in 4] and Heat [4], the Fence cap [5], the Embezzler take [1], the Duel wrong-call pay [8], Balanced's mixes and the bots' lean points.

**Between meetings** *(provisional PM definition, 3 Nov)*

- A **stretch** runs from the close of one regular meeting to the close of the next. Stretch 1 runs from the deal to the close of meeting 1.
- "Once between meetings" uses recharge **when the regular meeting closes**, after its vote, shakedown and target check. So a use during meeting 1 (Detective, Mole, Auditor) spends stretch 1's charge, and the new charge is available from round 4's planning.
- Emergency meetings never close a stretch (owner ruling 2). The engine counts stretches by regular-meeting closes, not by `actOfRound`.
- In Duel, a stretch closes when round 3's or round 6's call-outs and target check settle (owner ruling 7).
- Role claims, the Fence's safe allowance and Duel call-outs use the same stretches. A Priest's blessing lasts until the next regular meeting closes.
- **Recharge** restores one used-up use of the current stretch, or a once-per-game use. It is refused if nothing is used up. A restored use still unspent at the stretch's close adds nothing, because the normal recharge covers it.

**Police activity** *(provisional PM call, 3 Nov, awaiting owner confirmation; replaces the Police patrol card)*

- **Deck:** the Police patrol is no longer an event card, so the deck is 9 cards. A card is still flipped publicly every round from round 2 (events on), so no round starts blank.
- **The draw:** as each round's planning opens (rounds 1–9, events on or off), the engine draws from the seeded RNG.
  - With chance [1 in 4] (content `policeActivity.chance`), that round's **window** gets one police activity.
  - If it does, the engine also draws a **slot**, uniformly from the phases a tip-off could land in: the round's planning, its alibi window, and (after rounds 3, 6 and 9) its regular meeting.
  - It also draws a fraction f in [0, 1) of that phase.
  - The draw is secret state: in no view, and reveal-only in the log.
- **The moment:** the server fires it at the phase's start plus f × the phase's planned length (`advance { kind: "policeActivity" }`).
  - If the phase ends sooner (an early round end after every lock-in, or a meeting closing), it fires as the phase closes, before the rest of the transition (so before the round resolves).
  - The sim and engine tests have no clock, so they fire it at the drawn phase's close.
  - Pauses delay it like any deadline.
- **Mole's "any time":** a tip-off can come during any round's planning or alibi window, during any open meeting (regular or emergency), or while a meeting is waiting to open.
- **Identical announcement:** the patrol and a tip-off produce the same public `policeActivity { heat }` event, with:
  - no source and the same text, "Police activity: +4 Heat";
  - the same small-crew scaling, min(1, crew ÷ 5), rounded;
  - the Heat added at once and a raid check at once (a Fixer may stop it).
  - Only the Mole gets a private "your tip-off" note. The source is reveal-only.
- **Heat breakdown:** police activity counts in the round whose window it landed in. If it lands in a meeting, it counts in the latest resolved round. If it lands after that round's summary was posted, the summary gains a "+4 police activity" line. Each breakdown line is rounded on its own (halves up), and the round's change is the sum of its lines.
- **Accepted leftover tells:**
  - Two police activities in one window mean at least one was the Mole, but not which.
  - A tip-off during an emergency meeting, or while a meeting is waiting to open, is always the Mole.
  - With no Mole in the role list, every police activity is a patrol, so there is nothing to hide.
- **The Mastermind** doesn't foresee police activity, because it isn't a card. The starting chance gives about 2.25 patrols (about +9 Heat) per game; the balance pass tunes the chance with the baseline Heat.

**Fixer** *(provisional)*: the save stops **any** raid, whenever Heat would reach 100: at a round's resolution, from a missed target's +15, or from police activity at any moment, including between rounds and during a meeting. Heat is set to 95 and the public `raidStopped` names nobody.

**Token readings** *(provisional PM readings where the tables are terse)*

- **Snitch:** a token each time its target is caught. This replaces its +1 ballot weight.
- **Smooth Talker:** "helps catch a cheater" means its last ballot in that meeting was for the caught player.
- **Fixer:** a token, not a Shield.
- **Rookie, Inside Man and Mastermind:** tokens only at meetings 1 and 2. The final check ends the game, and unspent tokens are worthless.
- **Bagman:** one token per run of 3 all-in rounds in a row.
- **Blackmailer:** "decides" means the shakedown passed and wouldn't have without the stolen weight.
- **Duel:** a wrong call-out pays a fixed [8] from the caller's stash (it was 5 × the act).
- **Balanced starting mixes** (Wildcards / Lone wolves, before the balance pass): 4 players 0/1, 5–8 players 1/1, 9–10 players 1/2, 11–12 players 2/2.
- **Rulebook line on voluntary tells:** using a perk before the first shakedown (a second Emergency, a Shield's "cancelled", a Verified alibi) shows you earned tokens early, which narrows your possible roles.

## Code change estimate

The Extension changes about **1,500 lines of source and 1,500 lines of tests**, about 7% of the roughly 20,700 lines of source on `main` today. Most of it rides on work already queued. These are estimates from reading the repo, not a line-by-line plan.

| Change | Where | Source lines | Test lines |
| --- | --- | --- | --- |
| Web: "between meetings" wording, gap box, target bar, Heat breakdown, shop sheet, token count | Game and meeting screens, event text | ~700 | ~300 (e2e) |
| Tokens and the 3-perk shop: deal the shop, buy command, costs | Engine perks and rewards, content, server command routing | ~300 | ~400 |
| Sabotage that looks like bad luck: "police activity", "camera offline", patrol timing | Engine round, events, content | ~120 | ~200 |
| Bots that earn, buy and spend tokens | Bots | ~150 | ~150 |
| New token triggers (Rookie, Inside Man, Mastermind, Bagman) | Engine rewards | ~50 | ~100 |
| Heat breakdown in each round's summary | Engine round, events | ~40 | ~60 |
| Fixed shakedown numbers; one vote rule | Content, engine meetings, bots | ~40 | ~150 |
| Whole-number scoring | Content, engine end | ~30 | ~80 |
| Standard deck preset; Quick uses Starter | Content, setup | ~30 | ~40 |
| Token and shop stats in the simulator | Sim | ~60 | ~40 |
| **Total** | | **~1,500** | **~1,500** |

**How it fits the work that's still pending**

- **R6a (rules):** builds this whole spec in one pass: the roles v3 parts and the Extension's changes touch the same files (rewards, dealing, the win rule), so nothing is changed twice.
- **R6b (roles UI):** role cards get a "How you win" line and a rulebook sheet there. The Extension's wording and the shop sheet join it.
- **Balance:** one pass after R6a covers everything. That is computer time, not code.
- **Unaffected:** the end-of-game reveal (it should also list tokens and purchases), host controls, Google sign-in, the playtest pass and the offline demo.
- **Untouched:** the engine core, server, lobby, chat, art and CI.

**Not part of the Extension, not approved, out of scope** (adds one experiment each, if wanted later): Books mode, where the Haul is hidden and a public Banker reports it (about 600–900 more lines), and a Mole recruited mid-game instead of dealt (about 200–300).

## Extension vs Rebuild

*Kept for the record. The owner chose the Extension on 3 Nov; the Rebuild and Books mode are not approved and out of scope.*

The Extension is the cheaper and safer path; the Rebuild is the more original game. They aren't mutually exclusive: Books mode is the first step from the Extension toward the Rebuild.

| | Extension (this doc) | Rebuild (jobs design) |
| --- | --- | --- |
| What a player learns | Core loop, own role, the ~11 roles in Standard, one shop | Core loop, own job, one shop |
| Between rounds | Alibi, chat, maybe a power | File a record, alibi, chat, perks |
| Where the lying happens | Secret powers and alibis | Public records anyone can fake |
| Code changed | ~1,500 source lines (~7%) | ~half the codebase |
| Balance work | The one pass already planned | Start over |
| Short games (Quick to 3 h) | Work | Don't really work |
| One player goes quiet | Only their power is lost | The crew loses a record |
| Originality | Close to other hidden-role games | No obvious competitor |

Build the Extension as R6, finish the demo, and playtest. If the group wants more to do between rounds, try Books mode as the next step.
