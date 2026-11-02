// What the bank cutaway on the game screen shows (M2-9 wiring), read only
// from the player's own view. design §5, §5.4, §6, §18; m2-plan M2-9.
//
// While a round is being planned the board shows your pick for that round
// (you, standing in the room you picked). After a round resolves (alibi
// window, meetings, game over) it shows that round as you know it: you in your
// room, the players your case file says you saw there, the players you watched
// on camera (Security, the Lookout, a Tail perk: `roomWatched`, drawn as
// "seen on camera"; a forged sighting looks the same, by design), and every
// public alibi claim for the round as a dashed ghost. Nothing else: never another player's
// move or room unless the view itself says so.
import { EVENTS, type RoomId } from "@skimjob/content";
import { actOfRound, type PlayerId, type PlayerView } from "@skimjob/engine";
import type { BankOccupant, TimeOfDay } from "../art/BankCutaway";
import { crewTags } from "../art/crook";
import { seatsOf } from "./hud";

export interface BoardScene {
  /** The round on the board (0 before the first round). */
  readonly round: number;
  /** pick: your choice for the round being planned; seen: a resolved round. */
  readonly mode: "pick" | "seen";
  /** Your room on the board. */
  readonly selected: RoomId | null;
  readonly occupants: Readonly<Record<string, readonly BankOccupant[]>>;
  /** Rooms Lockdown shut for that round. design §10 */
  readonly closed: readonly RoomId[];
  readonly time: TimeOfDay;
}

/** Seat index, display name, bot flag and crew-unique tag by player id. */
export interface SeatLook {
  readonly look: number;
  readonly name: string;
  readonly bot: boolean;
  readonly tag: string;
}

export function seatLooks(view: PlayerView): ReadonlyMap<PlayerId, SeatLook> {
  const seats = seatsOf(view);
  const tags = crewTags(seats.map((s) => plainName(s.name)));
  return new Map(seats.map((s, i) => [s.id, { look: i, name: plainName(s.name), bot: s.isBot, tag: tags[i]! }]));
}

/** Seat names carry a "Bot · " prefix for bots; the art draws its own bot badge. */
export const plainName = (name: string) => name.replace(/^Bot · /, "");

/** Act 1 daylight, Act 2 dusk, Act 3 night (ui-style "time-of-day lighting tracks session progress"). */
export const timeOfRound = (round: number): TimeOfDay => {
  const act = actOfRound(Math.max(1, round));
  return act === 1 ? "day" : act === 2 ? "dusk" : "night";
};

/** The latest resolved round (the one an alibi window, a meeting or the end follows). */
function resolvedRound(view: PlayerView): number {
  const p = view.phase;
  if (p.kind === "planning") return p.round - 1;
  if (p.kind === "alibis") return p.round;
  return view.round;
}

/** Where you were in `round`, from your own case file. */
function ownRoom(view: PlayerView, round: number): RoomId | null {
  let room: RoomId | null = null;
  for (const { event: e } of view.caseFile) {
    if (!("round" in e) || e.round !== round || !("player" in e) || e.player !== view.me.id) continue;
    if (e.type === "roomSighting" || e.type === "lootSplit") return e.room;
    if (e.type === "moveSubmitted" || e.type === "defaultMoveAssigned") room = e.move.room;
  }
  return room;
}

function closedIn(view: PlayerView, round: number): RoomId[] {
  const card = view.card;
  if (!card || card.round !== round || !card.room) return [];
  return EVENTS[card.id]?.effect.kind === "lockdown" ? [card.room] : [];
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
    return { round, mode: "pick", selected, occupants, closed: closedIn(view, round), time: timeOfRound(round) };
  }

  const round = resolvedRound(view);
  if (round < 1) return { round: 0, mode: "seen", selected: null, occupants, closed: [], time: "day" };
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
  // design §5.4: claims are public talk, drawn as ghosts. A claim that only
  // repeats what you already see (you, or someone you saw, in that very room) adds nothing.
  for (const { event: e } of view.ledger) {
    if (e.type !== "alibiPosted" || e.round !== round) continue;
    const there = occupants[e.room]?.some((o) => o.id === e.player && !o.ghost);
    if (!there) put(e.room, e.player, "ghost");
  }
  return { round, mode: "seen", selected: mine, occupants, closed: closedIn(view, round), time: timeOfRound(round) };
}
