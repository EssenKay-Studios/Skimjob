// Game content as data: rooms, roles, jobs, events, scaling numbers.
// See docs/design.md §6–§11.
export const CONTENT_VERSION = "0.1.0";

// Content identifiers. Plain strings so new rooms/roles/jobs are pure data;
// the definitions themselves (yields, Heat, role powers) arrive with the
// bank-job content task (STATUS.md task 3).

/** A room in a job, e.g. "vault", "office", "lobby", "security", "rooftop". design §6 */
export type RoomId = string;

/** A secret role, e.g. "rookie", "lookout", "insider", "fence". design §8 */
export type RoleId = string;

/** A job (location), e.g. "bank". design §9 */
export type JobId = string;
