# Skimjob — Role deck v3: one crew, natural failure wins

*Approved by Karthik, 2 Nov 2026. A **delta on `docs/roles-v2.md`**: anything not named here stays as v2 and its R1–R5 builds left it (with the balance pass 3 numbers). Numbers in [brackets] are the sim's tunables. Built in R6.*

**Core:** there are no teams and no secret groups. Everyone is one crew playing a glorified prisoner's dilemma: skim or hand in, trust or shake down. The game never imposes groups. Players form them only through play and chat. There is one winner per game (or a shared tie), never a team.

## 1. Win rule (replaces design §3's two-sides rule and v2 §0)

1. **Rank every player** by final score (stash + Fence safe + role scoring: Rookie ×, Inside Man bonus), then apply today's tie-breaks (fewer shakedowns, then more total loot handed in). The **top group** is everyone still level at the top.
2. **Heist succeeds →** the top group wins, whatever their roles (Mole and Embezzler included).
3. **Heist fails →** nobody wins, **except** members of the top group whose role wins that ending:

| Role | Wins this failure | Test |
|---|---|---|
| Getaway Driver | Heat raid | Biggest stash of all players |
| Mole | Any failure (raid or missed target) | Biggest stash of all players |
| Embezzler | Missed target | Biggest stash of all players |
| Fence | Any failure | Biggest stash of all players (the safe counts) |

4. It is one test, the same as the old Driver's. A failure-winner who isn't in the top group doesn't win, even if it beats every other failure-winner. If no top-group member qualifies, **nobody wins**. Tie-breaks come first: a Mole level on score that loses a tie-break isn't in the top group.
5. Roles are read at the end, so a Double-cross can hand over a failure win, as today.
6. **Engine (size S–M, `end.ts`):** `RoleDef.faction` and `isDarkSide` go. A `winsOn: ("heat" | "target")[]` field on the four roles replaces them. The full ranking is still shown on a failure, labelled as a loss unless someone qualified.

**Card text** ("How you win", one line):
- **Everyone:** "If the heist succeeds, the biggest stash wins."
- **Getaway Driver:** "...and if the cops raid the job, you still win with the biggest stash."
- **Mole and Fence:** "...and if the heist fails in any way, you still win with the biggest stash."
- **Embezzler:** "...and if the crew misses the target, you still win with the biggest stash."

## 2. Reveals: all automatic ally reveals go

Dropped: the Hacker knows a saboteur at the deal; the Getaway Driver ↔ saboteur reveal at Heat ≥ 75; the Fence's reveal at safe ≥ 10; the Mole learns an accomplice per tip-off; the Embezzler's first take reveals an accomplice; the Forger is known to the saboteurs; `moleAllies` (**saboteurs no longer know each other**); and the Blackmailer and saboteur becoming mutual allies. The `alliesLearned` event and `roleState.allies` are removed.

**Kept:** every power a player *chooses* to use to learn a role: the Peek perk, the Inside tip, the Detective, the Blackmailer's guess, claims and evidence cards (rules unchanged).

**Rewards that were reveals become neutral perks:**

| Role | Trigger (unchanged unless noted) | New perk | Why |
|---|---|---|---|
| Getaway Driver | Heat ≥ 75 after a round | **Shield** | High Heat makes it the obvious suspect |
| Fence | Safe ≥ 10, once per game | **Tail** | Lets it watch who is circling; it's already the shakedown magnet |
| Mole | Each tip-off | **Alibi** | The public tip-off makes it a suspect; a true alibi helps it hide |
| Embezzler | Its first take | **Peek** | Information to steer blame |
| Blackmailer | Right guess on any role | (none extra) | The stolen vote is its reward; the saboteur special case goes |
| Hacker | Its loop hid **a player who pocketed that round** from another Security watcher | **Peek** (as today) | The trigger loses "saboteur" and "crew watcher" |
| Forger | Nothing was given to others | None | Its Shield reward stays |

## 3. Labels and dealing

