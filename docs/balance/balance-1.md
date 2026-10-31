# Balance pass 1 (M1 task 11)

_1 Nov 2026. Content 0.1.0 → 0.2.0. All figures: `pnpm sim -- -n 1000 -p 2,3,4,6,8,10,12 --no-files`
(1,000 games per player count, default mix honest/opportunist/greedy/cautious 1:1:1:1, seed `sim`, hidden-then-revealed votes, no Mole)._

## What changed

**Bots** (so they play like people, not to hit the targets):
- Heat avoidance: a bot now avoids Heat-raising rooms only once its projected Heat passes its own Heat caution, with the same slope as its Rooftop choice. Before, every bot (even Greedy) cut Vault visits by ×(1 − danger) from round 1, where danger already counts the 36 baseline still to come, so the crew kept Heat far from 100 and Heat never mattered.
- Vote thresholds halved (Honest 4→2, Opportunist 4→2, Greedy 7→4, Cautious 3→1.5): bots almost never pushed a shakedown through.
- Honest skims a little now and then (pocket chance 0.1→0.2; still about 4% of loot, inside the "honest" ≤10% band). Cautious lays low earlier (Heat caution 0.7→0.55).

**Content numbers** (`packages/content`, design §6.2, §7, §8, §11.5):

| Number | Before | After | Why |
|---|---|---|---|
| Checkpoints per player (Acts 1/2/3) | 6 / 14 / 22 | 7 / 15 / 24 | Crews cleared the final target far too easily. |
| Deposit boxes Heat pressure (5–12 players) | 0 | +10 (half the Vault) | Without it 5–8-player Heat almost never bit (bust share 1%, success 83% at 6p). |
| Teller line loot (9–12 players) | 3 | 4 | With the higher targets 10–12-player crews fell to 44–53% success. |
| Insider points per loot over the final target | 1 | 0.3 | The Insider won +39 pp over its fair share. |

Tests that script exact Hauls/Heat pin the 0.1.0 numbers through `contentOverrides` (`packages/engine/src/v01-numbers.testkit.ts`); tests of the shipped numbers assert the new ones.

## Results (default mix)

| Metric (target) | | 2p | 3p | 4p | 6p | 8p | 10p | 12p | all |
|---|---|---|---|---|---|---|---|---|---|
| Success (55–70%) | before | 71 | 82 | 87 | 91 | 86 | 84 | 76 | 82 |
| | after | **45** | 63 | **77** | 69 | 67 | 70 | 60 | 65 |
| Heat share of failures (10–20%) | before | 9 | 2 | 0 | 0 | 0 | 0 | 0 | 2 |
| | after | 51 | 34 | 16 | 13 | 2 | 1 | 0 | 20 |
| Shakedowns per game | before | 0 | 0.82 | 0.70 | 0.74 | 0.85 | 0.39 | 0.30 | 0.54 |
| | after | 0 | 1.05 | 0.87 | 0.91 | 1.03 | 0.48 | 0.39 | 0.68 |
| Shakedown accuracy (50–70%) | before / after | — | 72 / 71 | 77 / 80 | 86 / 83 | 90 / 91 | 95 / 94 | 93 / 93 | 84 / 84 |
| Insider vs fair share (±5 pp) | before | +23 | +43 | +41 | +47 | +45 | +35 | +29 | +39 |
| | after | +13 | +11 | +2 | −3 | −5 | −4 | −8 | −1 |
| Lookout vs fair share | before / after | −8 / −5 | −17 / −12 | −16 / −3 | −13 / −3 | −8 / −2 | −6 / −3 | −5 / −3 | −11 / −4 |
| Comeback (< 50%) | before / after | 72 / 80 | 35 / 49 | 31 / 53 | 25 / 48 | 25 / 37 | 34 / 51 | 36 / 48 | 34 / 50 |
| Decided early (< 15%) | before / after | 18 / 9 | 9 / 10 | 13 / 14 | 10 / 12 | 8 / 9 | 8 / 14 | 6 / 10 | 10 / 11 |

Win rate by pocketing band, all counts (before → after): honest 1% → 1%, moderate 4% → 10%, heavy 23% → 27%. Moderate now beats honest at every count from 3 up, and heavy stays under 50%.
Fence −7 → +2 pp, Rookie −5 → 0 pp overall.

**Sensitivity — fewer heavy pocketers** (`-b honest:2,opportunist:3,greedy:1,cautious:2`): success 62 / 75 / 82 / 77 / 80 / 90 / 87% (all 79%), and a heavy pocketer wins 52% at 10p and 44% at 12p. The numbers are tuned for the default mix; a gentler group will find the job easier.

## Findings that numbers can't fix (questions in STATUS.md)

1. **2 players:** no shakedown can ever pass (one vote each, no self-votes), so there's no policing. Left out of tuning; design §16 already sends 2 humans to bots or Duel mode.
2. **4 players vs 3:** the Insider can't pocket and is always dealt at 4 players (25% of the crew). With the Insider removed from the pool, success drops ~12 pp at 3–6p. 2–4 players share every number, so 4p can't be pulled down without sinking 2–3p.
3. **Big crews barely shake anyone down** (0.4 per game at 10–12p vs ~1 at 3–8p): bots each vote for their own top suspect, and a shakedown needs more than half the votes cast. Bots don't chat, so this overstates the problem, but a lone heavy pocketer in a gentle 10-player crew wins half the time.
4. **Heat busts shrink with crew size** (51% of failures at 2p, 0% at 10–12p): with many players the Vault share averages out, so Heat rises smoothly and the cautious bots catch it. Tried Manager's office +20: no extra busts, only more missed targets. Events (Police patrol, Shift change) should add the swing.
5. **Shakedown accuracy stays at ~84%** and 99% of targets had pocketed: bots accuse only on hard evidence. Expect humans to be noisier; recheck in M2 playtests.
6. **Lookout** stays below fair share at 3p (−12 pp): its information helps the crew, not its own score.

Also tried: Lookout 2 extra rooms (no change to its win share), Vault +18 (success up everywhere).
