// Powers used with `useAbility` outside a move (docs/roles-v2.md §2): the
// Auditor's, Detective's and Priest's; the Priest's shakedown hook, and every
// role's tokens.
// design §8, §8.3; extension.md "Roles", "Tokens and the perk shop"
//
// The powers are answered with a private `abilityResolved`. Every reward is one
// private `tokenEarned`, emitted where its trigger happens: after a round
// resolves (round.ts), after a shakedown (`dirtyShakedownRewards`, `blessingEvents`).
import type { RolePower, TokenTrigger } from "@skimjob/content";
import type { GameEvent, GameState, PlayerId, PlayerState } from "./types";
import { privateTo } from "./types";
import { roleDefIn, rolesFor } from "./overrides";
import { isObject, show } from "./check";

type Result = GameEvent[] | string;

/** What `target` holds above the share (the pocketed coins still held; 0 at or below it): what a shakedown takes. design §7.6, §9.6 */
export const aboveShare = (state: GameState, target: PlayerId): number => Math.max(0, (state.players[target] as PlayerState).stash - state.share);

/**
 * Auditor (v2 §2): once between meetings, the latest resolved round's shortfall for
 * one room in play: what its visitors pocketed (0 if none, or if nobody was there).
 */
function audit(state: GameState, player: PlayerState, perStretch: number, raw: Record<string, unknown>): Result {
  if (player.roleState.usedThisStretch >= perStretch) return "you have already audited a room since the last meeting";
  const round = state.resolvedRound;
  if (round === 0) return "no round has resolved yet";
  // PR #26 review: a round stays the latest resolved one across a regular meeting (a new stretch); one audit of it is enough.
  if (state.log.some((e) => e.type === "abilityResolved" && e.player === player.id && e.ability.kind === "audit" && e.ability.round === round)) {
    return `you have already audited round ${round}`;
  }
  if (typeof raw.room !== "string" || !state.rooms.includes(raw.room)) return "audit a room in play";
  const room = raw.room;
  let shortfall = 0;
  for (const e of state.log) if (e.type === "coinsGrabbed" && e.round === round && e.room === room) shortfall += e.pocket;
  return [{ type: "abilityResolved", visibility: privateTo(player.id), player: player.id, round: state.round, ability: { kind: "audit", round, room, shortfall } }];
}

/** Detective (v2 §2): once between meetings, whether another player holds anything above the share right now (§9.6). */
function checkStash(state: GameState, player: PlayerState, perStretch: number, raw: Record<string, unknown>): Result {
  if (player.roleState.usedThisStretch >= perStretch) return "you have already checked a stash since the last meeting";
  const target = raw.target;
  if (typeof target !== "string" || !Object.hasOwn(state.players, target)) return `unknown player ${show(target)}`;
  if (target === player.id) return "check another player's stash";
  // PR #26 review: a check during the window would be a sure Shield (the shakedown is public, so this refusal tells nothing).
  if (state.pendingShakedown?.target === target) return "that player's shakedown is already pending";
  return [
    {
      type: "abilityResolved",
      visibility: privateTo(player.id),
      player: player.id,
      round: state.round,
      ability: { kind: "checkStash", target, dirty: aboveShare(state, target) > 0 },
    },
  ];
}

/** Priests (by player id) whose blessing for `stretch` covers `target`. */
function blessersOf(state: GameState, target: PlayerId, stretch: number): PlayerId[] {
  const out: PlayerId[] = [];
  for (const e of state.log) {
    if (e.type === "abilityResolved" && e.ability.kind === "bless" && e.ability.target === target && e.ability.stretch === stretch) out.push(e.player);
  }
  return out;
}

/** Whether a player `priest` blessed in `stretch` was later shaken down dirty in that stretch (it ends as a regular meeting opens, §9.1). */
function blessedWentDirty(state: GameState, priest: PlayerId, stretch: number): boolean {
  let current = 1;
  const blessed = new Set<PlayerId>();
  for (const e of state.log) {
    if (e.type === "meetingOpened" && e.kind === "regular") current++;
    else if (current !== stretch) continue;
    else if (e.type === "abilityResolved" && e.player === priest && e.ability.kind === "bless") blessed.add(e.ability.target);
    else if (e.type === "shakedownResolved" && !e.clean && blessed.has(e.target)) return true;
  }
  return false;
}

/**
 * Priest (v2 §2): once between meetings, bless another player for the current
 * stretch. Refused for a player whose shakedown is already pending, and for the
 * whole stretch after a blessed player was shaken down dirty in the one before.
 */
