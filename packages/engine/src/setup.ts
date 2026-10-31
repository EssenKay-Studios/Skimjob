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
import type { GameConfig, GameEvent, GameState, MoleSetting, RngState, VoteVisibility } from "./types";
import { PUBLIC, REVEAL, privateTo } from "./types";
import { pick, seedRng, shuffle } from "./rng";
import { replay } from "./reduce";

const MOLE_SETTINGS: readonly string[] = ["off", "maybe", "on"] satisfies readonly MoleSetting[];
const VOTE_VISIBILITIES: readonly string[] = ["hiddenThenRevealed", "open", "secret"] satisfies readonly VoteVisibility[];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * Everything wrong with a config, or `[]` if it can start a game. Configs reach
 * the server as untrusted JSON, so this checks the shape too, not just the rules.
 */
export function validateConfig(config: unknown): string[] {
  if (!isObject(config)) return ["config must be an object"];
  const errors: string[] = [];
  const { seed, players, job, rolePool, mole, eventsEnabled, voteVisibility, starterMode } = config;
  if (typeof seed !== "string") errors.push("seed must be a string");
  if (typeof eventsEnabled !== "boolean") errors.push("eventsEnabled must be a boolean");
  if (typeof starterMode !== "boolean") errors.push("starterMode must be a boolean");
  if (typeof mole !== "string" || !MOLE_SETTINGS.includes(mole)) errors.push(`mole must be one of ${MOLE_SETTINGS.join(", ")}`);
  if (typeof voteVisibility !== "string" || !VOTE_VISIBILITIES.includes(voteVisibility)) {
    errors.push(`voteVisibility must be one of ${VOTE_VISIBILITIES.join(", ")}`);
  }
  if (typeof job !== "string" || !Object.hasOwn(JOB_SETUPS, job)) errors.push(`unknown job ${String(job)}`);

  if (!Array.isArray(players)) {
    errors.push("players must be an array");
  } else {
    if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
      errors.push(`a game needs ${MIN_PLAYERS}–${MAX_PLAYERS} players, got ${players.length}`);
    }
    const seatsOk = players.every(
      (p) => isObject(p) && typeof p.id === "string" && p.id !== "" && typeof p.name === "string" && typeof p.isBot === "boolean",
    );
    if (!seatsOk) errors.push("each player needs a non-empty string id, a string name and a boolean isBot");
    else if (new Set(players.map((p) => p.id)).size !== players.length) errors.push("player ids must be unique");
  }

  // design §8.1: starter mode has no Mole and no events. Reject rather than
  // ignore, so gameCreated never claims a Mole or events the game won't have.
  if (starterMode === true && mole !== "off") errors.push("starter mode requires mole: off");
  if (starterMode === true && eventsEnabled !== false) errors.push("starter mode requires eventsEnabled: false");

  if (!isStringArray(rolePool)) {
    errors.push("rolePool must be an array of role ids");
  } else if (starterMode !== true) {
    if (new Set(rolePool).size !== rolePool.length) errors.push("role pool has duplicates");
    for (const role of rolePool) {
      if (role === MOLE_ROLE) errors.push("the Mole is dealt by the mole setting, not the role pool");
      else if (!POOL_ROLES.includes(role)) errors.push(`unknown role ${role}`);
    }
  }
  return errors;
}

/** Rooms in play for a crew of `playerCount`. design §6.2 */
export function roomsFor(job: JobId, playerCount: number): RoomId[] {
  const setup = Object.hasOwn(JOB_SETUPS, job) ? JOB_SETUPS[job] : undefined;
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
  const errors = validateConfig(config);
  if (errors.length > 0) throw new Error(`invalid game config: ${errors.join("; ")}`);
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
