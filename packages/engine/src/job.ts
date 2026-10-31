// Small pure helpers over job content: rooms by crew size, room yields, the
// Heat formula and checkpoint targets. The numbers live in @skimjob/content;
// these only apply them. design §6, §7, §11.5
//
// Every helper takes the `JobDef` itself, so a simulator content override
// (design §17.4, STATUS.md task 10) only has to change what `jobById` returns.
import { JOBS, type JobDef, type JobId, type RoomDef, type RoomId } from "@skimjob/content";
import type { ActNumber } from "./types";

/** The job definition for `id`. Throws for unknown ids (own keys only). */
export function jobById(id: JobId): JobDef {
  const job = Object.hasOwn(JOBS, id) ? JOBS[id] : undefined;
  if (!job) throw new Error(`unknown job ${id}`);
  return job;
}

/** Rooms in play for a crew of `crewSize`: every tier at or below it, in order. design §6.2 */
export function roomsInPlay(job: JobDef, crewSize: number): RoomId[] {
  return job.roomTiers.filter((t) => t.minPlayers <= crewSize).flatMap((t) => t.rooms);
}

/** The definition of `room` in `job`. Throws for rooms the job doesn't have. */
export function roomDef(job: JobDef, room: RoomId): RoomDef {
  const def = Object.hasOwn(job.rooms, room) ? job.rooms[room] : undefined;
  if (!def) throw new Error(`job ${job.id} has no room ${room}`);
  return def;
}

/**
 * Loot each visitor collects from a room with `visitors` people in it. A room
 * with a capacity pays `crowdedLoot` to everyone once more than `max` go.
 * design §6.1, §6.2 (Deposit boxes)
 */
export function roomLoot(room: RoomDef, visitors: number): number {
  if (room.capacity && visitors > room.capacity.max) return room.capacity.crowdedLoot;
  return room.loot;
}

/**
 * Heat change for one resolved round, before events and checkpoint penalties:
 * the baseline plus each room's pressure × (its visitors ÷ crew size), rounded
 * to the nearest whole number (halves round up). design §7
 * (rounding is provisional, see docs/decisions.md)
 */
export function roundHeatDelta(
  job: JobDef,
  crewSize: number,
  visitors: Readonly<Record<RoomId, number>>,
): number {
  if (!Number.isInteger(crewSize) || crewSize < 1) throw new Error(`crew size must be a positive integer, got ${crewSize}`);
  let pressure = 0;
  for (const [room, count] of Object.entries(visitors)) pressure += roomDef(job, room).heatPressure * count;
  // One division, so equal crew shares give exactly equal Heat at any crew size.
  return Math.round(job.heat.perRound + pressure / crewSize);
}

/** Heat stays within 0–max: laying low can't bank Heat below zero. design §7 */
export function clampHeat(job: JobDef, heat: number): number {
  return Math.min(job.heat.max, Math.max(0, heat));
}

/** Cumulative Haul target at the end of `act` (Act 3 = final target). design §11.5 */
export function checkpointTarget(job: JobDef, act: ActNumber, crewSize: number): number {
  const perPlayer = job.checkpoints.perPlayer[act - 1];
  if (perPlayer === undefined) throw new Error(`no checkpoint for act ${act}`);
  return perPlayer * crewSize;
}
