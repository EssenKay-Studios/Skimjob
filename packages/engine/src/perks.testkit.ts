// Test-only hook (not exported from the package): grant perk tokens without a
// role trigger. Role deck v2 R1 has no role that earns perks yet; R2/R3 wire
// the real triggers, which emit the same private `perkGranted`. design §8.3
import type { PerkId } from "@skimjob/content";
import type { GameState, PlayerId } from "./types";
import { privateTo } from "./types";
import { applyEvent } from "./reduce";

export function grantPerks(state: GameState, player: PlayerId, ...perks: PerkId[]): GameState {
  return perks.reduce((s, perk) => applyEvent(s, { type: "perkGranted", visibility: privateTo(player), player, perk }), state);
}
