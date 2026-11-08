// Small readers over a PlayerView: everything a bot knows comes from here.
// Bots never see the game state, only viewFor() output. design §17.3
import { DECKS, FILLER_ROLE, ROLES, type JobDef, type RoleDef, type RoleId, type RoomDef, type RoomId } from "@skimjob/content";
import { jobById, overrideJob, overrideRoles, roomDef, type GameEvent, type LoggedEvent, type PlayerId, type PlayerView } from "@skimjob/engine";

type EventOf<T extends GameEvent["type"]> = Extract<GameEvent, { type: T }>;

/** The events of one type in a ledger or case file, oldest first. */
export function ofType<T extends GameEvent["type"]>(list: readonly LoggedEvent[], type: T): EventOf<T>[] {
  const out: EventOf<T>[] = [];
  for (const { event } of list) if (event.type === type) out.push(event as EventOf<T>);
  return out;
}

export function createdOf(view: PlayerView): EventOf<"gameCreated"> {
  const created = view.ledger[0]?.event;
  if (created?.type === "gameCreated") return created;
  const found = ofType(view.ledger, "gameCreated")[0];
  if (!found) throw new Error("view has no gameCreated");
  return found;
}

/** The job, from the public `gameCreated` at the top of the ledger, with the game's content overrides. design §17.4 */
export function jobOf(view: PlayerView): JobDef {
  const created = createdOf(view);
  return overrideJob(jobById(created.job), created.contentOverrides);
}

const crewSize = (view: PlayerView): number => view.players.length + 1;

/** The bot's role definition (content plus the game's overrides); an id with none plays with no power, as in the engine. */
export function roleOf(view: PlayerView): Pick<RoleDef, "power" | "winsOn" | "tag"> {
  const roles = overrideRoles(ROLES, createdOf(view).contentOverrides);
  const def = Object.hasOwn(roles, view.me.role) ? roles[view.me.role] : undefined;
  return def ?? { power: { kind: "none" }, winsOn: [], tag: "teamPlayer" };
}

/** A ★ role: one that can also win when the job fails (`winsOn`). extension.md "How you win" */
export const isStar = (role: RoleId): boolean => (Object.hasOwn(ROLES, role) ? (ROLES[role]?.winsOn.length ?? 0) > 0 : false);

/**
 * Could `role` be in this game, as far as the public setup says: the shown
 * role list (Exact or Possible), else the deck and crew size.
 * extension.md "Host settings"
 */
export function couldBeDealt(view: PlayerView, role: RoleId): boolean {
  if (view.roleList) return view.roleList.roles.includes(role);
  const created = createdOf(view);
  const def = Object.hasOwn(ROLES, role) ? ROLES[role] : undefined;
  if (!def) return false;
  if (role === FILLER_ROLE) return true;
  if (!DECKS[created.deck].includes(role)) return false;
  if (def.minPlayers !== undefined && crewSize(view) < def.minPlayers) return false;
  return true;
}

/** The latest round whose summary is on the ledger; 0 before any. */
export function lastResolvedRound(view: PlayerView): number {
  return ofType(view.ledger, "roundResolved").reduce((r, e) => Math.max(r, e.round), 0);
}

export const roomsWhere = (view: PlayerView, job: JobDef, test: (def: RoomDef) => boolean): RoomId[] =>
  view.rooms.filter((r) => test(roomDef(job, r)));

// ---------------------------------------------------------------- role claims (design §8, §12.1; v2 §4)

/** Every player's claims, oldest first (me included). */
export function claimsOf(view: PlayerView): Map<PlayerId, RoleId[]> {
  const out = new Map<PlayerId, RoleId[]>();
  for (const c of ofType(view.ledger, "roleClaimed")) out.set(c.player, [...(out.get(c.player) ?? []), c.role]);
  return out;
}

/** Who has claimed `role` (any act), in claim order. */
export function claimantsOf(view: PlayerView, role: RoleId): PlayerId[] {
  const out: PlayerId[] = [];
  for (const c of ofType(view.ledger, "roleClaimed")) if (c.role === role && !out.includes(c.player)) out.push(c.player);
  return out;
}

/**
 * Roles dealt at most once, so two claimants means at least one liar. The
 * filler role (Rookie) fills the empty seats and can repeat (design §8.1);
 * so can every role in a game dealt with repeats, which the view can't tell.
 */
export const uniqueRole = (role: RoleId): boolean => role !== FILLER_ROLE;
