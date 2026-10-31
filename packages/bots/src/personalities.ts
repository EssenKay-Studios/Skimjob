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
   * Heads for the Rooftop once (Heat + the baseline still to come) ÷ the raid
   * level passes this, more often the further past it. design §7
   */
  readonly heatCaution: number;
  /** Chance that any one decision is made uniformly at random instead. 1 = the Random bot. */
  readonly noise: number;
}

export type PersonalityId = "honest" | "opportunist" | "greedy" | "cautious" | "random";

/** The design §17.3 bots, minus the Mole bot (no Mole powers yet). Placeholder numbers, to tune with the simulator. */
export const PERSONALITIES: Readonly<Record<PersonalityId, Personality>> = {
  // Hands in nearly everything, never lies, votes on the evidence.
  honest: {
    name: "Honest",
    pocketChance: 0.1,
    greed: 0.2,
    lie: 0,
    lieOnlyWhenAlone: true,
    teamSpirit: 1,
    voteAt: 4,
    emergencyAt: null,
    watch: 0.15,
    heatCaution: 0.85,
    noise: 0.02,
  },
  // Pockets a fair share, and covers it with a false alibi when nobody saw it.
  opportunist: {
    name: "Opportunist",
    pocketChance: 0.5,
    greed: 0.5,
    lie: 0.9,
    lieOnlyWhenAlone: true,
    teamSpirit: 0.7,
    voteAt: 4,
    emergencyAt: null,
    watch: 0.1,
    heatCaution: 0.9,
    noise: 0.02,
  },
  // Pockets often and big, lies often, rarely votes: stress-tests Heat and checkpoints.
  greedy: {
    name: "Greedy",
    pocketChance: 0.8,
    greed: 0.8,
    lie: 0.7,
    lieOnlyWhenAlone: false,
    teamSpirit: 0.2,
    voteAt: 7,
    emergencyAt: null,
    watch: 0.05,
    heatCaution: 1,
    noise: 0.02,
  },
  // Hands in nearly everything, lays low on the Rooftop and checks Security often; quick to suspect.
  cautious: {
    name: "Cautious",
    pocketChance: 0.1,
    greed: 0.2,
    lie: 0.2,
    lieOnlyWhenAlone: true,
    teamSpirit: 1,
    voteAt: 3,
    emergencyAt: 7,
    watch: 0.35,
    heatCaution: 0.7,
    noise: 0.02,
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
    heatCaution: 1,
    noise: 1,
  },
};
