// Small pure helpers over job content: rooms by crew size and rings. The numbers live in @skimjob/content; these only
// apply them. design §3.1
//
// Every helper takes the `JobDef` itself, so a simulator content override
// (design §17.4, STATUS.md task 10) only has to change what `jobById` returns.
import { JOBS, type JobDef, type JobId, type RoomDef, type RoomId } from "@skimjob/content";

/** The job definition for `id`. Throws for unknown ids (own keys only). */
export function jobById(id: JobId): JobDef {
  const job = Object.hasOwn(JOBS, id) ? JOBS[id] : undefined;
  if (!job) throw new Error(`unknown job ${id}`);
  return job;
}

/** Rooms in play for a crew of `crewSize`: every tier at or below it, in order. design §3.1 */
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
 * The rings a grab of `coins` makes in `room`: one per coin after its quiet
 * ones, less `fewerRings` per coin, never below 0 (the Locksmith's). design §3.1, §5.2
 */
export const ringsOf = (room: RoomDef, coins: number, fewerRings = 0): number => Math.max(0, coins - room.quietCoins) * Math.max(0, 1 - fewerRings);
