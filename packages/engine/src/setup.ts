// Deterministic game setup: validate the config, pick rooms by player count,
// deal one secret role per seat. design §6.2, §8.1, §15
//
// Emits, in order: gameCreated (public, no seed), rngSeeded (reveal),
// roomsSet (public), one roleDealt per seat in seat order (private), and
// rngAdvanced (reveal) with the RNG state after dealing.
import {
  DEFAULT_ROLE_POOL,
  FILLER_ROLE,
  JOB_SETUPS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  MOLE_ROLE,
  MOLE_RULES,
  POOL_ROLES,
  STARTER_ROLES,
  type JobId,
  type RoleId,
  type RoomId,
} from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, MoleSetting, RngState } from "./types";
import { PUBLIC, REVEAL, privateTo } from "./types";
import { pick, seedRng, shuffle } from "./rng";
import { replay } from "./reduce";

/** Throws if the config can't start a game. */
export function validateConfig(config: GameConfig): void {
  const n = config.players.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) {
    throw new Error(`a game needs ${MIN_PLAYERS}–${MAX_PLAYERS} players, got ${n}`);
  }
  const ids = new Set(config.players.map((p) => p.id));
  if (ids.size !== n) throw new Error("player ids must be unique");
  if (ids.has("")) throw new Error("player ids must not be empty");
  if (!JOB_SETUPS[config.job]) throw new Error(`unknown job ${config.job}`);
  if (!config.starterMode) {
    const pool = new Set(config.rolePool);
    if (pool.size !== config.rolePool.length) throw new Error("role pool has duplicates");
    for (const role of config.rolePool) {
      if (role === MOLE_ROLE) throw new Error("the Mole is dealt by the mole setting, not the role pool");
      if (!POOL_ROLES.includes(role)) throw new Error(`unknown role ${role}`);
    }
  }
}

/** Rooms in play for a crew of `playerCount`. design §6.2 */
export function roomsFor(job: JobId, playerCount: number): RoomId[] {
  const setup = JOB_SETUPS[job];
  if (!setup) throw new Error(`unknown job ${job}`);
  return setup.roomTiers.filter((t) => t.minPlayers <= playerCount).flatMap((t) => t.rooms);
}

/** The Mole counts that are possible (equally likely) for this crew. design §8.1 */
export function moleOptions(playerCount: number, setting: MoleSetting, starterMode: boolean): readonly number[] {
  if (starterMode) return [0];
  const rule = MOLE_RULES.filter((r) => r.minPlayers <= playerCount).at(-1);
  if (!rule) throw new Error(`no mole rule for ${playerCount} players`);
  return rule[setting];
}

/** The pool roles may be dealt from. design §8.1 */
export function rolePoolFor(config: GameConfig): readonly RoleId[] {
  if (config.starterMode) return STARTER_ROLES;
  return config.rolePool.length > 0 ? config.rolePool : DEFAULT_ROLE_POOL;
}

/**
 * One role per seat, in seat order. design §8.1
 * Moles first (by the mole setting), then distinct roles drawn from the pool,
 * then Rookies for any seats left; the deck is shuffled and dealt in seat order.
 * (provisional, see docs/decisions.md)
 */
export function dealRoles(config: GameConfig, rng: RngState): { readonly value: RoleId[]; readonly rng: RngState } {
  const n = config.players.length;
  const moles = pick(rng, moleOptions(n, config.mole, config.starterMode));
  const pool = shuffle(moles.rng, rolePoolFor(config));
  const fromPool = pool.value.slice(0, n - moles.value);
  const deck: RoleId[] = [
    ...Array<RoleId>(moles.value).fill(MOLE_ROLE),
    ...fromPool,
    ...Array<RoleId>(n - moles.value - fromPool.length).fill(FILLER_ROLE),
  ];
  return shuffle(pool.rng, deck);
}

/** The setup events for a new game. Pure: same config, same events. */
export function setupEvents(config: GameConfig): GameEvent[] {
  validateConfig(config);
  const dealt = dealRoles(config, seedRng(config.seed));
  return [
    {
      type: "gameCreated",
      visibility: PUBLIC,
      players: config.players,
      job: config.job,
      mole: config.mole,
      eventsEnabled: config.eventsEnabled,
      voteVisibility: config.voteVisibility,
      starterMode: config.starterMode,
    },
    { type: "rngSeeded", visibility: REVEAL, seed: config.seed },
    { type: "roomsSet", visibility: PUBLIC, rooms: roomsFor(config.job, config.players.length) },
    ...config.players.map(
      (seat, i): GameEvent => ({
        type: "roleDealt",
        visibility: privateTo(seat.id),
        player: seat.id,
        role: dealt.value[i] as RoleId,
      }),
    ),
    { type: "rngAdvanced", visibility: REVEAL, words: dealt.rng.words },
  ];
}

/** A new game after setup. Phase stays `setup` until the round loop (STATUS.md task 4) starts round 1. */
export function createGame(config: GameConfig): GameState {
  return replay(config, setupEvents(config));
}
