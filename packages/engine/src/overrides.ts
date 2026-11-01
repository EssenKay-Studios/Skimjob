// Content overrides: a game config may replace some of the job's and roles'
// numbers, for the simulator and playtests. design §17.4 "config overrides"
//
// Numbers only: an override can't add or remove rooms, roles or tiers, so the
// rules code never meets a shape it doesn't know. Configs are untrusted JSON,
// so `validateOverrides` checks every field (own keys only, known keys only,
// finite numbers, whole numbers where the engine counts loot or Heat).
import { EVENTS, ROLES, type EventDef, type EventEffect, type Faction, type JobDef, type JobId, type RoleDef, type RoleId, type RolePower, type RoomDef } from "@skimjob/content";
import type { ContentOverrides, EventOverride, GameConfig, RoleOverride, RoomOverride } from "./types";
import { isObject } from "./check";
import { jobById } from "./job";

export type RoleTable = Readonly<Record<RoleId, RoleDef>>;

type Rule = (v: unknown) => boolean;
const finite: Rule = (v) => typeof v === "number" && Number.isFinite(v);
const atLeast0: Rule = (v) => finite(v) && (v as number) >= 0;
const integer: Rule = (v) => typeof v === "number" && Number.isInteger(v);
const count: Rule = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0;
const positiveCount: Rule = (v) => count(v) && (v as number) >= 1;

const RULE_TEXT = new Map<Rule, string>([
  [finite, "a finite number"],
  [atLeast0, "a number, 0 or more"],
  [integer, "a whole number"],
  [count, "a whole number, 0 or more"],
  [positiveCount, "a whole number, 1 or more"],
]);

