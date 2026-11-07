// Test helper (not exported from the package): the content 0.1.0 numbers that
// balance pass 1 changed (docs/balance/balance-1.md). Scripted rule tests play
// exact Hauls, Heat and scores against these numbers, so they pin them through
// GameConfig.contentOverrides and test the rules, not the current balance.
// Tests that assert the shipped numbers themselves read @skimjob/content.
import type { ContentOverrides } from "./types";

/**
 * R6's room yields as coin limits, a bank too big to run short (design §3.2)
 * and R6's coin-measured numbers (checkpoints, clean line and payout), for the
 * R6 rule tests (Heat, checkpoints, shakedowns, role tokens) until S3a.2–S3a.6
 * replace those rules. Moves there grab with `fullGrab(room, pocket, pins)`.
 */
const R6_ROOMS = { vault: { coins: 6 }, office: { coins: 4 }, lobby: { coins: 2 }, depositBoxes: { coins: 5 } } as const;
const R6_BANK = { coinsPerPlayer: 100 } as const;
const R6_SHAKEDOWN = { cleanBelow: 6, payout: 8 } as const;
export const R6_COINS: ContentOverrides = { rooms: R6_ROOMS, bank: R6_BANK, checkpoints: { perPlayer: [7, 15, 23] }, shakedown: R6_SHAKEDOWN };

export const V01_NUMBERS: ContentOverrides = {
  rooms: { ...R6_ROOMS, depositBoxes: { coins: 5, heatPressure: 0 }, managersOffice: { coins: 5 } },
  bank: R6_BANK,
  checkpoints: { perPlayer: [6, 14, 22] },
  shakedown: R6_SHAKEDOWN,
};

/**
 * The content 0.6.0 numbers that balance pass 2 changed (docs/balance/balance-2.md):
 * Shift change Vault Heat ×2 (and police activity +10, the old patrol and
 * tip-off number). Deck tests that script exact Heat pin them the same way.
 */
export const V06_NUMBERS: ContentOverrides = {
  events: { shiftChange: { heatMultiplier: 2 } },
  police: { heat: 10 },
};
