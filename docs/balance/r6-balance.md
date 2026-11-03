# R6 balance pass: the Extension's numbers

_3 Nov 2026. Content 0.15.0 → 0.16.0. Gates from extension.md Build notes "Sim" and design §17.4: in Balanced, 4–12 players, Standard deck,
events on and off, success 55–70% and per-role parity ≤ 0.10. Final run: "Sim suite" workflow
[41601623086](https://github.com/EssenKay-Studios/Skimjob/actions/runs/41601623086) (20 shards, ±2 pp, 400–6000 games per cell, 110,400 games,
seed `suite`, default bot mix). That run was the baseline until the split-gate pass below, whose final run
[41607419781](https://github.com/EssenKay-Studios/Skimjob/actions/runs/41607419781) (content 0.17.0, 116,600 games) is now `docs/balance/baseline.json`. The first full run with Fence token 10 was
[41600605174](https://github.com/EssenKay-Studios/Skimjob/actions/runs/41600605174). About 20 candidate sets were screened locally first,
with 600–1000 games per cell at 4–12p._

**Update (split gate, content 0.17.0): see "Split parity gate" below — success passes, every ★ role is in its band, Team-role parity is blocked by the Muscle at 9–10p.**

**Result (content 0.16.0): success PASSES in all 18 gated cells. Parity is BLOCKED.** It FAILs in all 9 groups (spread 0.63–1.01, was 0.46–1.59).
No content number can close it (see "Why parity is blocked"). The owner needs to decide on the gate or the rule.

## Numbers changed

| Number | Start (0.15.0) | Tuned (0.16.0) | Why |
|---|---|---|---|
| Teller line loot (9+) | 4 | 5 | 9–12p crews with events off succeeded 52–56%. |
| Manager's office loot (9+) | 4 | 3 | Trims 9–12p with events on after the Teller line raise. |
| Shift change (Vault) | loot ×2, Heat ×1.5 | loot ×1.5, Heat ×2 | This card was the main reason events-on crews ran 8–10 pp above events-off. |
| Quiet night | Heat −10 | −5 | Same: events-on success was 70–81%. |
| Police patrol chance | 25% (1 in 4) | 30% | Brings the 7–9p events-on cells inside the band with a margin. |
| Fence safe | 5 per stretch, token at 10 | 1 per stretch, token at 3 | The Fence was the top role (about 1.9× fair share). At 1 per stretch a token at 10 is unreachable (the first run earned 0 tokens), so the token moves to 3. |
| Balanced 4p | 1 Lone wolf / 0 Wildcards | 1 / 1 | 4p succeeded 76–77%. 1/0 with the new numbers is still 70–73%, and 0/1 is 73–74%. **One seat over the round(n ÷ 3) cap**; owner to confirm. |
| Balanced 8p | 1 / 1 | 2 / 1 | 8p succeeded 70–81%. 2/1 is at the cap. |

Kept at their start values (tried, no gain or worse):
- clean line 6 (= the Detective's line, ruling 3);
- shakedown pay 8;
- Duel wrong call 8;
- shop costs (Peek and Shield 2, others 1): Peek and Shield at 3 changed nothing measurable;
- police Heat +4;
- checkpoints 7 / 15 / 23 and Heat +4 per round: any rise sank 8–12p below 45%;
- Mole tip-off (1 per stretch, 3 per game): 1 per game barely moved parity;
- Embezzler take 1;
- bot settings.

Police chance above 30% makes parity worse: at 45%, the Fence reaches 1.8× at 11–12p.

## Gated cells (final run)

| Players | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|
| Success, events on | 61.3 | 60.3 | 62.9 | 65.9 | 57.7 | 65.8 | 66.5 | 63.6 | 64.6 |
| Success, events off | 64.1 | 63.2 | 66.4 | 68.2 | 58.9 | 62.1 | 63.1 | 60.4 | 62.6 |
| Parity spread (pooled) | 0.63 | 0.67 | 0.71 | 0.76 | 0.79 | 0.71 | 0.88 | 1.01 | 1.01 |
| Parity spread at 0.15.0 | 0.46 | 1.20 | 1.08 | 1.58 | 1.34 | 1.13 | 1.27 | 1.57 | 1.59 |

Each success figure is a PASS: its 95% interval (±1.2–1.6 pp) lies inside 55–70%. Each parity figure is a confirmed FAIL.

Parity improved at every count from 5 to 12. At 4p it got worse (0.46 → 0.63) because of the second dark seat.

**Highest and lowest roles** (all cells pooled, win credit ÷ fair share):

| Highest | Lowest |
|---|---|
| Fence ★ 1.32 | Cleaner 0.57 |
| Mole ★ 1.26 | Rookie, Auditor 0.60 |
| Embezzler ★ 1.04 | Hacker 0.61 |
| Getaway Driver ★ 0.69 | — |

Team roles sit at 0.57–0.69.

Report-only rates in the gated cells (design §17.4 targets, not this task's gates):
- **Heat share of failures:** FAILs at 4–8p (31–63%), at 9p events on (23%) and at 12p events off (8%) (target 10–20%). It passes or is inconclusive elsewhere.
- **Comeback:** passes.
- **Decided early:** passes (7p events-on and 9p events-off are inconclusive at about 14.5%).

## Why parity is blocked

On a failed heist only the ★ roles (Mole, Fence, Getaway Driver, Embezzler) can win. With equal stashes:
- a team role's ratio is about the success rate s;
- a ★ role's ratio is about s + (1 − s)·φ, where φ is the share of failures it wins on.

φ is 1 for the Mole and Fence, about 0.7 for the Embezzler and about 0.3 for the Driver.

At s ≈ 0.6 that alone is a spread of about 0.4, even before stash differences. To reach parity, the ★ roles would need to be top about a third less often than average. Nothing in content can do that while the bots play for success unless leaning (extension.md bot rules).

A local check (an uncommitted engine hack, 600 games per cell) made every ★ failure win count for nothing. Even then the spread was 0.20–0.49 at 4–12p. With success wins only, the spread is 0.15–0.45 in every run.

So ≤ 0.10 is out of reach for content numbers. It is also hard to prove: a sure PASS needs roughly 20k+ games per group.

Options for the owner:
1. **Redefine the gate:**
   - compare Team players among themselves (≤ 0.10), and check ★ roles against their own band (for example 1.0–1.4× fair);
   - or measure parity on success wins only.
2. **A rule that trims ★ failure wins:** for example half credit, or a failure win only by a margin. The sim can test this directly.
3. **Fewer ★ roles in the Balanced mixes, or a bot-rule change** (★ roles lean to failure later or less). Either one moves success too, so it needs a fresh pass.

## Not gated: Starter, Quick, Duel, Truly random

| Setup | Success | Notes |
|---|---|---|
| Starter deck, events off (Quick plays this) | 75% (3p), 86–93% (4–12p) | It was already 86–92% at 0.15.0. The only change is the Teller line, about +4 pp at 9–12p. A cooperative learning game with no ★ roles; parity 0.6–1.5 (Inside Man high). |
| Starter deck, events on | 73% (3p), 83–94% (4–12p) | Same picture. |
| Duel (2p) | 44%, events on or off | Unchanged from 0.15.0 (43.8%). Parity 0.41–0.47. |
| Truly random, 4–12p | 57.8–66.8% (400 games per cell) | Parity 0.56–1.21, mostly Fence, Mole and Embezzler on top (★ by construction). |
| Balanced 2–3p (not gated) | 44% (2p), 65% (3p) | 2p is low, as before. |

Starter, Quick and Duel come from local `pnpm sim` runs: 1000 games per count, and 2000 for Duel.

Quick is the Starter deck with events off and no shop. The sim's Starter games have no tokens either.

If the owner wants Starter nearer the band, the levers are a Starter-only target or Heat. A 90% learning game may be fine as it is.

## Split parity gate (PM provisional, 3 Nov; owner to confirm)

The PM took option 1 (owner away): the ≤ 0.10 spread now covers **Team roles only**, and each **★ role** must sit in a band
relative to the Team-role average. The all-role spread is still printed, report-only. Balanced 4p 1 / 1 is accepted
(provisional) and Starter stays as it is (learning mode, report-only). Code: `splitParityOf` in apps/sim/src/suite/report.ts,
`STAR_BAND` in targets.ts. A ★ role's 95% range is its own interval divided by the Team-average interval.

**Band: 0.9–1.8× the Team-role average.** Why: a Team role's ratio is about the success rate s. A ★ role with an average
stash that also wins every failure it is top in scores about 1 ÷ s against that, which is 1.43 at s = 70% and 1.82 at
the 55% floor; 1.4 is that ceiling only at the top of the success band. The low end, 0.9, lets the Getaway Driver (heat
failures only, about 0.3 of them) sit near the Team roles but not below them. The data agree: across all runs the ★ roles sat
at 0.9–2.6×, and in the final run at 0.98–1.83×. Values above 1.8 (2.0–2.6 at 10–12p before this pass) were ★ bots
leaning to failure and being top, so they were tuned rather than allowed by a wider band.

**Tuning (content 0.16.0 → 0.17.0):**

| Number | Was | Now | Why |
|---|---|---|---|
| ★ lean point (bot setting, extension.md bracket) | 0.4 | 0.8 | ★ bots lean to failure only once it is likely; cuts the Fence and Mole by 0.2–0.5 at 7–12p. |
| Teller line (9+) | 5 loot, no Heat | 6 loot, +10 Heat × share | Moves 9–12p failures from a missed target to Heat: the Embezzler (target only) drops from 2.1–2.6 to 1.6–1.8, the Driver (Heat only) rises to ~1.0. +1 loot keeps success in band. |

Tried and dropped (Sim suite runs, Balanced only): Hacker 2 per act ([41604876333](https://github.com/EssenKay-Studios/Skimjob/actions/runs/41604876333)),
Rooftop 1 loot + Heat 5 a round ([41604887037](https://github.com/EssenKay-Studios/Skimjob/actions/runs/41604887037)),
Auditor and Detective 2 per act ([41604900059](https://github.com/EssenKay-Studios/Skimjob/actions/runs/41604900059)),
Cleaner Rooftop counts as 3 ([41604910734](https://github.com/EssenKay-Studios/Skimjob/actions/runs/41604910734)): none moved Team parity or the ★ roles by
more than noise. Lean 0.6 ([41604965583](https://github.com/EssenKay-Studios/Skimjob/actions/runs/41604965583)) did less than 0.8
([41604977271](https://github.com/EssenKay-Studios/Skimjob/actions/runs/41604977271)). Teller +10 Heat at 5 loot sank 9–12p to 42–51% success
([41606013869](https://github.com/EssenKay-Studios/Skimjob/actions/runs/41606013869)); Manager's office +20 Heat, 4 loot left the Embezzler at 2.2 at 11–12p
([41606031652](https://github.com/EssenKay-Studios/Skimjob/actions/runs/41606031652)). Locally (600–1000 games a cell): clean line 4, Mole 2 tip-offs a game,
Cleaner 1, lean never, TOP_FACTOR 4 — no gain. Current numbers before tuning: [41604814895](https://github.com/EssenKay-Studios/Skimjob/actions/runs/41604814895).

**Final run** [41607419781](https://github.com/EssenKay-Studios/Skimjob/actions/runs/41607419781) (Balanced, events on / off pooled for parity;
`?` = inconclusive, else confirmed):

| Players | Success on / off | Team spread [95%] | Team high / low | ★ Embezzler / Fence / Driver / Mole (× Team avg) | All-role spread (report) |
|---|---|---|---|---|---|
| 4 | 65.1 / 67.7 | 0.10 [0.01–0.18] ? | Hacker 0.70 / Auditor 0.60 | 1.17 / 1.78? / 1.20 / 1.58 | 0.58 |
| 5 | 63.6 / 65.8 | 0.12 [0.03–0.20] ? | Lookout 0.71 / Cleaner 0.59 | 1.24 / 1.83? / 1.25 / 1.63 | 0.58 |
| 6 | 66.3 / 68.4 | 0.06 [0.00–0.15] ? | Muscle 0.68 / Cleaner 0.62 | 1.33 / 1.72? / 1.21 / 1.61 | 0.52 |
| 7 | 68.3 / 69.6? | 0.13 [0.05–0.21] ? | Muscle 0.74 / Cleaner 0.62 | 1.47 / 1.81? / 1.15 / 1.56 | 0.62 |
| 8 | 60.0 / 59.6 | 0.16 [0.07–0.25] ? | Smooth Talker 0.66 / Cleaner 0.50 | 1.66 / 1.81? / 1.13 / 1.70? | 0.58 |
| 9 | 67.0 / 63.9 | **0.26 [0.17–0.35] FAIL** | Muscle 0.81 / Cleaner 0.55 | 1.60 / 1.63? / 1.07 / 1.54 | 0.52 |
| 10 | 68.3 / 64.9 | **0.28 [0.18–0.37] FAIL** | Muscle 0.84 / Cleaner 0.56 | 1.56 / 1.61? / 0.98? / 1.58 | 0.51 |
| 11 | 65.1 / 62.8 | 0.20 [0.10–0.31] ? | Muscle 0.76 / Cleaner 0.55 | 1.83? / 1.67? / 0.99? / 1.64 | 0.63 |
| 12 | 67.2 / 64.2 | 0.20 [0.09–0.32] ? | Muscle 0.77 / Cleaner 0.56 | 1.76? / 1.73? / 1.05 / 1.63 | 0.59 |

- **Success:** PASS in 17 of 18 cells, 7p events-off inconclusive at 69.6%.
- **★ band:** 22 of 36 confirmed PASS, 14 inconclusive (mostly the Fence and Embezzler near 1.8), **no FAIL** (before this pass: 16 confirmed FAILs, run 41604814895).
- **Team spread:** confirmed FAIL at 9–10p, inconclusive (point 0.06–0.20) elsewhere. A confirmed PASS needs ~20k games a group.
- **All-role spread (report):** 0.51–0.63, was 0.63–1.01.

**Team parity is BLOCKED.** The binding roles are the Muscle on top at 7–12p (its bot cancels a shakedown of itself, design §8)
and the Cleaner at the bottom (it cools on the 0-loot Rooftop). No content number moved them: Rooftop loot lifts the Cleaner but
adds ~10 pp success. Options for the owner:
1. Muscle: no self-cancel (only a clean other player), or its cancel costs it the token / Recharge — a bot or rule change.
2. Cleaner: its Rooftop visit pays 1–2 loot to the Cleaner only (a role change), so its stash is not the crew's lowest.
3. Accept a Team spread of ≤ 0.20 at 7–12p (provisional) until playtests show whether bots or humans drive the gap.

**Not gated, content 0.17.0:** Truly random 4–12p 58.8–68.2% success; Balanced 2p 44%, 3p 65%. Duel 44% (local, 2000 games,
unchanged). Starter 9–12p 94–96% (local, 1000 games; was 86–93%, the Teller line's +1 loot outweighs its Heat for a cooperative
crew) — Starter is left as it is (learning mode, report-only).
