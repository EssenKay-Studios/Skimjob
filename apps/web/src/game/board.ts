// What the bank cutaway on the game screen shows (M2-9 wiring), read only
// from the player's own view. design §5, §5.4, §6, §18; m2-plan M2-9.
//
// While a round is being planned the board shows your pick for that round
// (you, standing in the room you picked). After a round resolves (alibi
// window, meetings, game over) it shows that round as you know it: you in your
// room, the players your case file says you saw there, the players you watched
// on camera (Security, the Lookout, a Tail perk: `roomWatched`, drawn as
// "seen on camera"), and every
// public alibi claim for the round as a dashed ghost. Nothing else: never another player's
// move or room unless the view itself says so.
import { EVENTS, type RoomId } from "@skimjob/content";
import type { PlayerId, PlayerView } from "@skimjob/engine";
import type { BankOccupant, RoomBell, TimeOfDay } from "../art/BankCutaway";
import { crewTags } from "../art/crookLooks";
import { jobOf, roomOptions, seatsOf, setupOf } from "./hud";
import { ownRings } from "./move";

export interface BoardScene {
  /** The round on the board (0 before the first round). */
  readonly round: number;
  /** pick: your choice for the round being planned; seen: a resolved round. */
  readonly mode: "pick" | "seen";
  /** Your room on the board. */
  readonly selected: RoomId | null;
  readonly occupants: Readonly<Record<string, readonly BankOccupant[]>>;
  /** Rooms shut for that round: Lockdown's (design §13) and the taped-off ones (§5.3). */
  readonly closed: readonly RoomId[];
  /** Rounds each taped-off room stays closed, "CLOSED 2" counting down. design §5.3 */
  readonly taped: Readonly<Record<RoomId, number>>;
  /** Each open room's bell: lit bulbs, your preview, or hidden. A taped-off room's bell is off (no entry). design §5.1, §5.2 */
  readonly bells: Readonly<Record<RoomId, RoomBell>>;
  readonly time: TimeOfDay;
}

/** Seat number, display name, bot flag and crew-unique tag by player id. */
export interface SeatLook {
  readonly look: number;
  readonly name: string;
  readonly bot: boolean;
  readonly tag: string;
}

export function seatLooks(view: PlayerView): ReadonlyMap<PlayerId, SeatLook> {
  const seats = seatsOf(view);
  const tags = crewTags(seats.map((s) => plainName(s.name)));
  return new Map(seats.map((s, i) => [s.id, { look: s.seat, name: plainName(s.name), bot: s.isBot, tag: tags[i]! }]));
}

/** Seat names carry a "Bot · " prefix for bots; the art draws its own bot badge. */
const plainName = (name: string) => name.replace(/^Bot · /, "");

/** The first third of the round cap is daylight, the second dusk, the last night (ui-style "time-of-day lighting tracks session progress"). */
export const timeOfRound = (round: number, roundCap: number): TimeOfDay => {
  const third = Math.ceil((Math.max(1, round) * 3) / roundCap);
  return third <= 1 ? "day" : third === 2 ? "dusk" : "night";
};

/** The latest resolved round (the one a result window, a meeting or the end follows). */
function resolvedRound(view: PlayerView): number {
  const p = view.phase;
  if (p.kind === "planning") return p.round - 1;
  if (p.kind === "result") return p.round;
  return view.round;
}

/** Where you were in `round`, from your own case file. */
function ownRoom(view: PlayerView, round: number): RoomId | null {
  let room: RoomId | null = null;
  for (const { event: e } of view.caseFile) {
    if (!("round" in e) || e.round !== round || !("player" in e) || e.player !== view.me.id) continue;
    if (e.type === "roomSighting" || e.type === "coinsGrabbed") return e.room;
    if (e.type === "moveSubmitted" || e.type === "defaultMoveAssigned") room = e.move?.room ?? null;
  }
  return room;
}

/** Rooms closed in `round`: a Lockdown card's (design §13) and, this round, the taped-off ones (§5.3). */
function closedIn(view: PlayerView, round: number): RoomId[] {
  const taped = round === view.round ? Object.keys(view.taped) : [];
  const card = view.card;
  if (!card || card.round !== round || !card.room) return taped;
  return EVENTS[card.id]?.effect.kind === "lockdown" ? [card.room, ...taped] : taped;
}

/**
 * Rounds each taped-off room is still closed, counting the round being planned
 * (or, between rounds, the next one): raided in round 4 with 2 taped rounds, it
 * reads 2 through round 4's result and the planning of round 5, 1 in round 6. design §5.3
 */
