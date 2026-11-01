# Skimjob — Role deck proposal v2 (18 roles + 2 saboteurs)

*Game-designer proposal, 1 Nov 2026, after owner feedback on v1. Numbers are placeholders for the sim. **Approved by Karthik (1 Nov) with one change: the Ballot perk also works in Secret vote mode** (it shows one chosen player's ballot to the perk holder only). Built in steps R1–R5; see `docs/decisions.md` and `docs/STATUS.md`.*

## 0. Three factions, one win rule

- **Crew:** helps the job. Their help earns **perks** that pay off later in the game.
- **Saboteurs:** wreck the job and profit from it. They know each other (as two Moles do today).
- **Accomplices:** help the saboteurs. Each card says what they know (§3).
- **Win rule:** two sides, and **the winning side's biggest stash wins**.
  - Heist succeeds → the biggest Crew stash wins. Saboteurs and Accomplices can't win.
  - Heist fails → the biggest stash among Saboteurs + Accomplices wins. A failure with no saboteur dealt is won by nobody (Accomplices are never dealt without one).
  - Loot taken by sabotage is just stash, so "steal, then sink the job" is the saboteurs' plan.
- This replaces Driver/Mole `winsOnFailure` with one faction field on `RoleDef`. Size **M** in `end.ts`.

## 1. Perks: the shared reward vocabulary (built once, size M)

A perk is a private token in `roleState`. It is granted by a private `perkGranted` event and spent like an ability. Every role below earns one of these, mostly by helping the side it plays for.

| Perk | Effect | Reuses |
|---|---|---|
| **Peek** | Learn one player's role | Inside tip |
| **Shield** | Your next passed shakedown is cancelled | Muscle window* |
| **+Vote** | +1 ballot weight at the next meeting | Smooth talker weight |
| **Ballot** | See one player's ballot in the next meeting | New `viewFor` grant |
| **Tail** | Next round, also see one extra room | Lookout |
| **Alibi** | The app stamps your real room as Verified for one round | Evidence cards |
| **Recharge** | Your once-per-act/game power comes back | `roleState` |
| **Rig** | Pick the next event from two cards | Events deck |

\* The shakedown window must open whenever *any* Shield is possible from the pool, not only when a Muscle is in it. Otherwise the window would show that one exists.

## 2. The deck

Size: **S** means content plus a small hook. **M** means a new ability or event, a leak test and bot logic. **L** means none. The number in brackets is the role's **one main tunable number**.

### Crew (13)

| Role | Power | Reward (trigger → perk) | Weakness if revealed | Size |
|---|---|---|---|---|
| Rookie | None | Each checkpoint made → Tail [1] | The easy one to pin blame on | S |
| Inside Man | Can't pocket; scores 0.3 per loot over the final target [0.3] | Each checkpoint made → Peek | Others pocket more, knowing it covers | S |
| Lookout | Sees 1 extra room each round [1] | Someone it saw is shaken down dirty → Peek | Framed; liars route around it | S |
| Auditor | Once per act: that round's shortfall for one room [1/act] | A visitor of that room is shaken down dirty → Ballot | Liars shake it down to discredit it | M |
| Detective | Once per act: is X's stash at or above the clean threshold? [1/act] | X is shaken down dirty → Shield | Cheaters shake it down first (the Shield answers this) | M |
| Snitch | Secret target | Target shaken down dirty → +Vote for the rest of the game [+1] | The target frames it back | S |
| Smooth Talker | Double vote (majority only) [×2] | On the winning side of a dirty shakedown → an extra emergency meeting | Votes coordinate against it | S |
| Muscle | Once per game: cancel a pending shakedown [1] | Target was clean → Recharge, and no compensation is paid. Target was dirty → the ledger names the Muscle | Lobbied; its friends look protected | S |
| Priest | Once per act: bless a player. Blessed and shaken down clean → the bank pays the compensation [1/act] | Gets Ballot on who voted for it. Blessed but dirty → no blessing next act | Its flock becomes a free target | M |
| Bagman | Hands in everything → the bank adds +1 to the Haul [+1] | Every round of an act all-in → Alibi | The +1 shows in the Haul maths, so others hide skims behind it | S |
| Cleaner | Its Rooftop visit counts as 2 visitors [×2] | Every 2nd Rooftop round → +Vote | A Rooftop alibi is its easy cover; nobody believes it | S |
| Fixer | Once per game, automatic: a raid stops at 95 Heat; it loses ¼ of its stash [95] | → Shield for the rest of the game | The crew gets reckless with Heat | M |
| Mastermind | Sees the next event card (events on only) | Each checkpoint made → Rig [1] | Blamed for every bad card | M |

### Accomplices (5)

| Role | Power | Reward (trigger → perk) | Knows | Weakness if revealed | Size |
|---|---|---|---|---|---|
| Getaway Driver | Its Rooftop visit *adds* the Heat it would remove (hidden) [×1] | Heat ≥ 75 → learns the saboteurs, and they learn it | Nobody | Rooftop claims that don't cool Heat give it away | S |
| Fence | Up to 5 per act into a safe that shakedowns can't touch (unchanged) [5] | Safe ≥ 10 → learns one saboteur | Nobody | Assumed to be hoarding; first shakedown target | S |
| Hacker | Once per act: loops one room so Security shows it empty (unchanged) [1/act] | Its loop hid a saboteur from a watcher → Peek | One saboteur, from the start | Every empty camera feed is blamed on it | S |
| Blackmailer | Once per act: guess a player's role. Right → steal their vote at the next meeting; the victim is told "your vote is compromised" [1/act] | Guessed a saboteur → they become mutual allies | Nobody | Players hide roles; victims out it | M |
| Forger | Once per act: plant a fake sighting (X shows in room R on that round's watch feeds) [1/act] | A forged player is shaken down clean → Shield | Nobody (the saboteurs know the Forger) | Proof of the dark side; hunted at once | M |

### Saboteurs (2, dealt by the saboteur setting, outside the 18)

| Role | Sabotage | Reward | Weakness if revealed | Size |
|---|---|---|---|---|
| Mole | Once per act: tip-off, +6 Heat hidden in the round's change [6] | Each tip-off → learns one unknown accomplice | Hunted | — |
| Embezzler | Once per act: moves 4 from the Haul to its stash after splits, hidden in the Haul change [4] | The take itself, plus its first take → learns one accomplice | Its stash is always dirty, and a shakedown returns the take | S |

**Changes from v1:** Gambler, Specialist, Miser, Smuggler and Safecracker are cut. Fence and Hacker go back to their original powers as Accomplices; they already hurt the crew. Insider is renamed Inside Man and Accountant becomes Detective. Driver is split into the Fixer (crew) and the Getaway Driver (accomplice). Lawyer becomes the Priest. Planner becomes the Mastermind.

## 3. Dealing: faction mix per crew size

- First, roll the dark side (saboteurs and accomplices) using the weights below. Then draw the roles at random from each faction's eligible pool, at most one of each. Crew fills the remaining seats.
- **Hard limits** (any count):
  - At most ⌊n/3⌋ dark seats.
  - No accomplices without a saboteur.
  - Accomplices ≤ saboteurs + 1.
- **Host setting:** *off* means crew only. *maybe* means a 50% chance of no dark side at 4–8 players. *on* means the weights below.

| Players | Saboteurs / Accomplices (weight) | Fair success rate |
|---|---|---|
| 2–3 | 0 / 0 (crew only; 2p is Duel or bots) | n/a |
| 4 | 1 / 0 | 75% |
| 5–6 | 1 / 0 (50), 1 / 1 (50) | 67–83% |
| 7–8 | 1 / 1 (60), 2 / 0 (20), 1 / 2 (20) | 71–75% |
| 9–10 | 2 / 1 (60), 1 / 2 (20), 2 / 2 (20) | 60–70% |
| 11–12 | 2 / 2 (60), 2 / 1 (20), 3 / 1 (20) | 67–75% |

**Fair success rate:** with c crew seats and d dark seats, a crew seat wins about s ÷ c and a dark seat about (1 − s) ÷ d. These are equal when **s = c ÷ n**, so the deal sets the success-rate target. It sits close to today's 55–70% band.

**Eligibility:**
- **Starter set:** Rookie, Inside Man, Lookout, Bagman, Cleaner. No dark side and no events. The Fence leaves the starter set because it is an accomplice now.
- **Not in Duel:** any role that needs meetings (Snitch, Smooth Talker, Muscle, Priest, Detective, Blackmailer).
- **≥4 players:** Snitch, Detective.
- **≥5 players:** Smooth Talker, Muscle, Priest.
- **≥7 players:** Blackmailer, Forger.
- **Events on:** Mastermind.

## 4. Bots: how to play and how to claim

**Default claim policy:**
- When accused at a meeting, a Crew bot claims its true role. The chance is its "lie" parameter inverted.
- A dark bot bluffs a crew role that is hard to disprove (Rookie, Bagman, Cleaner) and never one someone else has already claimed.
- A role claimed twice raises suspicion of both claimants.

| Role | Play | Claim |
|---|---|---|
| Rookie | Plays its personality; uses Tail on the biggest-shortfall room | Freely; a low-risk claim |
| Inside Man | All-in; Peeks its top suspect | Only to defend against a shakedown (always clean) |
| Lookout | Watches the biggest unexplained shortfall | Truthfully, with its sightings as evidence |
| Auditor | Audits its top suspect's claimed room | When posting the audit as evidence |
| Detective | Checks its top suspect; Shield once it is accused | When its "dirty" read is pushed to a vote |
| Snitch | Votes its target at half the threshold | Never (the target would frame it) |
| Smooth Talker | Votes normally | Rarely; a claim invites a vote bloc against it |
| Muscle | Cancels when it rates the target clean | After a cancel that saved a clean player |
| Priest | Blesses its most-trusted player | Never before a vote; after one to vouch |
| Bagman | Leans honest, all-in | Freely |
| Cleaner | Rooftop when its Heat reader says danger | Freely |
| Fixer | Passive; a little more careful | After the save |
| Mastermind | Feeds the next card into its Heat forecast; Rigs Heat-calming cards | Rarely (gets blamed for cards) |
| Getaway Driver | Rooftop when Heat is mid; pockets when it is high | Bluffs Cleaner |
| Fence | Deposits the act's cap; avoids being the top suspect | Bluffs Rookie |
| Hacker | Loops the room its known saboteur picked | Bluffs Auditor |
| Blackmailer | Guesses only with a role from a Peek, a tip or a claim; otherwise skips | Bluffs Detective |
| Forger | Plants its most-trusted rival in the short room | Bluffs Lookout, backing the forged sighting |
| Mole | As today (tip-off about one act in two) | Bluffs Bagman or Rookie |
| Embezzler | Takes in rounds with a crowded high-loot room to blame | Bluffs Inside Man (risky; it would be found dirty) |

## 5. Balance and sim risks

- **Gate:** each role's win rate ÷ (1/n), with max − min ≤ 0.10, across all 20 roles. Faction balance is set by the deal weights (§3), and each role's spread by its one number. Plan on about 40k games per count, about 1–2 h of sim.
- **Perks snowball:** good crews earn more perks and win more. Watch the comeback and decided-early metrics. Peek and Shield are the strongest perks; tune their triggers first.
- **Ballot vs Secret mode:** Secret ballots are never shown today (decisions.md). Either Ballot is refused in Secret mode, or this needs the owner's OK; the design already foresaw an Informant exception.
- **Forger and Hacker make Verified evidence false.** The Hacker's loop already sets that precedent. Say so on the evidence card ("cameras can be tampered with").
- **Fixer vs Mole:** a saved raid cuts the Mole's chances. Tune the tip-off and the Fixer threshold together.
- **Embezzler plus a missed checkpoint is +15 Heat.** Watch whether Embezzler games bust too often at 4–6p.
- **Harder for bots:** Blackmailer, Forger, Priest and Mastermind's Rig. Bots' shakedowns are already 84% accurate, which inflates every "dirty catch" perk. Expect crew info roles to look strong until bot accuracy drops to 50–70%.
- **Inside Man is already +20–25 pp at 2–3p,** before its Peek. Those counts have no dark side, so tune it there.