/** Check `raw` holds only `fields`, each passing its rule. Pushes errors prefixed with `path`. */
function checkFields(raw: unknown, path: string, fields: Readonly<Record<string, Rule>>, errors: string[]): raw is Record<string, unknown> {
  if (!isObject(raw)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  for (const key of Object.keys(raw)) {
    const rule = Object.hasOwn(fields, key) ? fields[key] : undefined;
    if (!rule) errors.push(`${path}.${key} is not an overridable field`);
    else if (!rule(raw[key])) errors.push(`${path}.${key} must be ${RULE_TEXT.get(rule)}`);
  }
  return true;
}

const ROOM_FIELDS = { loot: count, heatPressure: finite } as const;
const ROLE_SCORING_FIELDS = { stashMultiplier: atLeast0, perLootOverFinalTarget: atLeast0 } as const;

/** The numbers each power may have overridden: all of its own, never another role's. design §8 */
const POWER_FIELDS: { readonly [K in RolePower["kind"]]: Readonly<Record<string, Rule>> } = {
  none: {},
  lookout: { extraRooms: positiveCount },
  fenceSafe: { perAct: positiveCount, revealSafe: count },
  loopCameras: { perAct: positiveCount },
  voteWeight: { weight: positiveCount },
  cancelShakedown: { perGame: positiveCount },
  blackmail: { perAct: positiveCount },
  forge: { perAct: positiveCount },
  embezzle: { perAct: positiveCount, take: count },
  snitch: { extraVotes: count },
  audit: { perAct: positiveCount },
  checkStash: { perAct: positiveCount },
  tipOff: { perAct: positiveCount, heat: count },
  bless: { perAct: positiveCount },
  bagman: { bonus: count },
  cleaner: { visitors: positiveCount },
  fixer: { stopAt: count },
  foresee: {},
  getaway: { reverse: count, revealHeat: count },
};

/** The numbers each event effect may have overridden: its own only. design §10 */
const EFFECT_FIELDS: { readonly [K in EventEffect["kind"]]: Readonly<Record<string, Rule>> } = {
  // Heat is whole numbers (design §7), so a Heat card's amount is a signed whole number.
  heat: { amount: integer },
  roomSurge: { lootMultiplier: atLeast0, heatMultiplier: atLeast0 },
  blackout: {},
  lockdown: {},
  audit: {},
  raidRumour: { loss: count },
  insideTip: {},
  doubleCross: {},
};

export type EventTable = Readonly<Record<string, EventDef>>;

/**
 * Everything wrong with a content override for `job`, or `[]`. `null` and
 * `undefined` mean "no overrides". design §17.4
 */
export function validateOverrides(raw: unknown, job: JobDef, roles: RoleTable = ROLES): string[] {
  if (raw === undefined || raw === null) return [];
  const errors: string[] = [];
  if (!isObject(raw)) return ["contentOverrides must be an object"];
  const known = ["rooms", "heat", "checkpoints", "shakedown", "duel", "roles", "events"];
  for (const key of Object.keys(raw)) if (!known.includes(key)) errors.push(`contentOverrides.${key} is not an overridable section`);

  if (raw.rooms !== undefined) {
    if (!isObject(raw.rooms)) errors.push("contentOverrides.rooms must be an object");
    else
      for (const [room, o] of Object.entries(raw.rooms)) {
        const path = `contentOverrides.rooms.${room}`;
        const def = Object.hasOwn(job.rooms, room) ? job.rooms[room] : undefined;
        if (!def) {
          errors.push(`${path}: job ${job.id} has no such room`);
          continue;
        }
        const { capacity, ...rest } = isObject(o) ? o : {};
        if (!isObject(o)) errors.push(`${path} must be an object`);
        else checkFields(rest, path, ROOM_FIELDS, errors);
        if (capacity === undefined) continue;
        if (!def.capacity) errors.push(`${path}.capacity: the ${def.name} has no capacity`);
        else checkFields(capacity, `${path}.capacity`, { max: positiveCount, crowdedLoot: count }, errors);
      }
  }
  // A crowded room pays less, never more: checkMove bounds a pocket by the room's loot. design §6.2
  if (errors.length === 0 && isObject(raw.rooms)) {
    for (const [room, def] of Object.entries(overrideJob(job, { rooms: raw.rooms } as ContentOverrides).rooms)) {
      if (def.capacity && def.capacity.crowdedLoot > def.loot) {
        errors.push(`contentOverrides.rooms.${room}: crowded loot (${def.capacity.crowdedLoot}) can't be more than loot (${def.loot})`);
      }
    }
  }
  if (raw.heat !== undefined) {
    checkFields(raw.heat, "contentOverrides.heat", { max: positiveCount, perRound: finite, missedCheckpoint: count }, errors);
  }
  if (raw.shakedown !== undefined) {
    checkFields(
      raw.shakedown,
      "contentOverrides.shakedown",
      { cleanBelowPerAct: atLeast0, compensationPerAct: count, pluralityFromPlayers: positiveCount, pluralityShare: atLeast0 },
      errors,
    );
  }
  if (raw.duel !== undefined) {
    checkFields(raw.duel, "contentOverrides.duel", { wrongCallOutPerAct: count }, errors);
  }
  if (raw.checkpoints !== undefined) {
    const path = "contentOverrides.checkpoints";
    if (!isObject(raw.checkpoints)) errors.push(`${path} must be an object`);
    else
      for (const [key, v] of Object.entries(raw.checkpoints)) {
        if (key !== "perPlayer") errors.push(`${path}.${key} is not an overridable field`);
        else if (!Array.isArray(v) || v.length !== job.checkpoints.perPlayer.length || !v.every(count)) {
          errors.push(`${path}.perPlayer must be ${job.checkpoints.perPlayer.length} whole numbers, 0 or more`);
        }
      }
  }
  if (raw.roles !== undefined) {
    if (!isObject(raw.roles)) errors.push("contentOverrides.roles must be an object");
    else
      for (const [role, o] of Object.entries(raw.roles)) {
        const path = `contentOverrides.roles.${role}`;
        const def = Object.hasOwn(roles, role) ? roles[role] : undefined;
        if (!def) {
          errors.push(`${path}: no such role`);
          continue;
        }
        // Each role may tune only its own power's numbers, and its reward's count if it has one. design §8, §8.3
        const reward = def.rewards && def.rewards.length > 0 ? { rewardCount: count } : {};
        checkFields(o, path, { ...ROLE_SCORING_FIELDS, ...POWER_FIELDS[def.power.kind], ...reward }, errors);
      }
  }
  if (raw.events !== undefined) {
    if (!isObject(raw.events)) errors.push("contentOverrides.events must be an object");
    else
      for (const [card, o] of Object.entries(raw.events)) {
        const path = `contentOverrides.events.${card}`;
        const def = Object.hasOwn(EVENTS, card) ? EVENTS[card] : undefined;
        if (!def) errors.push(`${path}: no such event card`);
        else checkFields(o, path, EFFECT_FIELDS[def.effect.kind], errors);
      }
  }
  return errors;
}

/** `events` with the override's numbers. Assumes `validateOverrides` passed. design §10 */
export function overrideEvents(events: EventTable, overrides: ContentOverrides | null | undefined): EventTable {
  if (!overrides?.events) return events;
  const out: Record<string, EventDef> = { ...events };
  for (const [id, o] of Object.entries(overrides.events) as [string, EventOverride][]) {
    const def = events[id] as EventDef;
    out[id] = { ...def, effect: { ...def.effect, ...o } as EventEffect };
  }
  return out;
}

const eventCache = new WeakMap<GameConfig, EventTable>();

/** The event cards this game plays: the content cards with the config's overrides. design §10, §17.4 */
export function eventsFor(config: Pick<GameConfig, "contentOverrides">): EventTable {
  if (!config.contentOverrides?.events) return EVENTS;
  const cached = eventCache.get(config as GameConfig);
  if (cached) return cached;
  const events = overrideEvents(EVENTS, config.contentOverrides);
  eventCache.set(config as GameConfig, events);
  return events;
}

/** `job` with the override's numbers. Assumes `validateOverrides` passed. */
export function overrideJob(job: JobDef, overrides: ContentOverrides | null | undefined): JobDef {
  if (!overrides) return job;
  const rooms: Record<string, RoomDef> = { ...job.rooms };
  for (const [id, o] of Object.entries(overrides.rooms ?? {}) as [string, RoomOverride][]) {
    const def = job.rooms[id] as RoomDef;
    rooms[id] = {
      ...def,
      ...(o.loot !== undefined && { loot: o.loot }),
      ...(o.heatPressure !== undefined && { heatPressure: o.heatPressure }),
      capacity: def.capacity && o.capacity ? { ...def.capacity, ...o.capacity } : def.capacity,
    };
  }
  return {
    ...job,
    rooms,
    heat: { ...job.heat, ...overrides.heat },
    checkpoints: overrides.checkpoints?.perPlayer ? { perPlayer: overrides.checkpoints.perPlayer } : job.checkpoints,
    shakedown: { ...job.shakedown, ...overrides.shakedown },
    duel: { ...job.duel, ...overrides.duel },
  };
}

/** `roles` with the override's numbers. Assumes `validateOverrides` passed. */
export function overrideRoles(roles: RoleTable, overrides: ContentOverrides | null | undefined): RoleTable {
  if (!overrides?.roles) return roles;
  const out: Record<RoleId, RoleDef> = { ...roles };
  for (const [id, o] of Object.entries(overrides.roles) as [RoleId, RoleOverride][]) {
    const def = roles[id] as RoleDef;
    // Validated: only this power's own fields are present.
    const powerNumbers = Object.fromEntries(Object.entries(o).filter(([key]) => Object.hasOwn(POWER_FIELDS[def.power.kind], key)));
    const power = { ...def.power, ...powerNumbers } as RolePower;
    const scoring = {
      ...def.scoring,
      ...(o.stashMultiplier !== undefined && { stashMultiplier: o.stashMultiplier }),
      ...(o.perLootOverFinalTarget !== undefined && { perLootOverFinalTarget: o.perLootOverFinalTarget }),
    };
    const rewards = o.rewardCount !== undefined && def.rewards ? def.rewards.map((r) => ({ ...r, count: o.rewardCount as number })) : def.rewards;
    out[id] = { ...def, power, scoring, ...(rewards && { rewards }) };
  }
  return out;
}

// One merge per config object: rules code asks for the job on every command.
const jobCache = new WeakMap<GameConfig, JobDef>();
const roleCache = new WeakMap<GameConfig, RoleTable>();

/** The job this game plays: the content job with the config's overrides. design §17.4 */
export function jobFor(config: Pick<GameConfig, "job" | "contentOverrides">): JobDef {
  if (!config.contentOverrides) return jobById(config.job as JobId);
  const cached = jobCache.get(config as GameConfig);
  if (cached) return cached;
  const job = overrideJob(jobById(config.job), config.contentOverrides);
  jobCache.set(config as GameConfig, job);
  return job;
}

/** The role table this game plays: the content roles with the config's overrides. design §17.4 */
export function rolesFor(config: Pick<GameConfig, "contentOverrides">): RoleTable {
  if (!config.contentOverrides) return ROLES;
  const cached = roleCache.get(config as GameConfig);
  if (cached) return cached;
  const roles = overrideRoles(ROLES, config.contentOverrides);
  roleCache.set(config as GameConfig, roles);
  return roles;
}

/** `role`'s definition in `roles`, or undefined for an id with none (own keys only: ids are untrusted). */
export function roleDefIn(roles: RoleTable, role: RoleId): RoleDef | undefined {
  return Object.hasOwn(roles, role) ? roles[role] : undefined;
}

const NO_POWER: RolePower = { kind: "none" };

/** `role`'s power in this game (content plus overrides); no power for an id with no definition. design §8 */
export function powerOf(config: Pick<GameConfig, "contentOverrides">, role: RoleId): RolePower {
  return roleDefIn(rolesFor(config), role)?.power ?? NO_POWER;
}

/** The side `role` plays for; a role id with no definition is crew. design §3 */
export function factionIn(roles: RoleTable, role: RoleId): Faction {
  return roleDefIn(roles, role)?.faction ?? "crew";
}

/** Saboteurs and accomplices: the side that wins a failed heist. design §3 */
export const isDarkSide = (roles: RoleTable, role: RoleId): boolean => factionIn(roles, role) !== "crew";
