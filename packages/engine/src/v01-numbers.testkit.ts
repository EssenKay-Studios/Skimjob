// Test helper (not exported from the package): the content 0.1.0 numbers that
// balance pass 1 (and, for the Manager's office, the 1 Nov owner-answers pass) changed (docs/balance/balance-1.md). Scripted rule tests play
// exact Hauls, Heat and scores against these numbers, so they pin them through
// GameConfig.contentOverrides and test the rules, not the current balance.
// Tests that assert the shipped numbers themselves read @skimjob/content.
import type { ContentOverrides } from "./types";

export const V01_NUMBERS: ContentOverrides = {
  rooms: { depositBoxes: { heatPressure: 0, capacity: { max: 2, crowdedLoot: 3 } }, tellerLine: { loot: 3 }, managersOffice: { loot: 5 } },
  checkpoints: { perPlayer: [6, 14, 22] },
  // The Rookie's ×1.2 held from 0.1.0 to 0.13.0 (R5 made it ×1.05).
  roles: { insideMan: { perLootOverFinalTarget: 1 }, rookie: { stashMultiplier: 1.2 } },
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

/**
 * The content 0.13.0 numbers that the R5 parity pass changed (docs/balance/balance-3.md):
 * Deposit boxes 3 each when crowded, Teller line 3, final target 24 per player,
 * Rookie ×1.2, Inside Man 0.3 per loot over the target, Getaway Driver's Rooftop
 * visit adding the Heat it would remove (×1), Mole tip-off +6, Embezzler take 4.
 * Rule tests that script exact numbers pin them the same way.
 */
export const V013_NUMBERS: ContentOverrides = {
  rooms: { depositBoxes: { capacity: { max: 2, crowdedLoot: 3 } }, tellerLine: { loot: 3 } },
  checkpoints: { perPlayer: [7, 15, 24] },
  roles: {
    rookie: { stashMultiplier: 1.2 },
    insideMan: { perLootOverFinalTarget: 0.3 },
    getawayDriver: { reverse: 1 },
    mole: { heat: 6 },
    embezzler: { take: 4 },
  },
};
