// Pure helpers behind the move panel: what a grab would do (bell bulbs, share),
// whether the bank may run short, the two bags, and which targets the move
// powers offer. All read from the player's own view. design §3.2, §5.2, §11.1
import { powerOf, ringsOf, type AbilityUse, type Move, type PlayerId, type PlayerView, type RoomId } from "@skimjob/engine";
import type { RolePower } from "@skimjob/content";
import { crewSize, jobOf, roomOptions, setupOf, type RoomOption } from "./hud";

/** The coins grabbed: the player's choice, from none (a fresh move) up to the room's limit; 0 where there are none. The least that locks in is 1. design §3.2 */
export const grabOf = (coins: number, wanted: number): number => Math.min(coins, Math.max(0, wanted));

/** The grab split into its two bags. design §3.2 step 3 */
export interface Bags {
  readonly duffel: number;
  readonly pocket: number;
}

export const bagsOf = (grab: number, pocket: number): Bags => {
  const p = Math.max(0, Math.min(grab, pocket));
  return { duffel: grab - p, pocket: p };
};

/** Where a coin can sit on the move panel: still in the room (not grabbed), or in one of the two bags. */
export type Pile = "room" | keyof Bags;

/**
 * One coin moves from `from` to `to`: out of the room into a bag (the grab goes up, never past
 * `limit`), between the bags, or back into the room (the grab goes down).
 * Nothing moves when `from` has no coin to give. design §3.2 steps 2-3
 */
export function moveCoin(bags: Bags, from: Pile, to: Pile, limit: number): Bags {
  const grab = bags.duffel + bags.pocket;
  const has = from === "room" ? grab < limit : bags[from] > 0;
  if (from === to || !has) return bags;
  const take = from === "room" ? bags : { ...bags, [from]: bags[from] - 1 };
  return to === "room" ? take : { ...take, [to]: take[to] + 1 };
}

/** What the grab does to the room's bell, before you lock in. design §5.2, §5.3 */
export interface BellPreview {
  readonly bulbs: number;
  /** Bulbs lit now; null while a Hacker hides this bell ("?"). */
  readonly lit: number | null;
  /** Bulbs your grab lights (the Locksmith's and Soft shoes included), capped at the bell's last bulb. */
  readonly adds: number;
  /** Your grab, with the bulbs already lit, would light the last bulb: a raid (the others' rings are unknown). */
  readonly raid: boolean;
}

/** Soft shoes bought last round: this round your coins ring nothing. design §12 */
const hasSoftShoes = (view: PlayerView): boolean =>
  view.caseFile.some(({ event: e }) => e.type === "perkBought" && e.player === view.me.id && e.perk.kind === "softShoes" && e.round === view.round - 1);

/** The rings `coins` coins in `room` make for you: the room's noise, less the Locksmith's muffle, none with Soft shoes. design §5.2, §11.1, §12 */
export function ownRings(view: PlayerView, room: RoomId, coins: number): number {
  const def = jobOf(view).rooms[room];
  const power = powerOf({ contentOverrides: setupOf(view)?.contentOverrides ?? null }, view.me.role);
  return !def || hasSoftShoes(view) ? 0 : ringsOf(def, coins, power?.kind === "muffle" ? power.fewerRings : 0);
}

export function bellPreview(view: PlayerView, room: RoomOption, grab: number): BellPreview {
  const rings = ownRings(view, room.id, grab);
  const { bulbs } = jobOf(view).alarm;
  const lit = Object.hasOwn(view.bells, room.id) ? (view.bells[room.id] as number) : null;
  // The engine raids at lit + rings >= bulbs (bells.ts); a hidden bell's count is unknown, so only the grab counts. design §5.3
  return { bulbs, lit, adds: Math.min(rings, bulbs - (lit ?? 0)), raid: (lit ?? 0) + rings >= bulbs };
}

/** Your duffel coins' worth to each player's share, if nobody else hands in anything (public: the crew size). design §7.1 */
export const shareEach = (view: PlayerView, duffel: number): number => duffel / crewSize(view);

