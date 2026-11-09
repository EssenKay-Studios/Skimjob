// What a stash holds above the share: what a shakedown or the Priest takes back. design §7.6, §9.6, §11.1
import type { GameState, PlayerId, PlayerState } from "./types";

/** What `target` holds above the share (the pocketed coins still held; 0 at or below it): what a shakedown takes. design §7.6, §9.6 */
export const aboveShare = (state: GameState, target: PlayerId): number => Math.max(0, (state.players[target] as PlayerState).stash - state.share);
