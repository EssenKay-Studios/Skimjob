// Content needed to set up a game: player-count limits and the role deal by
// crew size. Rooms by player count live on the job (jobs.ts). design §11.3, §16

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 12;

/**
 * Longest meeting `slot` a command may name (an opaque label, e.g. an ISO
 * time, ~24 characters). It is stored in the log and sent to every seat. design §11.1, §17.2
 */
export const MAX_SLOT_LENGTH = 64;

/** The crew's emergency pool by crew size [tunable]: 1 meeting for 3–6 players, 2 for 7–12. design §9.3 */
export const EMERGENCY_POOL: Readonly<Record<number, number>> = { 3: 1, 4: 1, 5: 1, 6: 1, 7: 2, 8: 2, 9: 2, 10: 2, 11: 2, 12: 2 };

/** Seats of each role kind in a deal: `either` seats go to eyes or shadows, drawn at random. */
export interface RoleDealCounts {
  readonly eyes: number;
  readonly shadows: number;
  readonly either: number;
}

/**
 * The deal by crew size (design §11.3, §19.2 seam 8): every player gets a
 * role, eyes and shadows differ by at most one (an odd crew's extra seat is
 * `either`). Up to 10 players every role is distinct; at 11–12 a role may
 * repeat, at most `MAX_ROLE_COPIES` times.
 */
export const ROLE_DEAL: Readonly<Record<number, RoleDealCounts>> = {
  3: { eyes: 1, shadows: 1, either: 1 },
  4: { eyes: 2, shadows: 2, either: 0 },
  5: { eyes: 2, shadows: 2, either: 1 },
  6: { eyes: 3, shadows: 3, either: 0 },
  7: { eyes: 3, shadows: 3, either: 1 },
  8: { eyes: 4, shadows: 4, either: 0 },
  9: { eyes: 4, shadows: 4, either: 1 },
  10: { eyes: 5, shadows: 5, either: 0 },
  11: { eyes: 5, shadows: 5, either: 1 },
  12: { eyes: 6, shadows: 6, either: 0 },
};

/** The most copies of one role a deal may hold (11–12 players). design §11.3 */
export const MAX_ROLE_COPIES = 2;

/** The host is offered "replace with a bot" for a player who missed this many rounds in a row. design §15 */
export const REPLACE_AFTER_MISSED_ROUNDS = 2;
