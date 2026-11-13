// The role handlers, one per role id (design §19.2 seam 4): how each role's
// power is used, and any role-specific win rule. design §11
//
// A move power (`move`) is checked as the move is submitted and acts as the
// round resolves (round.ts, design §4.2); a power used now (`use`) answers at
// once with a private `abilityResolved`. Passive powers (the Locksmith's
// quieter coins, the Smooth Talker's vote) apply where their rule does
// (round.ts, meeting.ts). Charges live on each holder's own `roleState`, so
// two copies of a role never share them (§11.3, seam 9).
import type { RoleId, RolePower } from "@skimjob/content";
import type { AbilityUse, GameEvent, GameState, PlayerId, PlayerState } from "./types";
import { privateTo } from "./types";
import { jobFor, powerOf } from "./overrides";
import { roomDef } from "./job";
import { isTaped } from "./bells";
import { closedRoom } from "./deck";
import { show } from "./check";

type Raw = Record<string, unknown>;

export interface RoleHandler {
  /** A power used as part of a move (`submitMove`): the checked use, or why it is refused. */
  readonly move?: (state: GameState, player: PlayerState, raw: Raw) => AbilityUse | string;
  /** A power used now (`useAbility`): its events, or why it is refused. */
  readonly use?: (state: GameState, player: PlayerState, raw: Raw) => GameEvent[] | string;
  /** The role's own win rule for a heist sunk by theft (design §8.4); absent: it wins only like everyone. */
  readonly winsSunk?: (state: GameState, player: PlayerId) => boolean;
}

/** A role's power numbers, read as the power kind its handler serves. */
type PowerOf<K extends RolePower["kind"]> = Extract<RolePower, { kind: K }>;

const spentThisStretch = (player: PlayerState, perStretch: number): boolean => player.roleState.usedThisStretch >= perStretch;

const roomInPlay = (state: GameState, room: unknown): room is string => typeof room === "string" && state.rooms.includes(room);

/** Why `target` isn't another player in the game, or null. design §11.1: no power targets yourself. */
function notOther(state: GameState, player: PlayerState, target: unknown): string | null {
  if (typeof target !== "string" || !Object.hasOwn(state.players, target)) return `unknown player ${show(target)}`;
  return target === player.id ? "pick another player" : null;
}

const resolved = (state: GameState, player: PlayerState, ability: Extract<GameEvent, { type: "abilityResolved" }>["ability"]): GameEvent[] => [
  { type: "abilityResolved", visibility: privateTo(player.id), player: player.id, round: state.round, ability },
];

/** Lookout (every round): also watch up to `extraRooms` other rooms in play. */
function lookout(state: GameState, player: PlayerState, raw: Raw): AbilityUse | string {
  const { extraRooms } = powerOf(state.config, player.role) as PowerOf<"lookout">;
  const rooms = raw.rooms;
  if (!Array.isArray(rooms) || rooms.length < 1 || rooms.length > extraRooms) return `the Lookout watches 1 to ${extraRooms} room(s)`;
  if (!rooms.every((r) => roomInPlay(state, r))) return "the Lookout can only watch rooms in play";
  if (new Set(rooms).size !== rooms.length) return "the Lookout can't watch the same room twice";
  return { kind: "lookout", rooms: [...rooms] };
}

/** Detective (every round): how many coins one player grabbed in the latest resolved round. */
function detect(state: GameState, player: PlayerState, raw: Raw): GameEvent[] | string {
  const round = state.resolvedRound;
  if (round === 0) return "no round has resolved yet";
  if (state.log.some((e) => e.type === "abilityResolved" && e.player === player.id && e.ability.kind === "detect" && e.ability.round === round)) {
    return `you have already looked into round ${round}`;
  }
  const bad = notOther(state, player, raw.target);
  if (bad) return bad;
  const target = raw.target as PlayerId;
  const grab = state.log.find((e) => e.type === "coinsGrabbed" && e.player === target && e.round === round);
  const grabbed = grab?.type === "coinsGrabbed" ? grab.duffel + grab.pocket + grab.seized : 0;
  return resolved(state, player, { kind: "detect", round, target, grabbed });
}

/** Auditor (once between meetings): how many coins reached the duffel from one room in the latest resolved round. */
function audit(state: GameState, player: PlayerState, raw: Raw): GameEvent[] | string {
  if (spentThisStretch(player, (powerOf(state.config, player.role) as PowerOf<"audit">).perStretch)) return "you have already audited a room since the last meeting";
  const round = state.resolvedRound;
  if (round === 0) return "no round has resolved yet";
  // A round stays the latest resolved one across a regular meeting (a new stretch); one audit of it is enough.
  if (state.log.some((e) => e.type === "abilityResolved" && e.player === player.id && e.ability.kind === "audit" && e.ability.round === round)) {
    return `you have already audited round ${round}`;
  }
  if (!roomInPlay(state, raw.room)) return "audit a room in play";
  const room = raw.room;
  let duffel = 0;
  for (const e of state.log) if (e.type === "coinsGrabbed" && e.round === round && e.room === room) duffel += e.duffel;
  return resolved(state, player, { kind: "audit", round, room, duffel });
}

