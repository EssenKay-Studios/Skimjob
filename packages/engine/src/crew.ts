// Crew roles of role deck v2 (docs/roles-v2.md §2, step R2a): the Auditor's
// and Detective's powers, and the perk rewards that crew roles earn. design §8, §8.3
//
// Both powers are used with `useAbility` and answered with a private
// `abilityResolved`. Rewards are private `perkGranted` events, emitted where
// their trigger happens: after a checkpoint is made (`checkpointRewards`) and
// after a dirty shakedown (`dirtyShakedownRewards`).
import type { PerkTrigger, RolePower } from "@skimjob/content";
import type { GameEvent, GameState, PlayerId, PlayerState } from "./types";
import { privateTo } from "./types";
import { jobFor, roleDefIn, rolesFor } from "./overrides";
import { actOfRound } from "./acts";
import { isObject, show } from "./check";

type Result = GameEvent[] | string;

/** The current act's clean threshold: a stash (with any Fence safe) below it is clean. design §11.3 */
export const cleanThreshold = (state: GameState): number => jobFor(state.config).shakedown.cleanBelowPerAct * actOfRound(Math.max(1, state.round));

/**
 * Auditor (v2 §2): once per act, the latest resolved round's shortfall for
 * one room in play: what its visitors pocketed (0 if none, or if nobody was there).
 */
function audit(state: GameState, player: PlayerState, perAct: number, raw: Record<string, unknown>): Result {
  if (player.roleState.usedThisAct >= perAct) return "you have already audited a room this act";
  const round = state.resolvedRound;
  if (round === 0) return "no round has resolved yet";
  if (typeof raw.room !== "string" || !state.rooms.includes(raw.room)) return "audit a room in play";
  const room = raw.room;
  let shortfall = 0;
  for (const e of state.log) if (e.type === "lootSplit" && e.round === round && e.room === room) shortfall += e.toStash;
  return [{ type: "abilityResolved", visibility: privateTo(player.id), player: player.id, round: state.round, ability: { kind: "audit", round, room, shortfall } }];
}

/** Detective (v2 §2): once per act, whether another player's stash is at or above the clean threshold right now. */
function checkStash(state: GameState, player: PlayerState, perAct: number, raw: Record<string, unknown>): Result {
  if (player.roleState.usedThisAct >= perAct) return "you have already checked a stash this act";
  const target = raw.target;
  if (typeof target !== "string" || !Object.hasOwn(state.players, target)) return `unknown player ${show(target)}`;
  if (target === player.id) return "check another player's stash";
  const { stash, safe } = state.players[target] as PlayerState;
  const threshold = cleanThreshold(state);
  return [
    {
      type: "abilityResolved",
      visibility: privateTo(player.id),
      player: player.id,
      round: state.round,
      ability: { kind: "checkStash", target, threshold, dirty: stash + safe >= threshold },
    },
  ];
}

/** `useAbility` with the Auditor's or Detective's power, or null if `power` is neither. */
export function useCrewPower(state: GameState, player: PlayerState, power: RolePower, raw: unknown): Result | null {
  if (!isObject(raw) || raw.kind !== power.kind) return null;
  if (power.kind === "audit") return audit(state, player, power.perAct, raw);
  if (power.kind === "checkStash") return checkStash(state, player, power.perAct, raw);
  return null;
}

/** `count` × `perk` for each player whose role has a reward on `trigger` and for whom `earned` holds. */
function rewards(state: GameState, trigger: PerkTrigger, earned: (player: PlayerState) => boolean): GameEvent[] {
  const roles = rolesFor(state.config);
  const out: GameEvent[] = [];
  for (const id of state.playerOrder) {
    const player = state.players[id] as PlayerState;
    for (const reward of roleDefIn(roles, player.role)?.rewards ?? []) {
      if (reward.on !== trigger || !earned(player)) continue;
      for (let i = 0; i < reward.count; i++) out.push({ type: "perkGranted", visibility: privateTo(id), player: id, perk: reward.perk });
    }
  }
  return out;
}

/** design §8.3 (v2 §2): an Act 1 or 2 checkpoint was made. Rookie → Tail, Inside Man → Peek. */
export const checkpointRewards = (state: GameState): GameEvent[] => rewards(state, "checkpointMade", () => true);

/**
 * design §8.3 (v2 §2): `target` was just shaken down dirty. Lookout → Peek if
 * its power saw them; Auditor → Ballot if they visited a room it audited, in
 * that round; Detective → Shield if it checked them. Earlier this game, by
 * this player (provisional). Nobody is rewarded for their own shakedown.
 */
export function dirtyShakedownRewards(state: GameState, target: PlayerId): GameEvent[] {
  const mine = (player: PlayerState) => state.log.filter((e) => "player" in e && e.player === player.id && e.player !== target);
  const roomOf = (round: number): string | undefined => {
    const split = state.log.find((e) => e.type === "lootSplit" && e.player === target && e.round === round);
    return split?.type === "lootSplit" ? split.room : undefined;
  };
  return [
    ...rewards(state, "watchedShakenDirty", (p) => mine(p).some((e) => e.type === "roomWatched" && e.source === "lookout" && e.seen.includes(target))),
    ...rewards(state, "auditedShakenDirty", (p) =>
      mine(p).some((e) => e.type === "abilityResolved" && e.ability.kind === "audit" && roomOf(e.ability.round) === e.ability.room),
    ),
    ...rewards(state, "checkedShakenDirty", (p) => mine(p).some((e) => e.type === "abilityResolved" && e.ability.kind === "checkStash" && e.ability.target === target)),
  ];
}
