// Test-only hooks (not exported from the package): hand a player a perk
// without paying for it, as a folded `perkBought` at no cost. It counts as a
// real purchase in its round: it uses up the player's one perk that round, and
// a perk given while planning still gets its `perkSold` notice as planning
// closes (only one given outside planning gets none). design §12
import type { RoomId } from "@skimjob/content";
import type { GameState, PlayerId } from "./types";
import { privateTo } from "./types";
import { applyEvent } from "./reduce";

/** `player` holds a Bail. */
export const giveBail = (state: GameState, player: PlayerId): GameState =>
  applyEvent(state, { type: "perkBought", visibility: privateTo(player), player, round: state.round, perk: { kind: "bail" }, cost: 0 });

/** `player` bought a Tail on `room` last round, so it watches `room` as this round resolves. */
export const giveTail = (state: GameState, player: PlayerId, room: RoomId): GameState =>
  applyEvent(state, { type: "perkBought", visibility: privateTo(player), player, round: state.round - 1, perk: { kind: "tail", room }, cost: 0 });
