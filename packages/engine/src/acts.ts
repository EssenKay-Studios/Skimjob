// Acts: the stretches of 3 rounds that end in a regular meeting, until S3a.5
// holds meetings at the bank's thirds (design §9.1). Kept apart from round.ts so
// the fold (reduce.ts) can use them without importing the round loop.
import { ROUNDS_PER_ACT } from "@skimjob/content";
import type { ActNumber } from "./types";

/** The act a round belongs to: rounds 1–3 are Act 1, and so on. */
export function actOfRound(round: number): ActNumber {
  return Math.ceil(round / ROUNDS_PER_ACT) as ActNumber;
}

/** True for rounds 3, 6, 9, …: a regular meeting comes next, unless the game has ended (design §6.2). */
export function isLastRoundOfAct(round: number): boolean {
  return round % ROUNDS_PER_ACT === 0;
}
