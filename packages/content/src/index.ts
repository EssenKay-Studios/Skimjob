// Game content as data: rooms, roles, jobs, events, scaling numbers.
// See docs/design.md §6–§11.
export const CONTENT_VERSION = "0.11.0";

// Content identifiers. Plain strings so new rooms/roles/jobs are pure data;
// their definitions are in rooms.ts, roles.ts and jobs.ts.

/** A room in a job, e.g. "vault", "office", "lobby", "security", "rooftop". design §6 */
export type RoomId = string;

/** A secret role, e.g. "rookie", "lookout", "insideMan", "fence". design §8 */
export type RoleId = string;

/** A job (location), e.g. "bank". design §9 */
export type JobId = string;

export * from "./rooms";
export * from "./roles";
export * from "./jobs";
export * from "./setup";
export * from "./events";
export * from "./perks";
