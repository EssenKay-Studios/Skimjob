# Balance pass 3: R5 role parity (role deck v2)

_2 Nov 2026. Content 0.13.0 → 0.14.0. `pnpm sim:suite`, default bot mix (honest/opportunist/greedy/cautious 1:1:1:1), seed `suite`, one worker.
Before: `-p 2-12 --mole on --events off -n 400` on main (0.13.0). After: `-p 2-12 --mole on --events on,off -n 1500` (1600 games per cell,
3200 per parity group), and the refreshed `docs/balance/baseline.json` (whole matrix, ±5 pp, 200–400 games per cell)._

**Status: provisional.** Parity improved a lot (spread 1.4–5.6 → 0.4–0.8) but the ±0.10 gate is not met at any count from 4 players up,
and the success and saboteur-win bands conflict with parity (see "Targets that conflict"). The owner's next rule changes (public role
multiset, deal styles, Fence safe shown in shakedowns, tip-off as its own public Heat event) will need a new pass anyway.

## What changed

**Rules** (design §8, §8.1; roles-v2 §2, §3):

| Change | Before | After | Why |
|---|---|---|---|
| Dark-seat cap | ⌊n ÷ 3⌋ | n ÷ 3 rounded (⌊(n+1) ÷ 3⌋): 1 at 4, 2 at 5–7, 3 at 8–10, 4 at 11–12 | STATUS asked to revisit the 5-player cut. 5p never dealt an accomplice, and its fair success rate was 80% (far above 55–70%). With 1/1 allowed, 5p's fair rate is 70% and the measured rate 70% (events off). 8 and 11 now play their table rows as written. |
| Getaway Driver | Rooftop visit *adds* the Heat it would remove (×1) | Rooftop visit cools nothing (`reverse` ×0) | It was the dark side's top seat at 5–10p (1.3–1.8× fair share). Its Rooftop claim is still a lie the Heat number gives away. |

**Numbers** (packages/content):

| Number | Before | After | Why |
|---|---|---|---|
| Embezzler take | 4 per act | 1 | It was the best dark-side stash in nearly every failure: 1.8–5.7× fair share, the top role at every count from 4 to 12. |
| Mole tip-off | +6 Heat | +4 | The saboteurs won 35–59% at 4–12p. |
| Final target | 24 × crew | 23 × crew | Success at 7–12p was 17–47%, against fair rates of 66–73%. |
| Deposit boxes, crowded | 3 each | 4 each | 5–8p crews succeeded well under the fair rate. |
| Teller line | 3 | 4 | Two saboteurs and up to two accomplices sank 9–12p crews (17–31% success). Back to its pre-1 Nov value. |
| Rookie | ×1.2 | ×1.05 | Top of the crew at most counts. |
| Inside Man | 0.3 per loot over the target | 0.15 | With the lower target it overshot more: top role at 5–12p at 0.2. |

**Bots** (packages/bots; play choices, not rules):
- **Bagman:** all-in through Act 1 only, then its personality (covered by the Alibi it earned). All-in every round, it was last at almost
  every count (0.04–0.45× fair share).
