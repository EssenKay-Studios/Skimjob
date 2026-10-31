// Small readers over a PlayerView: everything a bot knows comes from here.
// Bots never see the game state, only viewFor() output. design §17.3
import { ROLES, ROUNDS_PER_ACT, type JobDef, type RoleDef, type RoomDef, type RoomId } from "@skimjob/content";
import { jobById, roomDef, type GameEvent, type LoggedEvent, type PlayerView } from "@skimjob/engine";

type EventOf<T extends GameEvent["type"]> = Extract<GameEvent, { type: T }>;

/** The events of one type in a ledger or case file, oldest first. */
export function ofType<T extends GameEvent["type"]>(list: readonly LoggedEvent[], type: T): EventOf<T>[] {
  const out: EventOf<T>[] = [];
  for (const { event } of list) if (event.type === type) out.push(event as EventOf<T>);
  return out;
}

/** The job, from the public `gameCreated` at the top of the ledger. */
export function jobOf(view: PlayerView): JobDef {
  const created = ofType(view.ledger, "gameCreated")[0];
  if (!created) throw new Error("view has no gameCreated");
  return jobById(created.job);
}

export const crewSize = (view: PlayerView): number => view.players.length + 1;

/** A role with no definition yet (the Mole) plays with no power and may pocket, as in the engine. */
export function roleOf(view: PlayerView): Pick<RoleDef, "power" | "canPocket"> {
  const def = Object.hasOwn(ROLES, view.me.role) ? ROLES[view.me.role] : undefined;
  return def ?? { power: { kind: "none" }, canPocket: true };
}

export const totalRounds = (job: JobDef): number => job.checkpoints.perPlayer.length * ROUNDS_PER_ACT;

/** The latest round whose summary is on the ledger; 0 before any. */
export function lastResolvedRound(view: PlayerView): number {
  return ofType(view.ledger, "roundResolved").reduce((r, e) => Math.max(r, e.round), 0);
}

export const roomsWhere = (view: PlayerView, job: JobDef, test: (def: RoomDef) => boolean): RoomId[] =>
  view.rooms.filter((r) => test(roomDef(job, r)));
