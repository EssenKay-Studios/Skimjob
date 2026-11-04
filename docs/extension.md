# Skimjob Extension: simplified rulebook

*2–3 Nov 2026 · Karthik. The single rules spec for roles, tokens and the shop, built in R6 (live). Replaced by R7 Simplified (`docs/simplified.md`) once built.*

## Summary

The Extension is the current game made lighter to learn, without changing how it is built. It covers one crew, failure wins for four roles, no automatic reveals, temperament tags and the two deal modes. The jobs redesign is archived as [`archive/rebuild-2026-11-02.md`](archive/rebuild-2026-11-02.md).

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
| Teller line | 6 | Raises Heat (half the Vault's) | 9+ |
| Manager's office | 3 | Raises Heat (half the Vault's) | 9+ |

**Heat per round**

- +4 every round, no matter what.
- Vault: up to +20 by the share of the crew in it (a quarter of the crew = +5). Deposit boxes and Manager's office: up to +10.
- Rooftop: up to −20 by the share laying low.
- +15 if the Haul misses the target at meeting 1 or 2.
- Police activity (the Mole's tip-off or the hidden background patrol): +4.
- Heat never drops below 0. In crews under 5, event Heat is scaled down.

## Meetings, votes and the Haul target

At each meeting the crew may vote to shake down one player, and then the Haul is checked against the target. That order always holds, so the final meeting can still rescue the job by catching the greediest player.

**Meetings**

- **Regular:** after rounds 3, 6 and 9. In games of 3 hours or less they open automatically. In longer games the crew agrees a time; if nobody does, the app picks one 1–2 hours after round 3, 6 or 9 ends.
- **Emergency:** each player can call one per game, at any time, after a short notice period.
- **Can't make it?** Leave a sealed vote.
- Rounds pause while a meeting is open.

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

The clean line (6) and payout (8) replace 3 × and 5 × the act number. The R6 balance pass kept both (docs/balance/r6-balance.md).

## Winning and losing

At most one player wins (players still level after the tie-breaks share it), never a team. If the heist succeeds, the biggest stash wins, whatever the role.

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
| Rookie | No power | The Haul target is met at a meeting |
| Inside Man | Can't pocket; +1 score per 5 loot the Haul ends above the final target | The Haul target is met at a meeting |
| Lookout | Sees who was in one extra room every round | Someone it saw is caught |
| Auditor | Once between meetings: how much went missing in one room last round | A visitor of that room is caught |
| Detective | Once between meetings: is one player's stash "dirty" (6 or more)? | That player is caught |
| Snitch | Has a secret target | Its target is caught |
| Smooth Talker | Its vote counts double | It helps catch a cheater |
| Muscle | Once per game: cancel a shakedown that passed | It saved an innocent (and it gets the power back); if it saved a cheater, it is named in the ledger |
| Priest | Once between meetings: bless a player; if they're shaken down clean, the bank pays the 8 | A blessing pays out |
| Bagman | When it hands in everything, the bank adds +1 to the Haul | It hands in everything 3 rounds running |
| Cleaner | Its Rooftop visit cools Heat like two people | Every 2nd Rooftop round |
| Fixer | Once, automatically: stops a raid at Heat 95, losing a quarter of its stash | That happens |
| Mastermind | Sees the next event card early (events on only) | The Haul target is met at a meeting |

**Wildcards**

| Role | Power | Earns a token when | Also wins |
| --- | --- | --- | --- |
| Getaway Driver ★ | Its Rooftop visit doesn't really cool Heat | Heat reaches 75 | A raid, with the biggest stash |
| Fence ★ | Hides up to 1 loot between meetings in a safe that shakedowns show but can't take | The safe reaches 3 | Any failure, with the biggest stash (safe counts) |
| Hacker | Once between meetings: loops one room's cameras, which then read "camera offline" | A loop hid someone who pocketed | — |
| Blackmailer | Once between meetings: guess a player's role; if right, it steals their vote at the next meeting | A vote it stole decides a shakedown (ruling 5) | — |
| Forger | Once between meetings: plants a fake sighting on that round's camera and Lookout feeds | Someone it framed is shaken down clean | — |

**Lone wolves**

| Role | Power | Earns a token when | Also wins |
| --- | --- | --- | --- |
| Mole ★ | Once between meetings, any time: tips off the cops for +4 Heat, announced only as "police activity" (it lands at the next hidden police moment) | Each tip-off | Any failure, with the biggest stash |
| Embezzler ★ | Once between meetings: moves 1 loot from the Haul into its stash; while holding a take, a shakedown always catches it | Its first take | A missed target, with the biggest stash |

**Minimum crew sizes:** Snitch and Detective 4+; Inside Man, Smooth Talker, Muscle and Priest 5+; Blackmailer and Forger 7+. Nobody is told anyone else's role. You learn roles only through powers, perks, event cards or claims.

## Tokens and the perk shop

Roles earn tokens; tokens buy perks from a shop of three. Players learn one rule ("my role earns tokens") instead of eight different rewards.

- Each game deals **one perk from each column** below into the shop, so every game has exactly three.
- Tokens and purchases are private until a perk is used.
- Use a perk any time after buying it, at most one per round.
- Unspent tokens are worth nothing at the end.

| Learn | Protect | Sway |
| --- | --- | --- |
| **Peek** (2): learn one player's role | **Shield** (2): your next passed shakedown is cancelled, automatically | **+Vote** (1): +1 vote at one meeting |
| **Ballot** (1): see one player's vote in a meeting | **Alibi** (1): your real room is stamped "verified" for one round | **Emergency** (1): call one more emergency meeting |
| **Tail** (1): watch one extra room next round | **Recharge** (1): a used-up power comes back | **Rig** (1): choose the next event card from two (events on only) |

These are the same nine perks the game already has. Only how they are earned and chosen changes.

## Situations

From round 2, one event card is flipped every round for everyone to see. Cards can repeat, and they're on by default. A Power cut looks like the Hacker's loop, and hidden police activity looks exactly like the Mole's tip-off, so the crew can't tell bad luck from a role's power.

| Card | Effect this round | Looks the same as |
| --- | --- | --- |
| Quiet night | Heat −5 | — |
| Shift change | The Vault pays 1.5×, with double its Heat | — |
| Payday | The Lobby pays 4 | — |
| Power cut | Every camera reads "camera offline"; nobody sees anybody | The Hacker's loop, for one room |
| Lockdown | One room is closed | — |
| Audit | Everyone sees how much went missing in each room | — |
| Raid rumour | The biggest stash secretly loses 3 (only they're told) | — |
| Inside tip | One random player secretly learns another's role | — |
| Double-cross | Two players are offered a role swap; it happens only if both accept | — |

**Police activity** (owner, 3 Nov, option A): the Police patrol is no longer a card. Instead, whenever a Mole could be in the game (provisional), about **3 rounds in 10** [tuned: 30%] brings a hidden "police activity: +4 Heat" at a random moment of game time, during or between rounds. It lands at the same hidden moments as the Mole's queued tip-off and is announced exactly like it, so the two look the same (see Build notes, "Police activity"). (Was the +5 Police patrol card.)

## Host settings

| Setting | Options (default first) |
| --- | --- |
| Session length | 1 h, Quick (15 min), 3 h, 1 day, 3 days, 1 week |
| Deck | Standard, Starter, Everything, or pick roles one by one |
| Deal style | Balanced (a tested mix for the crew size), Truly random |
| Role list shown to players | Exact roles dealt, roles that could be in the game, nothing |
| Vote visibility | Hidden until the meeting closes, open, secret |
| Event cards | On, off |
| Unique roles | On, off |
| Two players | Duel mode: no votes; once between meetings call out your rival |
| During the game | Pause, extend a round, swap an inactive player for a bot |

Quick games switch to the Starter deck automatically. 45-second rounds leave no time for powers and tokens.

## Owner rulings (3 Nov)

Owner answers of 3 Nov (morning), all final:

1. Getaway Driver, Fence, Mole and Embezzler earn **1 token** for their trigger (not a free Peek).
2. **Emergency meetings don't recharge** "once between meetings" powers; only the regular meetings after rounds 3, 6 and 9 do.
3. The Detective's "dirty" line and the shakedown's clean line stay **one shared number (6)**, tuned together.
4. The Mole earns a token for **every tip-off** (at most 3 per game).
5. The Blackmailer earns a token when **a vote it stole decides a shakedown**.
6. A Muscle that saves an innocent gets **a token and its power back**.
7. **Duel:** "between meetings" limits reset after rounds 3 and 6.
8. The role list shown to players defaults to **Exact roles dealt**.

Also confirmed: **Police patrol option A**. The patrol leaves the event deck and becomes hidden background police activity (see "Situations" and Build notes).

**Gap-fills** (PM readings from the review; the owner may change them):

- **Between meetings:** a stretch runs from the close of one regular meeting to the close of the next. Uses recharge when that meeting **closes**, after its vote, shakedown and target check, so a power used during a meeting spends the old charge. Emergency meetings never close a stretch. In Duel, a stretch closes when round 3's or 6's call-outs and target check settle. **Recharge** restores one used-up use of the current stretch, or a once-per-game use.
- **Session length:** the default is **1 h** (the server's `DEFAULT_SETTINGS`); Quick is a playtest preset.
- **Quick forces Starter:** it locks the deck picker, the per-role toggles and Event cards to Starter with events off, and the lobby says so. The host's other choices come back if the length changes. Quick has **no tokens and no shop** (it is the learning game, and 45-second rounds leave no time). Outside Quick, per-role toggles may add any role to any preset.
- **Duel wrong call-out (provisional):** the caller pays the rival **[8]** from its own stash, never more than it holds (as design §16.1 today), the clean payout number (was 5 × act), tuned with it.
- **Shop dealing:** players start with 0 tokens and can buy any time. With **events off**, the Sway perk is dealt from +Vote or Emergency only. **Duel** deals three perks that work without meetings: Peek or Tail, Alibi or Recharge, and Rig with events on. With events off, the third perk is a seeded pick from the Learn and Protect perks that weren't dealt.
- **Fixer:** the save stops **any** raid at any moment, including one from police activity between rounds or during a meeting (Heat set to 95).
- **Forger 7+:** kept from roles v2; the minimum-size list above omitted it.
- **Background police activity:** it runs only when a Mole could be in the game (provisional; see Build notes, "Police activity"). The Mole's tip-off is queued to the next hidden police moment.
- **Token triggers:**
  - **Rookie, Inside Man and Mastermind:** checkpoints 1 and 2 only. The final check ends the game, so a token there would be worthless.
  - **Smooth Talker:** "helps catch a cheater" means its ballot was for the caught player.
  - **Blackmailer:** "decides" means the shakedown wouldn't have passed without the stolen vote.
  - **Priest:** a blessing lasts until the next regular meeting closes.
  - **Snitch:** the token replaces its old +1 ballot weight per catch (`snitch.extraVotes` goes).
  - **Bagman:** one token per 3 rounds in a row of handing in everything. Meetings don't break the run, and the count restarts after each token.
  - **Getaway Driver:** earns its token the first time Heat reaches 75 at any moment, police activity included; once per game.

## Build notes (engine, bots, sim)

For the builders. Numbers in [brackets] are tunables for the balance pass.

**Five rules to keep in mind:**

1. Every role reward is **one token**, the Getaway Driver, Fence, Mole and Embezzler included.
2. "Once per act" reads "once between meetings" everywhere players see it. The engine keeps acts internally.
3. The Rookie has no multiplier; the Inside Man scores +1 per 5 loot over the final target. Scores are whole numbers.
4. The Mole's tip-off is still any time, once between meetings, +4 Heat. But it is announced only as "police activity", the same as the background patrol that replaces the Police patrol card: a hidden background chance [30%, tuned] per round of +4 at a random moment, run only when a Mole could be in the game (owner, 3 Nov, option A; see "Police activity" below). The tip-off is queued to the same hidden moments.
5. One vote rule for every crew size.

**Win rule** (`end.ts`)

- Rank every player by score (stash + Fence safe + Inside Man bonus), then apply the tie-breaks (fewer shakedowns, then more handed in). The **top group** is everyone still level at the top.
- Success: the top group wins, whatever their roles.
- Failure: nobody wins, except top-group members whose role wins that ending. `RoleDef.faction` and `isDarkSide` go; a `winsOn: ("heat" | "target")[]` field replaces them: Getaway Driver `[heat]`, Mole `[heat, target]`, Embezzler `[target]`, Fence `[heat, target]`.
- A failure-winner outside the top group doesn't win. Tie-breaks come first. Roles are read at the end, so a Double-cross can hand over a failure win. The full ranking is always shown, labelled as a loss unless someone qualified.

**Reveals**

- No automatic reveals: nobody is told another player's role or side, at the deal or later (no `alliesLearned` event, no `roleState.allies`).
- Kept: every power a player *chooses* to use to learn a role: Peek, Inside tip, Detective, the Blackmailer's guess, claims and evidence cards.

**Tokens and the shop**

- Each `RoleDef.rewards` trigger grants one token (a private event) instead of a named perk.
- At setup the shop is dealt from content with the seeded RNG: one perk per column (Learn / Protect / Sway). A `buyPerk` command spends tokens; the existing perk effects are reused unchanged. Shield stays automatic once bought.
- The shakedown pause opens when a Muscle is dealt or Shield is in the shop (with the Exact role list; otherwise when either could be).

**Tags, decks and dealing**

- Temperament tag replaces faction and changes no rule: Team player (13 roles), Wildcard (Getaway Driver, Fence, Hacker, Blackmailer, Forger), Lone wolf (Mole, Embezzler).
- **Balanced** (default): a fixed mix per player count, decided by the balance pass (about round(n ÷ 3) Lone wolves + Wildcards at most; the R6 balance pass deals 4 players 1 / 1, one over that cap, and 8 players 2 / 1). The host can't change it. Seats the deck can't fill go to Team players, Rookies last.
- **Truly random:** each seat drawn uniformly from the eligible deck, at most one Mole and one Embezzler.
- No other caps on the mix. A legacy stored `mole` lobby field is migrated on read: *off* becomes Balanced with every Wildcard and Lone wolf toggled off; any other value becomes plain Balanced.
- Presets: Starter (unchanged), Standard (the 11 roles above), Everything; plus per-role toggles. Quick games force Starter. The sim matrix has no faction axis.

**Kept from the 2 Nov owner answers:** Exact role list shown by default (Possible / Hidden as options); Fence safe shown on a shakedown but not seized; plain explainers: a "How you win" line and tag on every card, an Endings table in the rulebook, an end screen that says how it ended and badges the winner's reason, and tapping any role name shows its tag and win line.

**Bots**

- Every bot keeps a public ending forecast (chance of success, raid, missed target) from Haul pace, Heat and the role list, and an estimate of its own stash rank.
- Most roles win only on success: they keep the job alive and skim when the forecast is safe.
- The four ★ roles lean toward their failure once its forecast passes a lean point [0.8] (R6 balance pass; was 0.4) *and* they rate themselves top; otherwise they play for success. The Mole tips off when Heat after the round would pass about [70], allowing for the delay until the next police moment (about one round).
- Votes are on suspicion only; no ally logic. ★ holders and evidence-leaving roles (Hacker, Forger) bluff a low-risk role (Rookie, Bagman, Cleaner) when accused; the rest claim truthfully with chance 1 − lie. Public tells: rising Heat points at the Driver or Mole; "camera offline" at the Hacker or a Power cut; a big shown safe at the Fence.
- Bots buy perks by simple priorities and spend tokens before the game ends.

**Police activity** (owner, 3 Nov: option A; the chance and cadence are content numbers tuned by the balance pass)

- The Police patrol is no longer an event card, so the deck is 9 cards and one card is still flipped every round from round 2.
- **When it runs (provisional, PM 3 Nov):** only when a Mole could be in the game, whatever the events setting. "Could be" means a Mole is dealt (Exact role list) or is in the eligible deck for this crew size (Possible or Hidden). Otherwise there is no background activity: Starter, Quick and the Duel default have no Mole. It exists only as cover for the Mole. Its Heat, about +1 per round on average, is a balance-pass tunable.
- **Game time:** police moments are measured in game time, which runs only while round deadlines run (planning and the alibi window both count). It freezes, exactly like round deadlines, during:
  - a host pause;
  - an emergency or regular meeting (including one waiting to open);
  - quiet hours.

  A moment that would fall inside a meeting lands right after the meeting closes, after its target check.
- **Police moments:** the engine draws a hidden schedule of moments from the seeded RNG. The first moment is at game time g₀. Each next gap is drawn uniformly from [0.5, 1.5] × the preset's round length (planning plus alibi window). This is about one moment per round, and moments are not tied to phase boundaries, so early round ends don't move them.
  - At each moment, the background fires with chance [30%, tuned] (`POLICE_ACTIVITY.chancePercent`).
  - The draws are secret state, reveal-only in the log.
  - The server fires each moment with `advance { kind: "policeMoment" }`. The sim, which has no clock, takes one moment per round, at the round's resolution.
- **Mole tip-off, queued:** the Mole may **use** its tip-off any time, once between meetings, as the 2 Nov answer says; the use counts at once. The tip-off **lands** at the next free police moment (provisional), the same way as a patrol, so timing can't tell them apart.
- **One per moment:** at most **one** police activity fires at any hidden moment.
  - A queued tip-off takes the next moment that no other tip-off has claimed; a second queued tip-off waits for the moment after.
  - If a background patrol was drawn for that moment, the tip-off replaces it. The moment still shows a single "+4 police activity", so the public pattern is identical to patrol-only games.
  - So a tip-off may absorb a patrol, leaving that moment's Heat unchanged. This is accepted and is a balance tunable.
  - A tip-off still queued when the game ends is lost.
  - The Mole earns its token when the tip-off lands.
- **No leak (a server/engine requirement R6a must test):** police activity, whether patrol or tip-off, never gets its own client-visible deadline or timer.
  - Police moments are never sent in `timers` or in any `viewFor` field or deadline payload.
  - Scheduling or clearing a moment never counts as a view change.
  - The server broadcasts only the resulting public "police activity +4" event.
  - R6a adds `viewFor` and live-channel tests for this.
- **Same as a tip-off:** a patrol and a tip-off produce the same public `policeActivity` event, with:
  - no source;
  - the same +[4], scaled by min(1, crew ÷ 5) in small crews;
  - an immediate raid check (a Fixer can stop it).
  - Only the Mole gets a private note when the activity was its own.
- **Heat breakdown:** police activity is a separate line ("police activity +4") under the round in progress, the latest round whose planning has opened. If that round's summary is already posted, the line is added under it.
- **Remaining tells (accepted):**
  - "Camera offline" in one room, in a round with no Power cut, is always the Hacker. The Power cut is public and blinds every room, so it is only partial cover.
- **No foresight:** the Mastermind doesn't foresee police activity.

**Sim**

- Gates: per-role parity ≤ 0.10 (win credit ÷ 1/n, Balanced, 4–12 players) and success 55–70%. **Split gate (PM provisional, 3 Nov; owner to confirm):** the spread is taken over Team roles only, gated at ≤ 0.20 until the owner's playtests (0.10 stays the target); each ★ role's win rate must sit at 0.9–1.8× the Team-role average (a ★ role with an average stash wins about 1 ÷ success rate as often; docs/balance/r6-balance.md). The all-role spread is report-only.
- Reports: the ending split (success / raid / miss), no-winner rate, shared-win rate, wins by success vs failure for each ★ role, token earning and spending per role, and Truly random and the role-list settings (no gate).
- Watch: the Mole and Fence can win either way and may sit high; Hacker, Blackmailer, Forger and Inside Man may sit low. Tune stash-earning numbers first.
- Run it on the sharded "Sim suite" GitHub workflow, not babysat in a chat.
- Flag in the balance brief: police moments run on game time, so live games with many early round ends get fewer than one moment per round, while the sim takes exactly one. Live Heat can drift below the sim's; watch it in the owner's playtests.
- Flag in the balance brief: background police activity adds about +1 Heat per round (about +9 a game) where a Mole could be, against the old card's ~+4.
- Tunables include police activity's chance [30%], the Duel wrong-call pay [8], alongside the clean line [6], pay [8] and shop costs.
- **R6 balance pass (content 0.16.0, docs/balance/r6-balance.md):** success passes 55–70% in all 18 gated cells. Parity fails everywhere (spread 0.63–1.01): the ★ roles also win failures, which numbers can't offset (owner decision pending). Tuned: Teller line 5, Manager's office 3, Shift change loot ×1.5 / Heat ×2, Quiet night −5, police chance 30%, Fence safe 1 an act (token at 3), Balanced 4p 1 / 1 and 8p 2 / 1. Kept: clean line 6, pay 8, Duel 8, shop costs.
- **Split-gate pass (content 0.17.0, PM provisional):** Teller line 6 loot and +10 Heat (half the Vault's), ★ lean point 0.4 → 0.8. Success still passes in all 18 cells; every ★ role sits in the 0.9–1.8 band (no confirmed FAIL); Team-role spread was 0.06–0.28 (Muscle high, Cleaner low). **Team-parity pass:** the Muscle bot rescues others below suspicion 2 (was 1); team spread 0.10–0.20 against the provisional 0.20 gate, no gated check a confirmed FAIL (run 41611375754).

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

**How it was built** (R6, all merged)

- **R6a (rules):** the whole spec in one pass (rewards, dealing, the win rule), so nothing was changed twice.
- **R6b (roles UI):** role cards get a "How you win" line and a rulebook sheet there. The Extension's wording and the shop sheet join it.
- **Balance:** one pass after R6a covers everything. That is computer time, not code.
- **Unaffected:** the end-of-game reveal (it should also list tokens and purchases), host controls, Google sign-in, the playtest pass and the offline demo.
- **Untouched:** the engine core, server, lobby, chat, art and CI.

**Not part of the Extension** (adds one experiment each, if wanted later): Books mode, where the Haul is hidden and a public Banker reports it (about 600–900 more lines), and a Mole recruited mid-game instead of dealt (about 200–300).

## Extension vs Rebuild

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
