// Test-only hooks (not exported from the package): hand a player a perk
// without paying for it (a folded `perkBought` at no cost; no `perkSold`). design §12
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
