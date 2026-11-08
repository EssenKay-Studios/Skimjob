// Small readers over a PlayerView: everything a bot knows comes from here.
// Bots never see the game state, only viewFor() output. design §17.3
import { MAX_ROLE_COPIES, ROLES, type JobDef, type RoleId, type RolePower, type RoomDef, type RoomId } from "@skimjob/content";
import { jobById, overrideJob, overrideRoles, roleHandler, roomDef, type GameEvent, type LoggedEvent, type PlayerId, type PlayerView } from "@skimjob/engine";

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

/** The bot's power (content plus the game's overrides); none for an id with no definition, as in the engine. */
export function myPower(view: PlayerView): RolePower | undefined {
  const roles = overrideRoles(ROLES, createdOf(view).contentOverrides);
  return Object.hasOwn(roles, view.me.role) ? roles[view.me.role]?.power : undefined;
}

/** A role with its own win rule for a heist sunk by theft (the Mole, the Fixer). design §8.4, §19.2 seam 4 */
export const winsSunk = (role: RoleId): boolean => roleHandler(role).winsSunk !== undefined;

/** Could `role` be in this game, as far as the public setup says: the shown role list (Exact or Possible), else any role. design §11.3 */
export function couldBeDealt(view: PlayerView, role: RoleId): boolean {
  return view.roleList ? view.roleList.roles.includes(role) : Object.hasOwn(ROLES, role);
}

/** The latest round whose summary is on the ledger; 0 before any. */
export function lastResolvedRound(view: PlayerView): number {
  return ofType(view.ledger, "roundResolved").reduce((r, e) => Math.max(r, e.round), 0);
}

export const roomsWhere = (view: PlayerView, job: JobDef, test: (def: RoomDef) => boolean): RoomId[] =>
  view.rooms.filter((r) => test(roomDef(job, r)));

// ---------------------------------------------------------------- role claims (design §11.3; v2 §4)

/** Every player's claims, oldest first (me included). */
export function claimsOf(view: PlayerView): Map<PlayerId, RoleId[]> {
  const out = new Map<PlayerId, RoleId[]>();
  for (const c of ofType(view.ledger, "roleClaimed")) out.set(c.player, [...(out.get(c.player) ?? []), c.role]);
  return out;
}

/** Who has claimed `role` (any stretch), in claim order. */
export function claimantsOf(view: PlayerView, role: RoleId): PlayerId[] {
  const out: PlayerId[] = [];
  for (const c of ofType(view.ledger, "roleClaimed")) if (c.role === role && !out.includes(c.player)) out.push(c.player);
  return out;
}

/**
 * How many players can hold `role` (design §11.3): its count on the Exact role
 * list; else one up to 10 players, where every role is distinct, and
 * `MAX_ROLE_COPIES` at 11–12. More claimants than that means at least one liar.
 */
export function copiesOf(view: PlayerView, role: RoleId): number {
  if (view.roleList?.list === "exact") return view.roleList.roles.filter((r) => r === role).length;
  return view.players.length + 1 <= Object.keys(ROLES).length ? 1 : MAX_ROLE_COPIES;
}
