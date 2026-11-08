// Bells, raids, Wanted and cooling: the pure steps of §4.2 that the round loop
// (round.ts) runs between the grabs and the round summary. design §4.2, §5
//
// Bells are kept per open room: a taped-off room's bell is off, so it has no
// entry until the room reopens at 0 (§5.3). Every helper walks the rooms in
// `rooms` order, so the result never depends on object key order.
import { FACTS, type FactId, type RoomId } from "@skimjob/content";
import type { GameState, PublicVisibility } from "./types";
import { PUBLIC } from "./types";
import type { Draw } from "./handle";

/** The one helper every public fact is emitted through: its visibility comes from content, for every fact the event carries. design §19 seam 1 */
export const factVisibility = (...facts: readonly FactId[]): PublicVisibility => {
  for (const fact of facts) if (FACTS[fact] !== "public") throw new Error(`fact ${fact} has no R7 visibility`);
  return PUBLIC;
};

/** Whether `room` is taped off this round: nobody can pick it and nothing rings it. design §5.3 */
export const isTaped = (state: Pick<GameState, "taped">, room: RoomId): boolean => Object.hasOwn(state.taped, room);

/** The open rooms of `bells`, in `rooms` order. */
const openRooms = (rooms: readonly RoomId[], bells: Readonly<Record<RoomId, number>>): RoomId[] => rooms.filter((r) => Object.hasOwn(bells, r));

/**
 * design §5.2 (§4.2 step 2): each ring lights one bulb of its room's bell,
 * up to its `bulbs`. Rings in a room whose bell is off are never counted
 * (nobody can be there). Returns every open room's lit bulbs.
 */
export function ringBells(rooms: readonly RoomId[], bells: Readonly<Record<RoomId, number>>, rings: ReadonlyMap<RoomId, number>, bulbs: number): Record<RoomId, number> {
  return Object.fromEntries(openRooms(rooms, bells).map((r) => [r, Math.min(bulbs, (bells[r] as number) + (rings.get(r) ?? 0))]));
}

/** design §5.3 (§4.2 step 3): the rooms whose last bulb is lit, in `rooms` order. */
export const raidedRooms = (rooms: readonly RoomId[], bells: Readonly<Record<RoomId, number>>, bulbs: number): RoomId[] =>
  openRooms(rooms, bells).filter((r) => (bells[r] as number) >= bulbs);

/**
 * design §5.6 (§4.2 step 6): every open room turns off 1 bulb (never below 0),
 * then each of the `lyingLow` Rooftop players in turn cools the room that is
 * hottest at that moment by 1 more. Ties are drawn with the game's seeded
 * randomness; nothing is drawn without a tie, or once every bell is dark.
 */
export function coolBells(rooms: readonly RoomId[], bells: Readonly<Record<RoomId, number>>, lyingLow: number, draw: Draw): Record<RoomId, number> {
  const open = openRooms(rooms, bells);
  const out: Record<RoomId, number> = Object.fromEntries(open.map((r) => [r, Math.max(0, (bells[r] as number) - 1)]));
  for (let i = 0; i < lyingLow; i++) {
    const top = Math.max(0, ...open.map((r) => out[r] as number));
    if (top === 0) break;
    const hottest = open.filter((r) => out[r] === top);
    const room = hottest.length === 1 ? (hottest[0] as RoomId) : draw.pick(hottest);
    out[room] = top - 1;
  }
  return out;
}
