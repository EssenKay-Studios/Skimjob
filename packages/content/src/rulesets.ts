// Rulesets (design §19.2 seam 3): a game names its ruleset, and a ruleset only
// selects content: the roles the deal draws from, the black market's perks, the
// event deck, the job's bank and round cap, and any scripted guide. Engine and
// UI read these fields; they never branch on a ruleset's name. design §14, §19.2
import type { RoleId } from "./index";
import { EVENT_DECK, type EventId } from "./events";
import { PERK_IDS, type PerkId } from "./perks";
import { ROLES } from "./roles";
import { BANK_JOB, type JobDef } from "./jobs";
import { ALIBI_WINDOW_MS } from "./setup";
import { lineWords } from "./text";

export type RulesetId = string;

/**
 * One scripted guide pop-up (design §14), shown once while planning: from `round`
 * on if set, once you have locked in if `lockedIn`, and once an `after` event is
 * in the public log if set.
 */
export interface GuideStep {
  readonly id: string;
  readonly round?: number;
  readonly lockedIn?: true;
  readonly after?: string;
  readonly title: string;
  readonly lines: readonly string[];
}

export interface RulesetDef {
  readonly id: RulesetId;
  /** Roles the deal draws from, by kind, with the usual counts by crew size. design §11.3 */
  readonly roles: readonly RoleId[];
  /** Perks the black market draws from (one per tier that has any); none is no shop. design §12 */
  readonly perks: readonly PerkId[];
  /** The event deck; none is no events. design §13 */
  readonly events: readonly EventId[];
  /** The job's bank and round cap under this ruleset; absent keeps the job's own. design §6.1, §6.2 */
  readonly bank?: JobDef["bank"];
  readonly roundCap?: number;
  /** Scripted guide pop-ups, in order; none in an ordinary game. design §14 */
  readonly guide: readonly GuideStep[];
}

/** The ruleset of a game that names none. design §19.2 seam 3 */
export const DEFAULT_RULESET: RulesetId = "simplified";

const LEARN_ROLES: readonly RoleId[] = ["lookout", "locksmith", "detective", "hacker"];
const LEARN_BANK = { coinsPerPlayer: 10 } as const;
const LEARN_ROUNDS = 6;
const alibiSeconds = ALIBI_WINDOW_MS / 1000;
const line = lineWords(BANK_JOB.honestyLine);

/** The Learn the game guide, one pop-up per step of a round (design §14). */
const LEARN_GUIDE: readonly GuideStep[] = [
  {
    id: "welcome",
    round: 1,
    title: "Welcome to the crew",
    lines: [
      `You and ${LEARN_ROLES.length - 1} bots rob a small bank in ${LEARN_ROUNDS} short rounds.`,
      "Each round you pick a room, grab coins, and drop each one in the crew duffel or your own pocket.",
      `The duffel is split equally; the pocket is yours. Biggest stash wins, but if less than ${line} of the coins taken reach the duffel, nobody wins.`,
    ],
  },
  {
    id: "role",
    round: 1,
    title: "Your secret role",
    lines: [
      "Everyone has a role with one power. Here they are the Lookout, Locksmith, Detective and Hacker, one each.",
      "Open your role card to read yours and use it. Nobody else sees your role.",
    ],
  },
  {
    id: "move",
    round: 1,
    title: "Your move",
    lines: [
      "Pick a room and how many coins to grab. The Lobby is silent; every other coin rings that room's bell.",
      "A full bell brings a police raid. Drag each coin to the duffel or your pocket, then lock in.",
    ],
  },
  {
    id: "alibi",
    round: 1,
    lockedIn: true,
    title: "Your alibi",
    lines: [
      `When the round ends, a pop-up asks where you were. You have ${alibiSeconds} seconds to pick a room: the truth or a lie.`,
      "Everyone sees your answer, and you can't change it. Miss it and the crew sees the room you were really in.",
    ],
  },
  {
    id: "snapshot",
    round: 2,
    title: "The snapshot card",
    lines: [
      "Last round, as told: every room, its bell, and who says they were there. It's in This round, and every round's card is in the case board.",
      "A dashed ring is what someone says. A solid ring is a fact: no alibi, so that's where they really were. Missing coins are on the duffel line.",
    ],
  },
  {
    id: "marks",
    round: 3,
    title: "Trusted or Liar?",
    lines: [
      "Does an alibi add up with the bells? Tap a crook on a snapshot card to mark them Trusted or Liar for that round.",
      "Only you ever see your marks. They go in your case board.",
    ],
  },
  {
    id: "meeting",
    after: "meetingClosed",
    title: "The crew met",
    lines: [
      "Each time a third of the bank is gone, and after every raid, the crew votes to shake one player down and open their stash.",
      "After any round, anyone can call the crew's one emergency meeting.",
    ],
  },
  {
    id: "end",
    round: LEARN_ROUNDS - 1,
    title: "Nearly away",
    lines: [
      `The job ends when the bank is empty or after round ${LEARN_ROUNDS}.`,
      "Then the reveal shows where everyone really was, every stash, and who won.",
    ],
  },
];

export const RULESETS: Readonly<Record<RulesetId, RulesetDef>> = {
  // R7 Simplified: every role, perk and card, and the job's own numbers.
  simplified: { id: "simplified", roles: Object.keys(ROLES), perks: PERK_IDS, events: EVENT_DECK, guide: [] },
  // Learn the game: you plus 3 bots, one each of four roles, a small bank,
  // about 6 short rounds [tunable], no shop and no events. design §14
  learn: { id: "learn", roles: LEARN_ROLES, perks: [], events: [], bank: LEARN_BANK, roundCap: LEARN_ROUNDS, guide: LEARN_GUIDE },
};

/** Seats in a Learn the game crew: one per role, you plus bots. design §14 */
export const LEARN_SEATS = LEARN_ROLES.length;
