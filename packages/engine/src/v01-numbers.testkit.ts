// Test helper (not exported from the package): the content 0.1.0 numbers that
// balance pass 1 changed (docs/balance/balance-1.md). Scripted rule tests play
// exact Hauls and scores against these numbers, so they pin them through
// GameConfig.contentOverrides and test the rules, not the current balance.
// Tests that assert the shipped numbers themselves read @skimjob/content.
import type { ContentOverrides } from "./types";

/**
 * R6's room yields as coin limits, a bank too big to run short (design §3.2),
 * bells too big to raid (design §5.3) and R6's clean line and payout, for the
 * R6 rule tests (shakedowns, role tokens) until S3a.5–S3a.6 replace those rules. Moves there grab with `fullGrab(room, pocket, pins)`.
 */
const R6_ROOMS = { vault: { coins: 6 }, office: { coins: 4 }, lobby: { coins: 2 }, depositBoxes: { coins: 5 } } as const;
const R6_BANK = { coinsPerPlayer: 100 } as const;
const R6_SHAKEDOWN = { cleanBelow: 6, payout: 8 } as const;
const R6_QUIET = { bulbs: 1000 } as const;
/** Bells too big to raid (design §5.3), for tests of other rules whose scripted grabs would ring a raid. */
export const NO_RAIDS: ContentOverrides = { alarm: R6_QUIET };
export const R6_COINS: ContentOverrides = { rooms: R6_ROOMS, bank: R6_BANK, alarm: R6_QUIET, shakedown: R6_SHAKEDOWN };

export const V01_NUMBERS: ContentOverrides = {
  rooms: { ...R6_ROOMS, depositBoxes: { coins: 5 }, managersOffice: { coins: 5 } },
  bank: R6_BANK,
  alarm: R6_QUIET,
  shakedown: R6_SHAKEDOWN,
};
