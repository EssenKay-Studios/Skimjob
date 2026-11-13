// Room definitions: how many coins each room offers, how loud they are, and
// what it tells its visitors. Data only; the engine applies it. design §3.1, §5.2
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
   * The room's noise: each visitor's first `quietCoins` coins are silent, and
   * every coin after them rings once (lights one bulb of the room's bell)
   * [tunable]. Only the Lobby's one coin is silent.
   * design §3.1, §5.2
   */
  readonly quietCoins: number;
  /**
   * The Rooftop: lying low there cools the hottest bell (design §5.6), it is
   * the only escape on a bust (§5.5), and nothing can ring it, so it is never
   * raided (§5.5, §11.1).
   */
  readonly lieLow: boolean;
  readonly info: RoomInfo;
}
