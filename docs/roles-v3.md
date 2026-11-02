# Skimjob — Role deck v3 proposal: escape clauses and the new win rule

*Game-designer proposal, 2 Nov 2026, for Karthik to approve before R6a builds it. A **delta on `docs/roles-v2.md`**: anything not named here stays as v2 (and its R1–R5 builds) left it. Numbers in [brackets] are the sim's tunables, as in v2. Inputs: design §3 and §8, decisions "Owner answers, 2 Nov", balance pass 3 (PR #43) and the owner's 2 Nov answers.*

**Intent (owner, 2 Nov):** "a truly complex prisoner's dilemma where the environment decides what happens." Some players gain from the job going well, some from it going badly, some from either. **How the heist ends decides who can win.** There is always one individual winner and never a team win.

## 0. Three tiers (replaces v2 §0)

| Tier | Wins on success | Wins on failure | In spirit |
|---|---|---|---|
| **Crew** (13) | Yes | Never | Most team impact; perks reward helping |
| **Accomplices** (5) | Yes, like the Crew | Only the one failure its **escape clause** names | Mixed: greedy powers plus real team value |
| **Saboteurs** (2) | Never | Yes | Truly selfish; nothing gained from the team |

Accomplices no longer "help the saboteurs". They are crew members with a dark power and a private exit. The v2 line "no accomplices without a saboteur" stops being a rule of the game (it stays a deal limit only if Q2 says so).

## 1. The win rule (replaces design §3's two-sides rule)

The engine already knows how the game ended: `success`, or a failure with `FailureReason` `heat` (Heat reached 100, the **raid**) or `target` (final target missed at the last checkpoint). The two failures can't both happen: a raid ends the game at once.

