// Test helper (not exported from the package): a move's room and bags for a
// full grab. design §3.2
import { BANK_JOB, type RoomId } from "@skimjob/content";
import type { ContentOverrides } from "./types";

/**
 * Grab `room`'s whole limit (its coins in content, or in `overrides` when a
 * test pins them), `pocket` of them into the pocket and the rest into the duffel.
 */
export function fullGrab(room: RoomId, pocket = 0, overrides?: ContentOverrides): { readonly room: RoomId; readonly duffel: number; readonly pocket: number } {
  const coins = overrides?.rooms?.[room]?.coins ?? BANK_JOB.rooms[room]?.coins ?? 0;
  return { room, duffel: Math.max(0, coins - pocket), pocket };
}
