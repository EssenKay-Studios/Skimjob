# R6 balance pass: the Extension's numbers

_3 Nov 2026. Content 0.15.0 → 0.16.0. Gates from extension.md Build notes "Sim" and design §17.4: in Balanced, 4–12 players, Standard deck,
events on and off, success 55–70% and per-role parity ≤ 0.10. Final run: "Sim suite" workflow
[41601623086](https://github.com/EssenKay-Studios/Skimjob/actions/runs/41601623086) (20 shards, ±2 pp, 400–6000 games per cell, 110,400 games,
seed `suite`, default bot mix). That run is the new `docs/balance/baseline.json`. The first full run with Fence token 10 was
[41600605174](https://github.com/EssenKay-Studios/Skimjob/actions/runs/41600605174). About 20 candidate sets were screened locally first,
with 600–1000 games per cell at 4–12p._

**Result: success PASSES in all 18 gated cells. Parity is BLOCKED.** It FAILs in all 9 groups (spread 0.63–1.01, was 0.46–1.59).
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
