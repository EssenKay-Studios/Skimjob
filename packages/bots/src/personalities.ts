// Bot personalities as plain parameter sets: one decision code path, tuned by
// numbers. design §17.3 (Greed / Lies / Suspicion columns)
//
// These are bot settings, not game rules, so they live with the bots rather
// than in @skimjob/content. The simulator (task 10) can pass its own sets.

export interface Personality {
  readonly name: string;
  /** Chance, each round in a looting room, of pocketing anything at all. design §17.3 "Greed" */
  readonly pocketChance: number;
  /** When pocketing, roughly this share of the room's loot (0–1). */
  readonly greed: number;
  /** Chance of a cover-up alibi (a cheaper room) after pocketing. design §17.3 "Lies" */
  readonly lie: number;
  /** Only lie when nobody else was in the room ("when safe"). */
  readonly lieOnlyWhenAlone: boolean;
  /** Chance of keeping the Haul on pace for the act's checkpoint (pocketing less when it's behind). design §11.5 */
  readonly teamSpirit: number;
  /** Shake down the most suspicious player once their score reaches this. Lower is more suspicious. design §17.3 "Suspicion" */
  readonly voteAt: number;
  /** Call the one emergency meeting once someone's score reaches this; null never does. design §11.1 */
  readonly emergencyAt: number | null;
  /** Chance of spending a round in Security. design §17.3 (Cautious "checks Security often") */
  readonly watch: number;
  /**
   * How far it keeps clear of a raid and a bust (0–1): how much a bell close
   * to its last bulb puts it off a room, its chance of grabbing only what keeps
   * the bell below a raid, and (× bust danger²) of lying low on the Rooftop
   * near the bust line. design §5.2, §5.3, §5.5
   */
  readonly caution: number;
  /** Chance that any one decision is made uniformly at random instead. 1 = the Random bot. */
  readonly noise: number;
  /**
   * How far off its own reading of the evidence can be at a vote: up to this
   * many suspicion points either way, per player (people misjudge; v2 §5). design §17.3 "Suspicion"
   */
  readonly misread: number;
  /**
   * How far it goes along with the crew's shared hunch at a vote (`crewHunch`
   * in bot.ts, the same for every bot at a meeting), in suspicion points
   * either way. Shared misreadings are what carry a majority to a clean
   * target: bot shakedowns were ~92% accurate without it, vs the 50–70%
   * design §17.4 target (v2 §5). design §17.3 "Suspicion"
   */
  readonly hunch: number;
}

export type PersonalityId = "honest" | "opportunist" | "greedy" | "cautious" | "random";

/**
 * The design §17.3 bots. A dealt Mole plays its personality with Mole habits on
 * top (a ring on the loudest bell, at most once per act; bot.ts).
 * Placeholder numbers, to tune with the simulator.
 */
export const PERSONALITIES: Readonly<Record<PersonalityId, Personality>> = {
  // Hands in nearly everything, never lies, votes on the evidence.
  honest: {
    name: "Honest",
    pocketChance: 0.2,
    greed: 0.2,
    lie: 0,
    lieOnlyWhenAlone: true,
    teamSpirit: 1,
    voteAt: 2,
    emergencyAt: null,
    watch: 0.15,
    caution: 0.6,
    noise: 0.02,
    misread: 1,
    hunch: 7,
  },
  // Pockets a fair share, and covers it with a false alibi when nobody saw it.
  opportunist: {
    name: "Opportunist",
    pocketChance: 0.5,
    greed: 0.5,
    lie: 0.9,
    lieOnlyWhenAlone: true,
    teamSpirit: 0.7,
    voteAt: 2,
    emergencyAt: null,
    watch: 0.1,
    caution: 0.5,
    noise: 0.02,
    misread: 1,
    hunch: 7,
  },
  // Pockets often and big, lies often, rarely votes: stress-tests the bells and checkpoints.
  greedy: {
    name: "Greedy",
    pocketChance: 0.8,
    greed: 0.8,
    lie: 0.7,
    lieOnlyWhenAlone: false,
    teamSpirit: 0.2,
    voteAt: 4,
    emergencyAt: null,
    watch: 0.05,
    caution: 0.2,
    noise: 0.02,
    misread: 1,
    hunch: 7,
  },
  // Hands in nearly everything, lays low on the Rooftop and checks Security often; quick to suspect.
  cautious: {
    name: "Cautious",
    pocketChance: 0.1,
    greed: 0.2,
    lie: 0.2,
    lieOnlyWhenAlone: true,
    teamSpirit: 1,
    voteAt: 1.5,
    emergencyAt: 7,
    watch: 0.35,
    caution: 0.9,
    noise: 0.02,
    misread: 1,
    hunch: 7,
  },
  // Every decision uniformly at random: the baseline for comparison.
  random: {
    name: "Random",
    pocketChance: 0.5,
    greed: 0.5,
    lie: 0.5,
    lieOnlyWhenAlone: false,
    teamSpirit: 0,
    voteAt: 0,
    emergencyAt: null,
    watch: 0,
    caution: 0,
    noise: 1,
    misread: 0,
    hunch: 0,
  },
};