- **Temperament tag** on each card replaces the faction. It describes the role and changes no rule: **Team player** (old crew, 13 roles), **Wildcard** (old accomplices: Getaway Driver, Fence, Hacker, Blackmailer, Forger), **Lone wolf** (old saboteurs: Mole, Embezzler).
- **Host setting "Lone wolves: Few / Some / Many"** replaces saboteurs Off / Maybe / On. It controls the Wildcard + Lone wolf seats with today's code:
  - **Few** = today's *Maybe*: v2 §3 weights, 50% none at 4–8.
  - **Some** (default) = today's *On*.
  - **Many** = *On*, using the next bigger crew's row (12 stays 12), still under the round(n ÷ 3) cap.
  - Crew-only games stay available through the **Starter** preset and per-role toggles.
- **"No wildcards without a lone wolf": dropped.** It existed so accomplices had someone to help, and there is no alliance left to serve. A deal without lone wolves just means fewer failure-winners. With the role list public, everyone can see that. Balanced keeps "at most Lone wolves + 1 Wildcards" for now (sim may lift it).
- Lone wolves are still dealt by this setting and are still distinct (one Mole and one Embezzler at most).

## 4. Kept from the other 2 Nov decisions (unchanged; how they fit)

- **Exact role list public by default** (Possible / Hidden as host options). Everyone sees which failure-winners are in play, so everyone knows whether a raid or a miss can have a winner. The hidden information is **who** holds each card and **whose stash is top**.
- **Deck presets** (Starter / Standard / Everything) **plus per-role toggles**. Deal style **Balanced / Truly random**. Truly random is reported by the sim, not tuned.
- **Fence safe revealed on a shakedown** (not seized). That shows the crew how close the Fence is to the top.
- **Mole tip-off any time**, as its own public Heat event, once per act (+4 Heat, R5).
- **Shakedown-window PM call** stays: with Exact roles it opens only when a Muscle or a Shield-earning role is dealt. Shield earners are now the Detective, Fixer, Forger and **Getaway Driver**.
- **Plain explainers and visual cues:**
  - the "How you win" line on every card, and its temperament tag;
  - an "Endings" table in the rulebook (success / raid / missed target, and who can win);
  - an end screen that says "How it ended" and badges the winner's reason ("biggest stash", "raid: Getaway Driver");
  - tapping a role name shows its tag and win line.

## 5. Bots

- **Every bot** keeps a public **ending forecast** (P(success), P(raid), P(miss)) from Haul pace, Heat and the role list, plus a **stash-rank estimate** for itself (from its own stash, shakedown results and the Haul maths).
- **Most roles** (Team players, Hacker, Blackmailer, Forger) win only on success. They keep the job alive and skim when the forecast is safe.
- **Getaway Driver, Mole, Embezzler, Fence:** they lean toward their failure once the forecast for it passes a lean point [0.4] *and* they rate themselves top. Otherwise they play for success, like everyone else. Tip-offs become timed (when Heat after the round would pass ~70).
- **Votes and claims:** "never shake down a known ally" goes, and so do the dark/crew bluff tables. Every bot votes on suspicion. Holders of a failure-winner card or an evidence-leaving power (Hacker, Forger) bluff a low-risk role (Rookie, Bagman, Cleaner); the rest claim truthfully when accused (chance 1 − lie). Crew suspicion adds public tells: rising Heat → Driver or Mole; an empty feed → Hacker; a big shown safe → Fence.

## 6. Sim

- **Gates (owner-confirmed):** per-role parity ≤ 0.10 (win credit ÷ 1/n, all 20 roles, Balanced, "Some", counts 4–12), and success 55–70%. The "fair success = c ÷ n" formula is retired, because anyone can win a success.
- **Reports:** the ending split (success / raid / miss); the no-winner rate; the shared-win rate; per failure-winner, wins by success vs by failure; Few and Many; Truly random and the Exact / Possible / Hidden settings (no gate).
- **Watch:** the Mole and Fence can win either way. They should sit high until the tip-off, safe cap [5/act] and lean points are tuned. Roles with no failure win (Hacker, Blackmailer, Forger, Inside Man) may sit low. Tune their stash-earning numbers first.

## 7. Open questions for Karthik

1. **"Many" lone wolves:** **A. Next bigger crew's row, under the round(n ÷ 3) cap (recommended).** B. Always the most dark-heavy row in each count's table. C. Drop Many and keep only Few / Some.
2. **Replacement perks:** **A. The mix in §2 (Shield, Tail, Alibi, Peek) (recommended).** B. Peek for all of them (simpler, but a lot more role info in play). C. No replacement (those roles lose a reward and the sim compensates).
