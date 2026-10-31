// Test helper (not exported from the package): the content 0.1.0 numbers that
// balance pass 1 changed (docs/balance/balance-1.md). Scripted rule tests play
// exact Hauls, Heat and scores against these numbers, so they pin them through
// GameConfig.contentOverrides and test the rules, not the current balance.
// Tests that assert the shipped numbers themselves read @skimjob/content.
import type { ContentOverrides } from "./types";

export const V01_NUMBERS: ContentOverrides = {
  rooms: { depositBoxes: { heatPressure: 0 }, tellerLine: { loot: 3 } },
  checkpoints: { perPlayer: [6, 14, 22] },
  roles: { insider: { perLootOverFinalTarget: 1 } },
};
