// Test-only hook (not exported from the package): hand a player perks without
// earning tokens and buying them (`perkBought` at no cost, folded only).
// extension.md "Tokens and the perk shop"
import type { PerkId } from "@skimjob/content";
import type { GameState, PlayerId } from "./types";
import { privateTo } from "./types";
import { applyEvent } from "./reduce";

export function grantPerks(state: GameState, player: PlayerId, ...perks: PerkId[]): GameState {
  return perks.reduce((s, perk) => applyEvent(s, { type: "perkBought", visibility: privateTo(player), player, perk, cost: 0 }), state);
}
