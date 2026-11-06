// Room definitions: what each room yields, how it moves Heat, and what it tells
// its visitors. Data only; the engine applies it. design §6, §7
import type { RoomId } from "./index";

/** What a room tells its visitors, beyond who else was there (everyone gets that). design §5.2, §6 */
export type RoomInfo =
  | "none"
  /** Security: pick one room and see everyone who was in it this round. design §6.1 */
  | "watchRoom";

/** A room that only holds a few people at full yield. design §6.2 (Deposit boxes) */
export interface RoomCapacity {
  /** The most visitors who still get the full `loot`. */
  readonly max: number;
  /** Loot for *each* visitor when more than `max` go. */
  readonly crowdedLoot: number;
}

export interface RoomDef {
  readonly id: RoomId;
  readonly name: string;
  /** Loot each visitor collects this round (before any capacity rule). design §6 */
  readonly loot: number;
  /**
   * Heat per round × (this room's visitors ÷ crew size). Negative removes Heat
   * (Rooftop). 0 for rooms that don't move Heat. design §7
   */
  readonly heatPressure: number;
  readonly capacity: RoomCapacity | null;
  readonly info: RoomInfo;
}
