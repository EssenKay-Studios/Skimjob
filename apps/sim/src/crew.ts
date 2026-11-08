// Building each simulated game: seats, the bot mix, and the game config.
// design §19.3 (inputs: crew size, bot mix, job, overrides, seed)
import { PERSONALITIES, type PersonalityId } from "@skimjob/bots";
import { seedRng, shuffle, type ContentOverrides, type GameConfig, type PlayerSeat } from "@skimjob/engine";
import type { MixEntry, SimOptions } from "./args";

/**
 * Seats for a crew of `n`, by the mix's weights: each personality gets its
 * whole share of seats, and the seats left over go to the largest remainders.
 * Ties are broken by a seeded shuffle of the mix, and the seats are shuffled
 * too, so over many games no personality is favoured by list or seat order.
 */
export function crewFor(mix: readonly MixEntry[], n: number, seed: string): PersonalityId[] {
  if (mix.length === 0) throw new Error("empty bot mix");
  const order = shuffle(seedRng(`crew:${seed}`), mix);
  const total = mix.reduce((s, e) => s + e.weight, 0);
  const shares = order.value.map((e) => ({ id: e.personality, exact: (e.weight / total) * n }));
  const seats = shares.map((s) => ({ id: s.id, count: Math.floor(s.exact), rest: s.exact - Math.floor(s.exact) }));
  let left = n - seats.reduce((s, e) => s + e.count, 0);
  // Stable sort: equal remainders keep the shuffled order.
  for (const s of [...seats].sort((a, b) => b.rest - a.rest)) {
    if (left === 0) break;
    s.count++;
    left--;
  }
  const crew = seats.flatMap((s) => Array<PersonalityId>(s.count).fill(s.id));
  return shuffle(order.rng, crew).value;
}

export const gameSeed = (base: string, players: number, index: number): string => `${base}/${players}p/${index}`;

export interface GameSetup {
  readonly config: GameConfig;
  /** Personality of each seat, in seat order. */
  readonly crew: readonly PersonalityId[];
}

/** The config and bot crew for game `index` at `players` players. Same inputs, same game. */
export function setupGame(options: SimOptions, players: number, index: number): GameSetup {
  const seed = gameSeed(options.seed, players, index);
  const crew = crewFor(options.mix, players, seed);
  const seats: PlayerSeat[] = crew.map((p, i) => ({ id: `p${i + 1}`, name: `${PERSONALITIES[p].name} ${i + 1}`, isBot: true }));
  const config: GameConfig = {
    seed,
    players: seats,
    job: options.job,
    roleList: options.roleList,
    eventsEnabled: options.eventsEnabled,
    voteVisibility: options.voteVisibility,
    // Checked by the engine's validateConfig before any game runs.
    contentOverrides: options.contentOverrides as ContentOverrides | null,
  };
  return { config, crew };
}
