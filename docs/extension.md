# Skimjob Extension: simplified rulebook

*2 Nov 2026 · Karthik. **Approved 3 Nov 2026**: it amends roles v3 ([`roles-v3.md`](roles-v3.md)), and wins on any conflict. Built in R6a (rules, content, bots) and R6b (UI), with one balance pass between them; its numbers are starting values for that pass. The companion proposal [`rebuild.md`](rebuild.md) is **not approved, out of scope**.*

## Summary

The Extension is the current game (roles v3, PR #45) made lighter to learn, without changing how it is built. The Rebuild is the jobs redesign in [`rebuild.md`](rebuild.md) (not approved, out of scope).

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

**Cost:** roughly 1,300–1,600 lines of source changed or added, about 7% of the codebase, plus about 1,000–1,500 lines of tests. Most of it fits inside the roles v3 work that is already planned (R6a, R6b) and the balance pass that has to run anyway. For comparison, the Rebuild would change about half the code.

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

At most one player wins, never a team. If the heist succeeds, the biggest stash wins, whatever the role.

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

All 20 roles stay, with the same powers as roles v3. What changes: every reward is now **one token** (spent in the shop), every "once per act" reads **once between meetings**, and the scoring decimals are gone. The tag only describes how selfish a power is; it is not a team. ★ marks the four roles that can also win when the heist fails.

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
| Fence ★ | Hides up to 5 loot between meetings in a safe that shakedowns show but can't take | The safe reaches 10 | Any failure, with the biggest stash (safe counts) |
| Hacker | Once between meetings: loops one room's cameras, which then read "camera offline" | A loop hid someone who pocketed | — |
| Blackmailer | Once between meetings: guess a player's role; if right, it steals their vote at the next meeting | — | — |
| Forger | Once between meetings: plants a fake sighting on that round's camera and Lookout feeds | Someone it framed is shaken down clean | — |

**Lone wolves**

| Role | Power | Earns a token when | Also wins |
| --- | --- | --- | --- |
| Mole ★ | Once between meetings, any time: tips off the cops for +4 Heat, announced only as "police activity" | Each tip-off | Any failure, with the biggest stash |
| Embezzler ★ | Once between meetings: moves 1 loot from the Haul into its stash; while holding a take, a shakedown always catches it | Its first take | A missed target, with the biggest stash |

**Minimum crew sizes:** Snitch and Detective 4+; Inside Man, Smooth Talker, Muscle and Priest 5+; Blackmailer 7+. Nobody is told anyone else's role. You learn roles only through powers, perks, event cards or claims.

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

From round 2, one event card is flipped every round for everyone to see. Cards can repeat, and they're on by default. Three of them now look exactly like sabotage, so the crew can't tell bad luck from a role's power.

| Card | Effect this round | Looks the same as |
| --- | --- | --- |
| Police patrol | +4 Heat at a random moment, announced as "police activity" | The Mole's tip-off |
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

## Host settings

| Setting | Options (default first) |
| --- | --- |
| Session length | Quick (15 min), 1 h, 3 h, 1 day, 3 days, 1 week |
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

The owner's answers of 3 Nov fill gaps the tables above leave open. All final.

1. **Getaway Driver, Fence, Mole and Embezzler** earn **1 token** for their trigger, not a free Peek.
2. **Emergency meetings don't recharge** "once between meetings" powers. Only the regular meetings after rounds 3, 6 and 9 do.
3. The **Detective's "dirty" line and the shakedown's clean line** stay one shared number (6), tuned together.
4. The **Mole** earns a token for every tip-off (at most 3 per game).
5. The **Blackmailer** earns a token when a vote it stole decides a shakedown.
6. A **Muscle** that saves an innocent gets a token **and** its power back.
7. **Duel mode:** "between meetings" limits reset after rounds 3 and 6.

Also decided: the role list shown to players defaults to **Exact roles dealt**. The folded rules are in [`roles-v3.md`](roles-v3.md) and [`design.md`](design.md).

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

- **R6a (building roles v3):** the Extension's rule changes can go into the same build, since both touch rewards, dealing and the win rule. That avoids changing the same files twice.
- **R6b (roles UI):** role cards already get a "How you win" line and a rulebook sheet there. The Extension's wording and the shop sheet join it.
- **Balance:** the pass already planned after roles v3 covers the Extension too. That is computer time, not code.
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

Build the Extension into the roles v3 work, finish the demo, and playtest. If the group wants more to do between rounds, try Books mode as the next step.
