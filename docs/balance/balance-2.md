# Balance pass 2 (M1 task 16)

_1 Nov 2026. Content 0.6.0 → 0.7.0. 1,000 games per player count and setting, default bot mix
(honest/opportunist/greedy/cautious 1:1:1:1), seed `sim`, default role pool (10 roles, Rookie included),
hidden-then-revealed votes. E.g. `pnpm sim -- -n 1000 -p 2,3,4,6,8,10,12 --events --mole maybe --no-files`._

**Default configuration** (what a host gets unless they change it; provisional, decisions.md): events **on**,
Mole **maybe** (none at 2–4, 0 or 1 at 5–8, 1 or 2 at 9–12), default role pool.

## What changed

**Bots** (small, principled; `packages/bots`):
- Heat projection (`heat.ts`): danger now counts this round's card (Police patrol / Quiet night) and,
  when a Mole may be in play, tip-offs still to come, extrapolated from rounds whose public Heat came out
  ≥ 60% of a tip-off above what the alibis, the bot's own room and the card explain. Nothing seen, nothing
  expected (assuming every Mole tips every act sank 10–12p crews to 21–28% success on missed targets).
- Shift change / Payday: room choice and pocket limits use the surged room; a surged Vault is avoided harder.
- Muscle also cancels a shakedown of someone it thinks is clean (suspicion < 1); Snitch votes for its own
  target at half its usual threshold; Blackmailer uses a role learned from an Inside tip.

**Content numbers** (design §7, §8, §10):

| Number | Before | After | Why |
|---|---|---|---|
| Police patrol | +10 Heat | +5 | With events on, Heat busts were 40% of failures (45% at 6p). |
| Shift change, Vault Heat pressure | ×2 | ×1.5 | Same; the doubled loot still draws the greedy. |
| Mole tip-off | +10 Heat | +6 | Mole won 46–62% at 6–12p (target 30–40%). +5 gave 47% at 12p with 2 Moles in a 300-game probe; 0 gave 26% (the crew's own failure rate). |

Event numbers are now `contentOverrides.events` (each card its own effect's numbers). Scripted deck tests pin
the 0.6.0 numbers with `V06_NUMBERS`.

## Results

Success % / Heat share of failures % / Mole win % (before → after):

| Setting | | 2p | 3p | 4p | 6p | 8p | 10p | 12p | all |
|---|---|---|---|---|---|---|---|---|---|
| **Default** (events, Mole maybe) | success | 39→43 | 59→65 | 71→79 | 61→71 | 60→71 | 52→70 | 47→62 | **56→66** |
| | Heat share | 55→53 | 47→45 | 40→30 | 45→17 | 31→11 | 33→3 | 30→3 | **40→26** |
| | Mole win | | | | 49→33 | 48→34 | 48→30 | 53→38 | **50→34** |
| Events, Mole on | success | | | | 54→67 | 50→65 | 42→64 | 38→59 | 46→64 |
| | Mole win | | | | 46→33 | 50→35 | 58→36 | 62→41 | 54→36 |
| Events, Mole off | success | 39→43 | 59→65 | 71→79 | 70→78 | 70→78 | 82→84 | 75→79 | 66→72 |
| | Heat share | 55→53 | 47→45 | 40→30 | 32→28 | 22→14 | 3→2 | 2→0 | 35→32 |
| No events, Mole off | success | 38→38 | 59→58 | 74→73 | 69→66 | 67→63 | 74→73 | 65→63 | 64→62 |
| | Heat share | 43 | 31→30 | 14→13 | 13→12 | 2 | 0 | 0 | 19→18 |
| No events, Mole on (after only) | success / Mole win | | | | 57 / 43 | 50 / 50 | 47 / 53 | 41 / 59 | 49 / 52 |
| Duel, events (after only) | success / Heat share | 45 / 55 | | | | | | | |

Default, after: shakedown accuracy 85% (was 84), heavy pocketers win 30% (25), moderate 12% (13) vs
honest 4% (5), comeback 47% (45), decided early 13% (9). Role shares within ±5 pp overall except the Fence
(+5) and the Mole's success-share (−11, expected: it can't win a success); Insider still +20–25 pp at 2–3p.
Zero refused commands.

## Open (questions in STATUS.md)

1. **Mole without events** still wins 43–59% at 6–12p: the events deck's net −5 Heat (Quiet night −10 vs
   Police patrol +5) is part of what holds it to 30–41%. Two Moles at 9–12p remain the strongest setting.
2. **Heat busts at 2–4p** stay 30–53% of failures with events on (one Vault visitor is a third of a crew);
   2–4p share every number, so content can't separate them. 10–12p barely bust (0–4%).
3. **4p success 79%** (default) is the Insider effect from pass 1, now with gentler Heat cards.
4. **Events on, Mole off at 6–12p** succeeds 78–84%, above the 55–70% band; the default (Mole maybe) is in band.
5. **Moderate pocketing loses to heavy** at 6–12p (moderate 5–15% vs heavy 25–33% win rate); heavy stays under 50%.
