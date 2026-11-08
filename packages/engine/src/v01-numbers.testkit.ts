// Test helper (not exported from the package): numbers that scripted rule tests
// pin through GameConfig.contentOverrides, so they test the rules, not the
// current balance. Tests that assert the shipped numbers read @skimjob/content.
import type { ContentOverrides } from "./types";

/**
 * R6's room yields as coin limits, a bank too big to run short (design §3.2),
 * bells too big to raid (design §5.3) and R6's clean line and payout, for the
 * R6 rule tests (shakedowns, role tokens) until S3a.5–S3a.6 replace those rules. Moves there grab with `fullGrab(room, pocket, pins)`.
 */
const R6_ROOMS = { vault: { coins: 6 }, office: { coins: 4 }, lobby: { coins: 2 }, depositBoxes: { coins: 5 } } as const;
const R6_BANK = { coinsPerPlayer: 100 } as const;
const R6_QUIET = { bulbs: 1000 } as const;
/** Bells too big to raid (design §5.3), for tests of other rules whose scripted grabs would ring a raid. */
export const NO_RAIDS: ContentOverrides = { alarm: R6_QUIET };
export const R6_COINS: ContentOverrides = { rooms: R6_ROOMS, bank: R6_BANK, alarm: R6_QUIET };