function tapedLeft(view: PlayerView): Record<RoomId, number> {
  const next = view.phase.kind === "planning" ? view.round : view.round + 1;
  return Object.fromEntries(Object.entries(view.taped).map(([room, through]) => [room, Math.max(1, through - next + 1)]));
}

/**
 * The bells as the public sees them: a taped-off room has none, a hidden one
 * shows "?" (unless the view carries the real count: the Hacker who hid it).
 * While planning, the room you picked previews the rings your grab would add
 * (the Locksmith's coins ring one fewer, as this game's content has it) unless
 * you bought Soft shoes last round: then your coins ring nothing and nothing is
 * previewed. A hidden bell shows no preview, since every bulb reads "?". design §5.1, §5.2, §11.1, §12
 */
function bellsOf(view: PlayerView, selected: RoomId | null, taped: Readonly<Record<RoomId, number>>): Record<RoomId, RoomBell> {
  const hidden = new Set(view.hiddenBells);
  const coinsAt = new Map(roomOptions(view).map((o) => [o.id, o.coins]));
  const bells: Record<RoomId, RoomBell> = {};
  for (const room of view.rooms) {
    if (Object.hasOwn(taped, room)) continue;
    const lit = view.bells[room];
    if (lit === undefined) {
      bells[room] = { lit: 0, hidden: hidden.has(room) };
      continue;
    }
    const coins = view.me.move?.room === room ? view.me.move.duffel + view.me.move.pocket : (coinsAt.get(room) ?? 0);
    const rings = view.phase.kind === "planning" && room === selected ? ownRings(view, room, coins) : 0;
    bells[room] = { lit, ...(rings > 0 && { preview: rings }) };
  }
  return bells;
}

/**
 * The board for this view. `pick` is the room picked in the move panel or on
 * the board but not yet locked in (planning only).
 */
export function boardScene(view: PlayerView, pick: RoomId | null = null): BoardScene {
  const looks = seatLooks(view);
  const occupants: Record<string, BankOccupant[]> = {};
  const put = (room: RoomId, id: PlayerId, kind: "here" | "camera" | "ghost" = "here") => {
    const s = looks.get(id);
    const o: BankOccupant = {
      id,
      name: s?.name ?? id,
      look: s?.look ?? id,
      bot: s?.bot ?? false,
      ...(s ? { tag: s.tag } : {}),
      ...(kind === "ghost" ? { ghost: true } : kind === "camera" ? { camera: true } : {}),
    };
    (occupants[room] ??= []).push(o);
  };

  if (view.phase.kind === "planning") {
    const round = view.phase.round;
    const selected = pick ?? view.me.move?.room ?? null;
    if (selected) put(selected, view.me.id);
    const taped = tapedLeft(view);
    return { round, mode: "pick", selected, occupants, closed: closedIn(view, round), taped, bells: bellsOf(view, selected, taped), time: timeOfRound(round, jobOf(view).roundCap) };
  }

  const round = resolvedRound(view);
  if (round < 1) return { round: 0, mode: "seen", selected: null, occupants, closed: [], taped: {}, bells: bellsOf(view, null, {}), time: "day" };
  const mine = ownRoom(view, round);
  const seen = new Set<PlayerId>();
  if (mine) put(mine, view.me.id);
  for (const { event: e } of view.caseFile) {
    if (e.type !== "roomSighting" || e.player !== view.me.id || e.round !== round) continue;
    for (const other of e.others) {
      if (other === view.me.id || seen.has(other)) continue;
      seen.add(other);
      put(e.room, other);
    }
  }
  // design §6.1, §8, §8.3: rooms you watched. Everyone placed in person stays
  // where you stood with them; anyone else is drawn once, on camera.
  seen.add(view.me.id);
  for (const { event: e } of view.caseFile) {
    if (e.type !== "roomWatched" || e.player !== view.me.id || e.round !== round) continue;
    for (const other of e.seen) {
      if (seen.has(other)) continue;
      seen.add(other);
      put(e.room, other, "camera");
    }
  }
  // design §11.3: alibis are public talk, drawn as ghosts. One that only
  // repeats what you already see (you, or someone you saw, in that very room) adds nothing.
  for (const { event: e } of view.ledger) {
    if (e.type !== "said" || e.statement.kind !== "alibi" || e.statement.round !== round) continue;
    const { room, player } = e.statement;
    const there = occupants[room]?.some((o) => o.id === player && !o.ghost);
    if (!there) put(room, player, "ghost");
  }
  const taped = tapedLeft(view);
  return { round, mode: "seen", selected: mine, occupants, closed: closedIn(view, round), taped, bells: bellsOf(view, mine, taped), time: timeOfRound(round, jobOf(view).roundCap) };
}