- **Hacker:** loops its own room when it skims, else its saboteur's. Looping only for its saboteur left it the dark side's smallest stash.
- **Getaway Driver:** pockets recklessly from 0.9 of the raid level (was 0.75); goes to the Rooftop at mid Heat with chance 0.4 (was 0.6).
- **Crew hunch:** seeded by a hidden `crewSeed` the harness passes (sim: from the game seed; server: `sha256(crew, game seed)`), not public
  data (STATUS follow-up from the #37 review). The public digest stays as a fallback when no `crewSeed` is given.

## Results (mole on)

Success % / saboteur win % / dark side win %, before (0.13.0, events off, 400 games) → after (events off | events on, 1600 games):

| Players | Fair success (c ÷ n) | Success | Saboteur wins | Dark side wins |
|---|---|---|---|---|
| 2 | n/a | 52 → 52 \| 54 | – | – |
| 3 | n/a | 64 → 70 \| 70 | – | – |
| 4 | 75 | 60 → 78 \| 81 | 40 → 22 \| 19 | 40 → 22 \| 19 |
| 5 | 70 | 58 → 70 \| 76 | 42 → 22 \| 17 | 42 → 30 \| 24 |
| 6 | 75 | 54 → 73 \| 76 | 35 → 20 \| 18 | 46 → 27 \| 24 |
| 7 | 71 | 47 → 74 \| 81 | 40 → 16 \| 12 | 53 → 26 \| 19 |
| 8 | 72 | 46 → 76 \| 82 | 36 → 14 \| 12 | 54 → 24 \| 18 |
| 9 | 67 | 26 → 65 \| 74 | 51 → 22 \| 16 | 74 → 35 \| 26 |
| 10 | 70 | 31 → 69 \| 78 | 50 → 19 \| 13 | 69 → 31 \| 22 |
| 11 | 65 | 28 → 68 \| 78 | 57 → 20 \| 12 | 72 → 32 \| 22 |
| 12 | 68 | 17 → 68 \| 79 | 59 → 19 \| 12 | 83 → 32 \| 21 |

Role parity (max − min of win credit ÷ fair share, events pooled), before (events off, 400 games) → after (3200 games):

| Players | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 0.10 | 0.34 | 1.41 | 1.95 | 2.41 | 3.19 | 3.33 | 3.76 | 4.25 | 4.80 | 5.58 |
| After | 0.23 | 0.14 | 0.39 | 0.52 | 0.44 | 0.57 | 0.75 | 0.44 | 0.48 | 0.67 | 0.51 |
| Top / bottom after | cleaner / mastermind | lookout / rookie | rookie 1.17 / embezzler 0.78 | fixer 1.16 / hacker 0.63 | mole 1.13 / hacker 0.69 | muscle 1.21 / blackmailer 0.63 | rookie 1.26 / hacker 0.52 | mastermind 1.21 / hacker 0.77 | muscle 1.23 / forger 0.75 | muscle 1.29 / forger 0.63 | rookie 1.17 / blackmailer 0.66 |

At 2–3 players there is no dark side, so every ratio is below 1 (a failed heist is won by nobody) and only the spread matters.
The 95% range of the spread excludes 0.10 (FAIL) at every count from 4 up except 9 (inconclusive).

## Targets that conflict

- **Parity sets the success rate.** A crew seat and a dark seat have equal chances only when success = crew seats ÷ n (design §8.1's
  "fair success rate"): 65–75% from 4 to 12 players, above the 55–70% band at 4, 6, 7 and 8. With events off the measured success is now
  within about 4 pp of fair at every count from 4 up; with events on it is 5–13 pp above (the dark side is weaker there).
- **Saboteur win 30–40%** cannot hold with parity: the saboteurs are 1–3 of n seats, so their fair share of wins is 11–25%, and accomplices
  take part of the dark side's wins. Measured: 14–22% (events off). Suggest replacing it with "dark side wins ≈ dark seats ÷ n".
- **Mole off and maybe** crews succeed more now (baseline: 80–87% mole off, events off, 4–12p), because the target and room changes
  help every crew. Only the mole-on parity was tuned. A target that depends on the saboteur setting would separate them (owner question).

## Remaining gaps

1. **±0.10 parity is not reached.** Remaining point spreads are 0.4–0.8 at 4–12p. Much of that is noise (with ~20 roles and a per-role
   interval of about ±0.1–0.2 at this sample, max − min of a balanced deck is still ~0.3–0.5), but some gaps repeat across runs:
   - Hacker, Blackmailer and Forger are the lowest seats at 7–12p (0.5–0.8). Their powers help the dark side but not their own stash.
   - The Muscle sits high at 7–12p (1.15–1.29), and the Rookie at 4, 8, 11 and 12p.
   - With events on the whole dark side is under its fair share (success 74–82% at 7–12p).
2. **2 players:** success 52–54% (band 55–70%), Heat 44–50% of failures. 2p shares every number with bigger crews; this has been open since balance pass 2.
3. **Inside Man at 2–3 players:** not dealt there since the owner's 1 Nov answer (`minPlayers: 5`), so nothing to tune.
4. Confirming ±0.10 needs ~40k games per count (roles-v2 §5), use the sharded "Sim suite" workflow; this machine ran 1600 per cell.