1. **Find the eligible players and their counted score.** Roles are read at the end (a Double-cross can move a player between tiers, as today).
   - **Success:** every Crew and every Accomplice, at their full score (stash, Fence safe, role scoring: Rookie ×, Inside Man bonus). Saboteurs are out.
   - **Failure:** every Saboteur at full score, plus each Accomplice **whose escape clause holds for this ending** (§2), at the score its clause names (full score, or the Fence's safe only). Crew are out.
2. **Rank the eligible players in one list** by counted score, highest first. Saboteurs and escaping accomplices are ranked together with no tier priority: a Fence escaping with a safe of 12 beats a Mole on 11.
3. **Ties** use today's tie-breaks inside that list: fewer shakedowns, then more total loot handed in. Players still level share the win (accepted 2 Nov). This is the only way more than one player wins, and it is never "a team".
4. **Nobody eligible** (a failure with no saboteur dealt and no escape met) → **nobody wins**. The full ranking still shows, labelled as a loss (as today).

Notes:
- "Biggest stash **overall**" in a clause (Getaway Driver) means first in the ranking of **all** players at full score, Crew included, after the same tie-breaks; a shared first counts.
- The end screen always says which ending happened and why each eligible player was eligible (§4.5).
- Size **M** in `end.ts`: an `escape` field on `RoleDef` (`ending: heat | target | any`, a condition, `score: full | safe`) replaces "dark side wins failures". Every condition below is a count over the event log, so no new state.

## 2. Escape clauses (new; one per accomplice)

Each clause is tied to one ending and asks for something that **costs the job or the player**, so it's never a free hedge. The powers themselves don't change from v2 (with the R5 numbers).

| Accomplice | Ending | Clause (exact) | Why it isn't free | Tunable |
|---|---|---|---|---|
| **Getaway Driver** | Heat raid | Eligible if it is first in the full ranking of **all** players. | It has to out-pocket every crew stash, which means skimming hard, and its Rooftop doesn't cool. On a success, that same big stash makes it the top shakedown target. | Rank needed [1st] |
| **Hacker** | Missed target | Eligible if it looped the cameras in **every act** (one loop per act). | Every loop hides skimming from Security. Three loops leave three empty feeds, and each one points at the Hacker. | Acts looped [3] |
| **Forger** | Missed target | Eligible if a player it forged was later **shaken down clean** (never a forgery of itself). | It has to frame an innocent, and a clean shakedown pays compensation out of the Haul. That is how a target gets missed. | Clean framings [1] |
| **Fence** | Any failure | Eligible on any failure, but **only its safe counts** (not its stash). | The safe takes loot out of the Haul. It holds at most 5 per act (15 a game), and a shakedown now shows the safe to everyone. | Safe cap [5/act] |
| **Blackmailer** | Any failure | Eligible on any failure if it **stole 2 votes** (2 right guesses whose meeting opened). | Each right guess tells the victim "your vote is compromised", and it spends the once-per-act guess. It needs 2 of the 3 acts. | Votes stolen [2] |

**Card text** (the role card's "How you win" box, one line each; every card also says "Heist succeeds: biggest stash among Crew and Accomplices wins."):
- *Getaway Driver:* "If the cops raid the job, you win, but only with the biggest stash of anyone."
- *Hacker:* "If the crew misses the target, you can win, but only if you looped the cameras in every act."
- *Forger:* "If the crew misses the target, you can win, but only if someone you framed got shaken down clean."
- *Fence:* "If the heist fails in any way, you can win, but only what's in your safe counts."
- *Blackmailer:* "If the heist fails in any way, you can win, but only if you stole 2 votes."

Saboteur cards: "You win only if the heist fails (raid or missed target). The biggest stash among those who can win takes it."
Crew cards: "You win only if the heist succeeds, with the biggest stash among Crew and Accomplices."

## 3. Ally reveals (replaces the v2 "Knows" column and the reveal rewards)

An accomplice now also gains from a success, so it is a **free agent** with intel. It isn't a loyal ally. Knowing a saboteur lets it **protect** the saboteur (when its clause is in reach) or **sell the saboteur out** (to save the job and win the success).

**Recommendation (Q1 = A): reveals become one-way, accomplice → saboteur.**
- Accomplices still learn saboteurs: Hacker one at the deal, Fence at safe ≥ 10, Getaway Driver at Heat ≥ 75, Blackmailer by guessing one right. This is the accomplice's leverage, and the dilemma turns on it.
- **Saboteurs no longer learn accomplices.** Dropped: Forger known to the saboteurs at the deal, the saboteur side of the Getaway Driver and Blackmailer reveals, and the Mole's and Embezzler's "learn one accomplice". Telling a saboteur who might sell it out would only help the saboteur. Their rewards are replaced: **Mole**: each tip-off → a **Peek**; **Embezzler**: its first take → a **Peek** (a Peek can still land on an accomplice, by luck).
- **Saboteurs still know each other** (recommend; Q4). They win the same endings and still compete for the one win on stash, which is the saboteurs' own small dilemma. At most 2 are ever dealt (Mole and Embezzler).
- Evidence cards: `alliesLearned` stays unshareable as a bare card. A shared ability result can still out a saboteur, and that is how an accomplice sells one out.

## 4. Interactions with the other 2 Nov decisions

1. **Exact role list public (default).** Everyone knows *which* roles are in play, so everyone can read which endings could have a winner. A raid with a Getaway Driver dealt, or a missed target with a Forger or Hacker dealt, is an exit someone holds. The hidden information becomes **who** holds each card and **how close** each clause is. Crew reasoning shifts toward "Heat keeps climbing and the Driver is dealt" or "every act has an empty feed". This is good: it is the "environment decides" layer. With *Possible / Hidden* lists the clauses work the same, only with less to read.
2. **Truly random deal.** Accomplices without saboteurs: **fine under v3**. They play greedy crew with an exit, and a failure is won by an escaping accomplice or by nobody. Truly random can also deal zero crew or 2 saboteurs at 4p; still legal. Recommend the parity gate only on **Balanced**; Truly random is reported, not tuned (Q3). Balanced keeps v2 §3's weights for now; R6 retunes them for the new rule.
3. **Fence safe revealed on a shakedown.** That shows the Fence's escape score to everyone: a big public safe tells the crew "this player wins if we fail", so the crew shakes the Fence down or protects the target. It is the counterweight to the Fence's "any failure" reach. The safe is still not seized.
4. **Mole tip-off any time, as a public Heat event.** The tip-off shows a Mole is acting. With the exact list, it confirms a Mole is dealt. Heat events stack with the Getaway Driver's interest in a raid, so the Mole and the Driver become unwitting partners (and the Fixer's save at 95 denies both). The timing of a tip-off can hint at who made it. The per-act limit and +4 Heat [R5] stay.
5. **Visual cues and plain explainers.** Required for v3 to be learnable:
   - The role card gets a "How you win" box (§2 text), plus a private **escape tracker** on accomplice cards: "Acts looped 2/3", "Votes stolen 1/2", "Safe 8", "Framed clean: not yet", "Rank now: 3rd".
   - The rulebook sheet gets a **tier strip** (Crew / Accomplice / Saboteur, each in its own colour) and an "endings" table (success / raid / missed target → who can win).
   - The **end screen** gets "How it ended: raid", eligible players badged "escaped: Getaway Driver" or "saboteur", and greyed rows for the rest.
   - Tapping a role name shows its tier and its one-line win text.

## 5. Bots (v2 §4 style; deltas only)

Every bot gets a public **ending forecast** (P(success), P(raid), P(miss)) from Haul pace, Heat and the role list. Accomplice bots also get an **escape estimate** (can my clause still be met, and is my counted score competitive?).

| Role | Play | Claim / vote |
|---|---|---|
| Getaway Driver | Crew-like while P(success) is high; above a lean point [0.5] it skims hard and visits the Rooftop | Bluffs Cleaner; votes out a known saboteur when P(success) is high |
| Hacker | Loops every act (that is its clause); loops the room where it skims | Sells out its known saboteur when P(miss) is low |
| Forger | Forges only once P(miss) passes its lean point, framing the most-trusted crew stash in the short room | Backs the forged sighting at the meeting |
| Fence | Safes the cap each act (it counts both ways); avoids being top suspect | Bluffs Rookie; after a shakedown shows the safe, argues "it's my hedge, not theft" |
| Blackmailer | Guesses every act from known roles (it needs 2 right) | Votes by forecast, not by alliance |
| Mole / Embezzler | As today; the tip-off is now timed (fires when Heat after the round would pass a level [~70]) | No longer trusts accomplices; treats a known accomplice as a probable seller |
| Crew | Adds suspicion from public clauses: a Heat climb → Getaway Driver, empty feeds → Hacker, a clean shakedown after a sighting → Forger | Unchanged |

- Remove "bots never vote to shake down a known ally" for accomplices: they vote by forecast. Saboteurs keep it for each other.
- Bots that track an escape read only their own view (their own counts, public events), as now.

## 6. What the sim must measure

- **Gates (owner-confirmed):** per-role parity ≤ 0.10 (win credit ÷ fair share, all 20 roles, Balanced deal, saboteurs on, each count 4–12); success 55–70%. The 30–40% saboteur target is dropped.
- **New reports per count:**
  - the ending split (success / raid / miss);
  - per accomplice, wins by success vs by escape, and how often its clause was met at a failure (the **hedge rate**; a rate near 100% means the clause is free);
  - the no-winner rate;
  - the shared-win rate;
  - how often a Fence, Driver, Hacker, Forger or Blackmailer **beat a saboteur** at a failure;
  - sell-outs (accomplice-voted shakedowns of a known saboteur).
- **Tuning order:** clause tunables first (§2 column), then the lean points, then the deal weights. The v2 "fair success rate c ÷ n" no longer holds, because accomplices share success wins. R6 replaces it with the measured fair rate per deal mix.
- **Also report** Truly random and the Exact / Possible / Hidden list settings separately (no gate).

## 7. Open questions for Karthik

1. **Ally reveals?** **A. One-way: accomplices learn saboteurs, saboteurs don't learn accomplices; the Mole and Embezzler get a Peek instead (recommended).** B. Keep the v2 mutual reveals. C. No reveals at all.
2. **Accomplices without a saboteur in the Balanced deal?** **A. Not in Balanced (keep the v2 limit there); allowed in Truly random only (recommended).** B. Allowed in both. C. Never, in either.
3. **Balancing Truly random?** **A. Parity gate on Balanced only; Truly random reported, not tuned (recommended).** B. Tune both to ≤ 0.10. C. Lobby warns that Truly random is unbalanced, no sim report.
4. **Do saboteurs know each other?** **A. Yes, as today (recommended).** B. No: each saboteur plays alone. C. Only the Mole learns the Embezzler.
