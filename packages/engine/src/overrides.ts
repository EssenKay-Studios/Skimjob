// Content overrides: a game config may replace some of the job's and roles'
// numbers, for the simulator and playtests. design §17.4 "config overrides"
//
// Numbers only: an override can't add or remove rooms, roles or tiers, so the
// rules code never meets a shape it doesn't know. Configs are untrusted JSON,
// so `validateOverrides` checks every field (own keys only, known keys only,
// whole numbers: the engine counts coins, rounds, bulbs and stars).
import { EVENTS, PERKS, ROLES, type EventDef, type EventEffect, type FailureReason, type JobDef, type JobId, type PerkId, type RoleDef, type RoleId, type RolePower, type RoomDef, type Temperament } from "@skimjob/content";
import type { ContentOverrides, EventOverride, GameConfig, RoleOverride, RoomOverride } from "./types";
import { isObject } from "./check";
import { jobById } from "./job";

export type RoleTable = Readonly<Record<RoleId, RoleDef>>;

type Rule = (v: unknown) => boolean;
const count: Rule = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0;
const positiveCount: Rule = (v) => count(v) && (v as number) >= 1;

const RULE_TEXT = new Map<Rule, string>([
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

// A coin room keeps at least 1 coin, so a move there can always grab one (design §3.2, §3.3);
// Security and the Rooftop grab nothing, so their 0 (and their noise) isn't overridable.
const COIN_ROOM_FIELDS = { coins: positiveCount, quietCoins: count } as const;
const NO_COIN_ROOM_FIELDS = {} as const;

/** The numbers each power may have overridden: all of its own, never another role's. design §8 */
const POWER_FIELDS: { readonly [K in RolePower["kind"]]: Readonly<Record<string, Rule>> } = {
  none: {},
  lookout: { extraRooms: positiveCount },
  loopCameras: { perAct: positiveCount },
  voteWeight: { weight: positiveCount },
  audit: { perAct: positiveCount },
  checkStash: { perAct: positiveCount },
  ring: { perAct: positiveCount },
  bless: { perAct: positiveCount },
  reopen: {},
};

/** The numbers each event effect may have overridden: its own only. design §10 */
const EFFECT_FIELDS: { readonly [K in EventEffect["kind"]]: Readonly<Record<string, Rule>> } = {
  roomSurge: { extraCoins: count },
  lockdown: {},
  audit: {},
  insideTip: {},
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
  const known = ["rooms", "bank", "alarm", "roundCap", "shakedown", "perks", "roles", "events"];
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
        checkFields(o, path, def.coins > 0 ? COIN_ROOM_FIELDS : NO_COIN_ROOM_FIELDS, errors);
      }
  }
  if (raw.bank !== undefined) {
    checkFields(raw.bank, "contentOverrides.bank", { coinsPerPlayer: positiveCount }, errors);
  }
  if (raw.alarm !== undefined) {
    checkFields(raw.alarm, "contentOverrides.alarm", { bulbs: positiveCount, tapedRounds: positiveCount, bustStars: positiveCount }, errors);
  }
  if (raw.shakedown !== undefined) {
    checkFields(raw.shakedown, "contentOverrides.shakedown", { cleanBelow: count, payout: count }, errors);
  }
  if (raw.perks !== undefined) {
    if (!isObject(raw.perks)) errors.push("contentOverrides.perks must be an object");
    else
      for (const [perk, o] of Object.entries(raw.perks)) {
        const path = `contentOverrides.perks.${perk}`;
        if (!Object.hasOwn(PERKS, perk)) errors.push(`${path}: no such perk`);
        else checkFields(o, path, { cost: count }, errors);
      }
  }
  if (raw.roundCap !== undefined && !positiveCount(raw.roundCap)) errors.push("contentOverrides.roundCap must be a whole number, 1 or more");
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
        checkFields(o, path, { ...POWER_FIELDS[def.power.kind], ...reward }, errors);
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
      ...(o.coins !== undefined && { coins: o.coins }),
      ...(o.quietCoins !== undefined && { quietCoins: o.quietCoins }),
    };
  }
  return {
    ...job,
    rooms,
    bank: { ...job.bank, ...overrides.bank },
    alarm: { ...job.alarm, ...overrides.alarm },
    roundCap: overrides.roundCap ?? job.roundCap,
    shakedown: { ...job.shakedown, ...overrides.shakedown },
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
    const rewards = o.rewardCount !== undefined && def.rewards ? def.rewards.map((r) => ({ ...r, count: o.rewardCount as number })) : def.rewards;
    out[id] = { ...def, power, ...(rewards && { rewards }) };
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

/** `role`'s temperament tag; a role id with no definition is a Team player. extension.md "Roles" */
export function tagIn(roles: RoleTable, role: RoleId): Temperament {
  return roleDefIn(roles, role)?.tag ?? "teamPlayer";
}

/** Whether `role` also wins the failure `reason` (from the top group). extension.md "Winning and losing" */
export const winsOn = (roles: RoleTable, role: RoleId, reason: FailureReason): boolean => roleDefIn(roles, role)?.winsOn.includes(reason) ?? false;

/** What `perk` costs in the shop in this game. extension.md "Tokens and the perk shop" */
export function perkCost(config: Pick<GameConfig, "contentOverrides">, perk: PerkId): number {
  return config.contentOverrides?.perks?.[perk]?.cost ?? PERKS[perk].cost;
}
