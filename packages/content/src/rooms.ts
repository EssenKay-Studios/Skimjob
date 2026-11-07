// Room definitions: how many coins each room offers, how it moves Heat, and
// what it tells its visitors. Data only; the engine applies it. design §3.1
import type { RoomId } from "./index";

/** What a room tells its visitors, beyond who else was there (everyone gets that). design §3.4 */
export type RoomInfo =
  | "none"
  /** Security: pick one room and see everyone who was in it this round. design §3.1 */
  | "watchRoom";

export interface RoomDef {
  readonly id: RoomId;
  readonly name: string;
  /**
   * The most coins each visitor may grab this round [tunable]. Visitors don't
   * share it. 0 for Security and the Rooftop. design §3.1
   */
  readonly coins: number;
  /**
   * Heat per round × (this room's visitors ÷ crew size). Negative removes Heat
   * (Rooftop). 0 for rooms that don't move Heat. R6 Heat, until bells (S3a.2).
   */
  readonly heatPressure: number;
  readonly info: RoomInfo;
}