/** Hacker (once between meetings): hide one open room's bell this round; not a closed room (taped off, §5.3, or locked down, §13; design §3.2). */
function hide(state: GameState, player: PlayerState, raw: Raw): AbilityUse | string {
  if (spentThisStretch(player, (powerOf(state.config, player.role) as PowerOf<"hide">).perStretch)) return "you have already hidden a bell since the last meeting";
  if (!roomInPlay(state, raw.room)) return "hide the bell of a room in play";
  if (isTaped(state, raw.room)) return "a taped-off room's bell is off";
  if (raw.room === closedRoom(state)) return "a locked-down room is closed this round";
  return { kind: "hide", room: raw.room };
}

/** Electrician (once between meetings): black out one room next round. */
function blackout(state: GameState, player: PlayerState, raw: Raw): AbilityUse | string {
  if (spentThisStretch(player, (powerOf(state.config, player.role) as PowerOf<"blackout">).perStretch)) return "you have already cut the power since the last meeting";
  if (!roomInPlay(state, raw.room)) return "cut the power in a room in play";
  return { kind: "blackout", room: raw.room };
}

/** The target of `priest`'s latest spent absolve, if any (a use that was "already done" isn't one, §11.4). */
function lastAbsolved(state: GameState, priest: PlayerId): PlayerId | null {
  for (let i = state.log.length - 1; i >= 0; i--) {
    const e = state.log[i] as GameEvent;
    if (e.type === "abilityResolved" && e.player === priest && e.ability.kind === "absolve") return e.ability.target;
  }
  return null;
}

/** Priest (once between meetings): absolve one other player at this round's split; not the same player twice in a row. */
function absolve(state: GameState, player: PlayerState, raw: Raw): AbilityUse | string {
  if (spentThisStretch(player, (powerOf(state.config, player.role) as PowerOf<"absolve">).perStretch)) return "you have already absolved someone since the last meeting";
  const bad = notOther(state, player, raw.target);
  if (bad) return bad;
  const target = raw.target as PlayerId;
  if (lastAbsolved(state, player.id) === target) return "you can't absolve the same player twice in a row";
  return { kind: "absolve", target };
}

/** Mole (once between meetings): ring any room once, except the Rooftop (§5.5) or a taped-off room (§5.3). */
function ring(state: GameState, player: PlayerState, raw: Raw): AbilityUse | string {
  if (spentThisStretch(player, (powerOf(state.config, player.role) as PowerOf<"ring">).perStretch)) return "you have already rung a bell since the last meeting";
  if (!roomInPlay(state, raw.room)) return "ring a room in play";
  if (isTaped(state, raw.room)) return "a taped-off room's bell is off";
  if (roomDef(jobFor(state.config), raw.room).lieLow) return "nothing can ring the Rooftop";
  return { kind: "ring", room: raw.room };
}

/** Fixer (once per game): tear the tape off a taped-off room. */
function reopen(state: GameState, player: PlayerState, raw: Raw): AbilityUse | string {
  if (player.roleState.usedThisGame >= (powerOf(state.config, player.role) as PowerOf<"reopen">).perGame) return "you have already reopened a room this game";
  if (typeof raw.room !== "string" || !isTaped(state, raw.room)) return "reopen a taped-off room";
  return { kind: "reopen", room: raw.room };
}

/**
 * design §8.4, §8.5: the Mole's and the Fixer's own rule. On a heist sunk by
 * theft, a holder wins if theirs is (or ties for) the biggest stash of all
 * players; each copy is judged on its own (§11.3).
 */
function topOfAll(state: GameState, player: PlayerId): boolean {
  const stash = (id: PlayerId) => (state.players[id] as PlayerState).stash;
  return state.playerOrder.every((id) => stash(id) <= stash(player));
}

/** Every role's handler, by role id. design §11.1, §19.2 seam 4 */
export const ROLE_HANDLERS: Readonly<Record<RoleId, RoleHandler>> = {
  lookout: { move: lookout },
  locksmith: {},
  detective: { use: detect },
  auditor: { use: audit },
  smoothTalker: {},
  hacker: { move: hide },
  electrician: { move: blackout },
  priest: { move: absolve },
  mole: { move: ring, winsSunk: topOfAll },
  fixer: { move: reopen, winsSunk: topOfAll },
};

/** `role`'s handler; a role id with none (untrusted input) has no power. */
export const roleHandler = (role: RoleId): RoleHandler => (Object.hasOwn(ROLE_HANDLERS, role) ? (ROLE_HANDLERS[role] as RoleHandler) : {});
