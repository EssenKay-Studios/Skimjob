// Rounds and acts. Kept apart from round.ts so the fold (reduce.ts) can use
// them without importing the round loop. design §4
import { ROUNDS_PER_ACT } from "@skimjob/content";
import type { ActNumber } from "./types";

/** The act a round belongs to: rounds 1–3 are Act 1, and so on. design §4 */
export function actOfRound(round: number): ActNumber {
  return Math.ceil(round / ROUNDS_PER_ACT) as ActNumber;
}

/** True for rounds 3, 6 and 9: the act's meeting and checkpoint come next. design §4 */
export function isLastRoundOfAct(round: number): boolean {
  return round % ROUNDS_PER_ACT === 0;
}