/**
 * "The bank may run short this round": the biggest possible grabs (every player
 * takes the highest limit of an open room) add up to more than the bank holds.
 * Public information only. design §3.2 (a short bank)
 */
export function mayRunShort(view: PlayerView, options: readonly RoomOption[]): boolean {
  const most = Math.max(0, ...options.filter((o) => o.closed === null).map((o) => o.coins));
  return most * crewSize(view) > view.bank;
}

/** A move power the panel offers: what it points at, and for rooms which ones and how many. */
export type PowerControl =
  | { readonly kind: "lookout" | "hide" | "blackout" | "ring" | "reopen"; readonly target: "room"; readonly pick: number; readonly rooms: readonly RoomId[] }
  /** `players`: who can be absolved, never the player absolved last time (roles.ts). */
  | { readonly kind: "absolve"; readonly target: "player"; readonly players: readonly PlayerId[] };

/** Whether `power` is spent (once between meetings, or once per game). design §11.2 */
const spent = (view: PlayerView, power: RolePower): boolean => {
  const { usedThisStretch, usedThisGame } = view.me.roleState;
  return ("perStretch" in power && usedThisStretch >= power.perStretch) || ("perGame" in power && usedThisGame >= power.perGame);
};

/** Who you absolved last time (your own private result), design §11.1: "not the same player twice in a row". */
function lastAbsolved(view: PlayerView): PlayerId | null {
  for (const { event: e } of [...view.caseFile].reverse()) if (e.type === "abilityResolved" && e.player === view.me.id && e.ability.kind === "absolve") return e.ability.target;
  return null;
}

/**
 * The power your role can use with this move, if it has one that a move carries
 * and a use left (design §11.1). It lists what it accepts: the Lookout any room
 * in play, the Electrician any room, the Hacker an open room (not taped off or
 * locked down, design §3.2), the Mole an open
 * room but the Rooftop, the Fixer a taped-off one.
 */
export function powerControl(view: PlayerView): PowerControl | null {
  const job = jobOf(view);
  const power = powerOf({ contentOverrides: setupOf(view)?.contentOverrides ?? null }, view.me.role);
  if (!power || spent(view, power)) return null;
  const taped = (r: RoomId) => Object.hasOwn(view.taped, r);
  const rooms = (keep: (r: RoomId) => boolean) => view.rooms.filter(keep);
  switch (power.kind) {
    case "absolve":
      return { kind: "absolve", target: "player", players: view.players.map((p) => p.id).filter((id) => id !== lastAbsolved(view)) };
    case "lookout":
      return { kind: "lookout", target: "room", pick: power.extraRooms, rooms: view.rooms };
    case "blackout":
      return { kind: "blackout", target: "room", pick: 1, rooms: view.rooms };
    case "hide":
      return { kind: "hide", target: "room", pick: 1, rooms: roomOptions(view).filter((o) => !o.closed).map((o) => o.id) };
    case "ring":
      return { kind: "ring", target: "room", pick: 1, rooms: rooms((r) => !taped(r) && !job.rooms[r]?.lieLow) };
    case "reopen":
      return { kind: "reopen", target: "room", pick: 1, rooms: rooms(taped) };
    default:
      return null;
  }
}

/** The `ability` a move carries for a power aimed at `rooms` or `player`; none when nothing valid is picked. */
export function abilityOf(control: PowerControl | null, rooms: readonly RoomId[], player: PlayerId | null): AbilityUse | undefined {
  if (!control) return undefined;
  if (control.kind === "absolve") return player && control.players.includes(player) ? { kind: "absolve", target: player } : undefined;
  const picked = rooms.filter((r) => control.rooms.includes(r)).slice(0, control.pick);
  const [first] = picked;
  if (!first) return undefined;
  return control.kind === "lookout" ? { kind: "lookout", rooms: picked } : { kind: control.kind, room: first };
}

/** The same move, whatever order a stored copy lists its fields in. */
export const sameMove = (a: Move, b: Move | null): boolean => {
  const canon = (m: unknown): string => JSON.stringify(m, (_, v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y))) : v));
  return canon(a) === canon(b);
};
