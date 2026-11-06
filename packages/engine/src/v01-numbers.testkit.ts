// Test helper (not exported from the package): the content 0.1.0 numbers that
// balance pass 1 (and, for the Manager's office, the 1 Nov owner-answers pass; for the Teller line Heat, the R6 split-gate pass) changed (docs/balance/balance-1.md). Scripted rule tests play
// exact Hauls, Heat and scores against these numbers, so they pin them through
// GameConfig.contentOverrides and test the rules, not the current balance.
// Tests that assert the shipped numbers themselves read @skimjob/content.
import type { ContentOverrides } from "./types";

export const V01_NUMBERS: ContentOverrides = {
  rooms: { depositBoxes: { heatPressure: 0, capacity: { max: 2, crowdedLoot: 3 } }, tellerLine: { loot: 3, heatPressure: 0 }, managersOffice: { loot: 5 } },
  checkpoints: { perPlayer: [6, 14, 22] },
};

/**
 * The content 0.6.0 numbers that balance pass 2 changed (docs/balance/balance-2.md):
 * Shift change Vault Heat ×2 (and police activity +10, the old patrol and
 * tip-off number). Deck tests that script exact Heat pin them the same way.
 * Also the number they script that the R6 balance pass changed (Shift change
 * Vault loot ×2).
 */
export const V06_NUMBERS: ContentOverrides = {
  events: { shiftChange: { lootMultiplier: 2, heatMultiplier: 2 } },
  police: { heat: 10 },
};

/**
 * The content 0.15.0 numbers that the R6 balance pass changed (docs/balance/r6-balance.md):
 * Teller line 4, Manager's office 4, Shift change Vault loot ×2 and Heat ×1.5,
 * police patrol chance 25%. Rule tests that script exact numbers pin them the same way.
 */
export const V015_NUMBERS: ContentOverrides = {
  rooms: { tellerLine: { loot: 4 }, managersOffice: { loot: 4 } },
  events: { shiftChange: { lootMultiplier: 2, heatMultiplier: 1.5 } },
  police: { chancePercent: 25 },
};