function bless(state: GameState, player: PlayerState, perStretch: number, raw: Record<string, unknown>): Result {
  if (player.roleState.usedThisStretch >= perStretch) return "you have already blessed someone since the last meeting";
  const target = raw.target;
  if (typeof target !== "string" || !Object.hasOwn(state.players, target)) return `unknown player ${show(target)}`;
  if (target === player.id) return "bless another player";
  if (state.pendingShakedown?.target === target) return "that player's shakedown is already pending";
  const { stretch } = state;
  if (blessedWentDirty(state, player.id, stretch - 1)) return "your last blessing was caught dirty: no blessing until the next meeting";
  return [{ type: "abilityResolved", visibility: privateTo(player.id), player: player.id, round: state.round, ability: { kind: "bless", target, stretch } }];
}

/** `useAbility` with the Auditor's, Detective's or Priest's power, or null if `power` is none of them. */
export function useCrewPower(state: GameState, player: PlayerState, power: RolePower, raw: unknown): Result | null {
  if (!isObject(raw) || raw.kind !== power.kind) return null;
  if (power.kind === "audit") return audit(state, player, power.perStretch, raw);
  if (power.kind === "checkStash") return checkStash(state, player, power.perStretch, raw);
  if (power.kind === "bless") return bless(state, player, power.perStretch, raw);
  return null;
}

/**
 * `count` tokens (one per `tokenEarned`) for each player whose role has a
 * reward on `trigger` and for whom `earned` holds. extension.md "Tokens and the perk shop", gap-fills
 */
export function grantRewards(state: GameState, trigger: TokenTrigger, earned: (player: PlayerState) => boolean): GameEvent[] {
  const roles = rolesFor(state.config);
  const out: GameEvent[] = [];
  for (const id of state.playerOrder) {
    const player = state.players[id] as PlayerState;
    for (const reward of roleDefIn(roles, player.role)?.rewards ?? []) {
      if (reward.on !== trigger || !earned(player)) continue;
      for (let i = 0; i < reward.count; i++) out.push({ type: "tokenEarned", visibility: privateTo(id), player: id, trigger });
    }
  }
  return out;
}

/**
 * extension.md "Roles": `target` was just caught (shaken down dirty). A token
 * for: the Lookout if its power saw them; the Auditor if they visited a room
 * it audited, in that round; the Detective if it checked them (earlier this
 * game, by this player, provisional); the Smooth Talker if its last ballot in `meetingId` was for them. Nobody earns
 * one for their own shakedown.
 */
export function dirtyShakedownRewards(state: GameState, target: PlayerId, meetingId: string): GameEvent[] {
  // Each voter's last ballot in this meeting (a later one replaces an earlier, sealed votes included).
  const ballots = new Map<PlayerId, string>();
  for (const e of state.log) if (e.type === "voteCast" && e.meetingId === meetingId) ballots.set(e.player, e.vote.kind === "shakedown" ? e.vote.target : "");
  const mine = (player: PlayerState) => state.log.filter((e) => "player" in e && e.player === player.id && e.player !== target);
  const roomOf = (round: number): string | undefined => {
    const split = state.log.find((e) => e.type === "coinsGrabbed" && e.player === target && e.round === round);
    return split?.type === "coinsGrabbed" ? split.room : undefined;
  };
  return [
    ...grantRewards(state, "watchedShakenDirty", (p) => mine(p).some((e) => e.type === "roomWatched" && e.source === "lookout" && e.seen.includes(target))),
    ...grantRewards(state, "auditedShakenDirty", (p) =>
      mine(p).some((e) => e.type === "abilityResolved" && e.ability.kind === "audit" && roomOf(e.ability.round) === e.ability.room),
    ),
    ...grantRewards(state, "checkedShakenDirty", (p) => mine(p).some((e) => e.type === "abilityResolved" && e.ability.kind === "checkStash" && e.ability.target === target)),
    ...grantRewards(state, "wonDirtyShakedown", (p) => p.id !== target && ballots.get(p.id) === target),
  ];
}

/** Priest (v2 §2): `target` was just shaken down clean. Each Priest who blessed them this stretch earns a token. */
export function blessingEvents(state: GameState, target: PlayerId): GameEvent[] {
  const priests = blessersOf(state, target, state.stretch);
  return grantRewards(state, "blessedShakenClean", (p) => priests.includes(p.id));
}
