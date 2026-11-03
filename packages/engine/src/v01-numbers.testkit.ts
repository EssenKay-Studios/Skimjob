// Test helper (not exported from the package): the content 0.1.0 numbers that
// balance pass 1 (and, for the Manager's office, the 1 Nov owner-answers pass; for the Teller line Heat, the R6 split-gate pass) changed (docs/balance/balance-1.md). Scripted rule tests play
// exact Hauls, Heat and scores against these numbers, so they pin them through
// GameConfig.contentOverrides and test the rules, not the current balance.
// Tests that assert the shipped numbers themselves read @skimjob/content.
import type { ContentOverrides } from "./types";

export const V01_NUMBERS: ContentOverrides = {
  rooms: { depositBoxes: { heatPressure: 0, capacity: { max: 2, crowdedLoot: 3 } }, tellerLine: { loot: 3, heatPressure: 0 }, managersOffice: { loot: 5 } },
  checkpoints: { perPlayer: [6, 14, 22] },
  // The Inside Man's bonus is whole points since 0.15.0 (extension.md "Scoring"): 1 per loot pins the old +1 per loot.
  // The Fence's safe: 5 an act, a token at 10 until the R6 balance pass (docs/balance/r6-balance.md).
  roles: { insideMan: { lootPerPointOverFinalTarget: 1 }, fence: { perAct: 5, tokenSafe: 10 } },
};

/**
 * The content 0.6.0 numbers that balance pass 2 changed (docs/balance/balance-2.md):
 * Shift change Vault Heat ×2 (and police activity +10, the old patrol and
 * tip-off number). Deck tests that script exact Heat pin them the same way.
 * Also the numbers they script that the R6 balance pass changed (Shift change
 * Vault loot ×2, Quiet night −10, the Fence's safe 5 an act).
 */
export const V06_NUMBERS: ContentOverrides = {
  events: { shiftChange: { lootMultiplier: 2, heatMultiplier: 2 }, quietNight: { amount: -10 } },
  police: { heat: 10 },
  roles: { fence: { perAct: 5, tokenSafe: 10 } },
};

/**
 * The content 0.13.0 numbers that the R5 parity pass changed (docs/balance/balance-3.md):
 * Deposit boxes 3 each when crowded, Teller line 3, final target 24 per player,
 * Getaway Driver's Rooftop visit adding the Heat it would remove (×1),
 * Embezzler take 4. (The Rookie's multiplier and fractional Inside Man bonus
 * are gone since 0.15.0.)
 * Rule tests that script exact numbers pin them the same way.
 */
export const V013_NUMBERS: ContentOverrides = {
  rooms: { depositBoxes: { capacity: { max: 2, crowdedLoot: 3 } }, tellerLine: { loot: 3 } },
  checkpoints: { perPlayer: [7, 15, 24] },
  roles: {
    getawayDriver: { reverse: 1 },
    embezzler: { take: 4 },
  },
};

/**
 * The content 0.15.0 numbers that the R6 balance pass changed (docs/balance/r6-balance.md):
 * Teller line 4, Manager's office 4, Shift change Vault loot ×2 and Heat ×1.5,
 * Quiet night −10, police patrol chance 25%, the Fence's safe 5 an act with a
 * token at 10. Rule tests that script exact numbers pin them the same way.
 */
export const V015_NUMBERS: ContentOverrides = {
  rooms: { tellerLine: { loot: 4 }, managersOffice: { loot: 4 } },
  events: { shiftChange: { lootMultiplier: 2, heatMultiplier: 1.5 }, quietNight: { amount: -10 } },
  police: { chancePercent: 25 },
  roles: { fence: { perAct: 5, tokenSafe: 10 } },
};
