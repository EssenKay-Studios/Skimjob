// Test helper (not exported from the package): the content 0.1.0 numbers that
// balance pass 1 (and, for the Manager's office, the 1 Nov owner-answers pass) changed (docs/balance/balance-1.md). Scripted rule tests play
// exact Hauls, Heat and scores against these numbers, so they pin them through
// GameConfig.contentOverrides and test the rules, not the current balance.
// Tests that assert the shipped numbers themselves read @skimjob/content.
import type { ContentOverrides } from "./types";

export const V01_NUMBERS: ContentOverrides = {
  rooms: { depositBoxes: { heatPressure: 0 }, tellerLine: { loot: 3 }, managersOffice: { loot: 5 } },
  checkpoints: { perPlayer: [6, 14, 22] },
  roles: { insideMan: { perLootOverFinalTarget: 1 } },
};

/**
 * The content 0.6.0 numbers that balance pass 2 changed (docs/balance/balance-2.md):
 * Police patrol +10, Shift change Vault Heat ×2, Mole tip-off +10. Deck and
 * Mole tests that script exact Heat pin them the same way.
 */
export const V06_NUMBERS: ContentOverrides = {
  events: { policePatrol: { amount: 10 }, shiftChange: { heatMultiplier: 2 } },
  roles: { mole: { heat: 10 } },
};
