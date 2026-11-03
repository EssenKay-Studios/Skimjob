# Skimjob — Role deck v3: one crew, natural failure wins

*Approved 3 Nov 2026, as amended by [`extension.md`](extension.md) (Extension wins on any conflict). First drafted 2 Nov (draft PR #45, owner answers folded in); the Extension's amendments and the owner rulings of 3 Nov are folded in below, so this file is self-consistent. A **delta on [`roles-v2.md`](roles-v2.md)**: anything not named here stays as v2 and its R1–R5 builds left it (with the balance pass 3 numbers). Numbers in [brackets] are the sim's tunables: **starting values, tuned by the balance pass**. Built in R6a (rules, content, bots) and R6b (UI); nothing of it is built yet. Canonical rules: [`design.md`](design.md).*

**Design intent (owner):** "like a real-world prisoner's dilemma: you get into a game and don't know what the circle around you is like or what everybody's motives are."

**Core:** there are no teams and no secret groups. Everyone is one crew playing a glorified prisoner's dilemma: skim or hand in, trust or shake down. The game never imposes groups. Players form them only through play and chat. There is one winner per game (or a shared tie), never a team.

**Out of scope (not approved):** the Rebuild ([`rebuild.md`](rebuild.md), the jobs redesign), Books mode and a Mole recruited mid-game. Nothing here depends on them.

## 0. Player language: meetings, not acts

- A game is 9 rounds with a **regular meeting after rounds 3, 6 and 9** (the last one is the final meeting). Players never see the word "act". (The engine may keep numbering the three stretches internally.)
- Every "once per act" power reads **once between meetings**. Only the regular meetings after rounds 3, 6 and 9 recharge these powers; **emergency meetings don't** (owner, 3 Nov).
- Role claims: once between meetings per player (not in Duel).
- **Duel mode** (no meetings): the "between meetings" limits reset after rounds 3 and 6 (owner, 3 Nov).

## 1. Win rule (replaces design §3's two-sides rule and v2 §0)

1. **Rank every player** by final score, then apply today's tie-breaks (fewer shakedowns, then more total loot handed in). The **top group** is everyone still level at the top.
   - **Score = stash + Fence safe + the Inside Man's bonus**, whole numbers only. The Inside Man scores **+1 per [5] loot** the Haul ends above the final target (rounded down). The Rookie has **no multiplier** (×1.05 is gone).
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
6. **Engine (size S–M, `end.ts`):** `RoleDef.faction` and `isDarkSide` go. A `winsOn: ("heat" | "target")[]` field on the four roles replaces them. `stashMultiplier` and `SCORE_DECIMALS` go; scores are integers. The full ranking is still shown on a failure, labelled as a loss unless someone qualified.

**Card text** ("How you win", one line):
- **Everyone:** "If the heist succeeds, the biggest stash wins."
- **Getaway Driver:** "...and if the cops raid the job, you still win with the biggest stash."
- **Mole and Fence:** "...and if the heist fails in any way, you still win with the biggest stash."
- **Embezzler:** "...and if the crew misses the target, you still win with the biggest stash."

## 2. Reveals: all automatic ally reveals go

Dropped: the Hacker knows a saboteur at the deal; the Getaway Driver ↔ saboteur reveal at Heat ≥ 75; the Fence's reveal at safe ≥ 10; the Mole learns an accomplice per tip-off; the Embezzler's first take reveals an accomplice; the Forger is known to the saboteurs; `moleAllies` (**saboteurs no longer know each other**); and the Blackmailer and saboteur becoming mutual allies. The `alliesLearned` event and `roleState.allies` are removed.

**Kept:** every power a player *chooses* to use to learn a role: the Peek perk, the Inside tip, the Detective, the Blackmailer's guess, claims and evidence cards (rules unchanged).

## 3. Tokens and the 3-perk shop (replaces every per-role reward)

Every role reward is now **one token** [1]. Tokens buy perks from a shop of three. (PR #45's "reveal rewards become a free Peek" is replaced: those four roles earn a token like everyone else, owner, 3 Nov.)

- **The shop:** each game deals **one perk from each column** below, so every game has exactly three. The shop's three perks are public.
- **Costs** [starting values]: Peek 2, Shield 2, every other perk 1.
- **Private until used:** tokens and purchases are private; only using a perk shows (as it does today, e.g. a Shield's "cancelled", an Alibi's "verified").
- **Use:** any time after buying it, **at most one perk per round** per player.
- **Unspent tokens are worth nothing** at the end (they never add to score).
- Perk effects are the nine perks of design §8.3, unchanged.

| Learn | Protect | Sway |
|---|---|---|
| **Peek** (2): learn one player's role | **Shield** (2): your next passed shakedown is cancelled, automatically | **+Vote** (1): +1 vote at one meeting |
| **Ballot** (1): see one player's vote in a meeting | **Alibi** (1): your real room is stamped "verified" for one round | **Emergency** (1): call one more emergency meeting |
| **Tail** (1): watch one extra room next round | **Recharge** (1): a used-up power comes back | **Rig** (1): choose the next event card from two (events on only) |

**Token triggers** ("caught" = shaken down and not clean, §5):

| Role | Earns a token when |
|---|---|
| Rookie, Inside Man, Mastermind | The Haul target is met at meeting 1 or 2 |
| Lookout | Someone it saw is caught |
| Auditor | A visitor of the room it audited (that round) is caught |
| Detective | A player it checked is caught |
| Snitch | Its secret target is caught (replaces the +1 ballot weight) |
| Smooth Talker | It voted for a player who is caught |
| Muscle | Its cancel saved an innocent (clean) player: a token **and** its power back (owner, 3 Nov). Saving a cheater names it in the ledger, as today |
| Priest | A blessing pays out |
| Bagman | It hands in everything 3 rounds running |
| Cleaner | Every 2nd Rooftop round |
| Fixer | Its save stops a raid |
| Getaway Driver | Heat reaches 75 after a round (once per game) |
| Fence | The safe reaches 10 (once per game) |
| Hacker | Its loop hid **a player who pocketed that round** from a Security watcher |
| Blackmailer | A vote it stole decides a shakedown (owner, 3 Nov) |
| Forger | Someone it framed is shaken down clean |
| Mole | Each tip-off (so at most 3 per game; owner, 3 Nov) |
| Embezzler | Its first take |

## 4. Powers, wording and cover

Powers are v2's, with these changes:

- **Detective:** once between meetings, learns whether one player's stash (plus any safe) is **"dirty": [6] or more**. It is the same number as the clean line (§5) and is tuned with it (owner, 3 Nov).
- **Fence:** hides up to [5] loot **between meetings** in a safe that shakedowns **show but can't take**.
- **Mole tip-off:** once between meetings, **any time** (its own public Heat event), +[4] Heat, announced only as **"police activity"**. Max 3 per game.
- **Police patrol** (event card): +[4] Heat, **not shown at the start of the round**; it lands at a random moment, announced as **"police activity"**, exactly like a tip-off. So the crew can't tell bad luck from the Mole.
- **Hacker loop:** Security's feed of the looped room reads **"camera offline"** (not "empty"). The **Power cut** card makes **every** camera read "camera offline". So a loop looks like a one-room power cut.
- **Embezzler:** take [1] (balance pass 3), once between meetings; a shakedown always catches it while it holds a take.
- **Blackmailer, Forger, Auditor, Priest, Hacker:** once between meetings.
- **Muscle:** once per game (comes back after an innocent save, §3).
- **Heat breakdown:** every round's summary lists its Heat parts, e.g. "+4 every round, +10 Vault, −5 Rooftop, +4 police activity". Tip-offs and patrols share the one "police activity" line.

## 5. Meetings, votes and shakedowns (Extension)

- **One vote rule for every crew size:** a shakedown passes if at least half the crew votes and one player gets **more than half of the votes cast** (weights count). The ⅓ plurality at 9–12 is gone.
- **Fixed shakedown numbers:** the target's stash goes into the Haul; a Fence's safe is shown, not taken. If stash + safe is under **[6]**, the target is **clean** and the crew pays them **[8]** out of the Haul (capped at the Haul). Same numbers at every meeting, regular or emergency. These replace 3 × and 5 × the act number.
- **Haul target**, shown as a progress bar to the next meeting: [7] × players by meeting 1, [15] × by meeting 2, [23] × by the final meeting. A miss at meeting 1 or 2 adds +15 Heat and the shortfall carries forward; a miss at the final meeting fails the heist.
- **Gap box:** once alibis are in, the app adds them up (event effects included) and compares them with the Haul's growth: "Alibis say +14, the Haul grew 9: 5 unaccounted for."
- **Shakedown window** (PM call of 2 Nov, now in token terms): under Exact roles it opens only when a Muscle is dealt or the Shield is in this game's shop; under Possible / Hidden whenever one could be.

## 6. Labels, decks and dealing

- **Temperament tag** on each card replaces the faction. It describes the role and changes no rule: **Team player** (13: Rookie, Inside Man, Lookout, Auditor, Detective, Snitch, Smooth Talker, Muscle, Priest, Bagman, Cleaner, Fixer, Mastermind), **Wildcard** (Getaway Driver, Fence, Hacker, Blackmailer, Forger), **Lone wolf** (Mole, Embezzler).
- **Decks** (presets) **plus per-role toggles:**
  - **Starter** (first game, no events): Rookie, Inside Man, Lookout, Bagman, Cleaner. Never deals a Wildcard or Lone wolf.
  - **Standard** (the default, 11 roles): Lookout, Auditor, Detective, Smooth Talker, Muscle, Cleaner, Hacker, Fence, Getaway Driver, Mole, Embezzler. Rookies fill any spare seats.
  - **Everything:** all 20.
  - **Quick games (15 min) use the Starter deck automatically:** 45-second rounds leave no time for powers and tokens.
- **Two deal modes, no mix knob.** The saboteur Off / Maybe / On setting is **removed**, and no other setting replaces it.
  - **Balanced** (default): a researched, **fixed mix per player count**. The balance pass decides how many Wildcards and Lone wolves each crew size gets (starting point: v2 §3's most-weighted row under the round(n ÷ 3) cap), and the host can't change it. Roles come from the host's deck; seats the deck can't fill go to Team players (Rookies last).
  - **Truly random:** each seat is drawn uniformly from the eligible deck. Any mix can come up, even more Lone wolves than Team players (still at most one Mole and one Embezzler).
- **"No wildcards without a lone wolf" and "at most Lone wolves + 1 Wildcards": dropped.** They existed so accomplices had someone to help, and there is no alliance left to serve.
- **Existing configs:** the stored saboteur field is ignored on read. A saved *Off* becomes Balanced with every Wildcard and Lone wolf toggled off, which keeps the crew-only intent. *Maybe* and *On* become plain Balanced.
- **Role list shown to players:** **Exact roles dealt** (default; owner, 3 Nov, closes the Exact vs Possible question), Possible roles, or Hidden. Everyone sees which failure-winners are in play; the hidden information is **who** holds each card and **whose stash is top**.
- Minimum crew sizes and "not in Duel" rules stay as v2 (Snitch and Detective 4+; Inside Man, Smooth Talker, Muscle and Priest 5+; Blackmailer and Forger 7+).
- The sim matrix drops its saboteur-setting axis and adds the deck presets.

## 7. Plain explainers and visual cues (R6b)

- the "How you win" line on every card, and its temperament tag; tapping a role name shows its tag and win line;
- a Roles rulebook sheet with an "Endings" table (success / raid / missed target, and who can win);
- "between meetings" wording everywhere; the gap box, the Haul target bar and the Heat breakdown;
- the shop sheet and your token count;
- an end screen that says "How it ended" and badges the winner's reason ("biggest stash", "raid: Getaway Driver"); the M2-11 reveal also lists tokens earned and perks bought.

## 8. Bots

- **Every bot** keeps a public **ending forecast** (P(success), P(raid), P(miss)) from Haul pace, Heat and the role list, plus a **stash-rank estimate** for itself (from its own stash, shakedown results and the Haul maths).
- **Most roles** (Team players, Hacker, Blackmailer, Forger) win only on success. They keep the job alive and skim when the forecast is safe.
- **Getaway Driver, Mole, Embezzler, Fence:** they lean toward their failure once the forecast for it passes a lean point [0.4] *and* they rate themselves top. Otherwise they play for success, like everyone else. Tip-offs become timed (when Heat after the round would pass ~70).
- **Tokens:** bots earn, buy and spend tokens from the shop (simple priorities per perk; never hoard to the end, since unspent tokens are worthless).
- **Votes and claims:** "never shake down a known ally" goes, and so do the dark/crew bluff tables. Every bot votes on suspicion. Holders of a failure-winner card or an evidence-leaving power (Hacker, Forger) bluff a low-risk role (Rookie, Bagman, Cleaner); the rest claim truthfully when accused (chance 1 − lie). Crew suspicion adds public tells: rising Heat → Driver or Mole (now muddied by patrols); "camera offline" → Hacker or a power cut; a big shown safe → Fence.

## 9. Sim

- **One balance pass** for all of roles v3 and the Extension, run on the sharded **"Sim suite"** GitHub workflow.
- **Gates (owner-confirmed):** per-role parity ≤ 0.10 (win credit ÷ 1/n, all 20 roles, Balanced, counts 4–12; the sim also fixes Balanced's mix per count), and success 55–70%. The "fair success = c ÷ n" formula is retired, because anyone can win a success.
- **Tunables:** the clean line [6] and pay [8], the shop costs, token counts, the Inside Man's [5], Police patrol and tip-off [4], the Fence cap [5], the Embezzler take [1], Balanced's mixes and the bots' lean points.
- **Reports:** the ending split (success / raid / miss); the no-winner rate; the shared-win rate; per failure-winner, wins by success vs by failure; tokens earned and perks bought per role; Truly random, the deck presets and the Exact / Possible / Hidden settings (no gate).
- **Watch:** the Mole and Fence can win either way. They should sit high until the tip-off, safe cap and lean points are tuned. Roles with no failure win (Hacker, Blackmailer, Forger, Inside Man) may sit low. Tune their stash-earning numbers first.

## 10. Open questions

None. PR #45's two questions were answered (Balanced is a fixed researched mix with no host knob; the reveal rewards became tokens), and the 3 Nov owner rulings closed the Extension's gaps. Readings made while folding the docs are listed as provisional in `decisions.md` ("Owner answers, 3 Nov (morning)").
