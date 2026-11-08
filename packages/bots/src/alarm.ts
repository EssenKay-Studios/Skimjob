// How a bot reads the bells, the tape and Wanted: the public card, bells,
// taped-off rooms and stars in its view. design §5, §13
import { EVENTS, type JobDef, type RoomId } from "@skimjob/content";
import { overrideEvents, ringsOf, roomDef, roundJob, type EventTable, type PlayerView } from "@skimjob/engine";
import { createdOf, jobOf, myPower } from "./read";

/** The event cards with the game's public content overrides. design §13 */
const cardsOf = (view: PlayerView): EventTable => overrideEvents(EVENTS, createdOf(view).contentOverrides);

/** The job as it plays this round: Shift change surges its room (design §13). */
export function jobThisRound(view: PlayerView, job: JobDef = jobOf(view)): JobDef {
  return view.card && view.card.round === view.round ? roundJob(job, view.card, cardsOf(view)) : job;
}

/** The rooms open this round: in play, not taped off (design §5.3) and not closed by Lockdown (§13). */
export const openRooms = (view: PlayerView): RoomId[] => view.rooms.filter((r) => Object.hasOwn(view.bells, r) && view.card?.room !== r);

/**
 * How close a grab of `coins` in `room` brings its bell to a raid on its own:
 * the lit bulbs plus its rings, ÷ the bell's size (1 or more: it raids).
 * Others' rings are unknown until the round resolves (design §5.2).
 */
export function raidRisk(view: PlayerView, job: JobDef, room: RoomId, coins: number): number {
  const power = myPower(view);
  // design §5.2: the Locksmith's coins each ring one time fewer.
  return ((view.bells[room] ?? 0) + ringsOf(roomDef(job, room), coins, power?.kind === "muffle" ? power.fewerRings : 0)) / job.alarm.bulbs;
}

/** The most coins (1 up to `coins`) whose rings keep `room`'s bell below a raid; `coins` if even 1 would raid. design §5.2, §5.3 */
export function quietGrab(view: PlayerView, job: JobDef, room: RoomId, coins: number): number {
  for (let n = coins; n >= 1; n--) if (raidRisk(view, job, room, n) < 1) return n;
  return coins;
}

/** Wanted ÷ the stars short of a bust: 1 at one raid from a bust. design §5.4, §5.5 */
export const bustDanger = (view: PlayerView, job: JobDef = jobOf(view)): number => view.wanted / Math.max(1, job.alarm.bustStars - 1);
