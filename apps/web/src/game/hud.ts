// Pure helpers behind the game screen: what the HUD, seats, move and alibi
// panels show, read only from the player's own view (and the public timers).
// docs/m2-plan.md M2-6; design §5, §5.4, §6, §11.5, §13
import { EVENTS, type JobDef, type RoomId } from "@skimjob/content";
import {
  jobFor,
  rolesFor,
  type GameCreated,
  type Outcome,
  type PlayerId,
  type PlayerView,
} from "@skimjob/engine";
import { meetingAfter, meetingName } from "./wording";

/** A deadline as the live channel sends it (apps/server scheduler.ts `Timer`). */
export interface Timer {
  readonly key: string;
  /** Epoch ms on the server's clock. */
  readonly dueAt: number;
  /** Set while a meeting pauses it. */
  readonly pausedAt: number | null;
}

/** The public setup event (first in every ledger). */
export const setupOf = (view: PlayerView): GameCreated | null => {
  for (const { event } of view.ledger) if (event.type === "gameCreated") return event;
  return null;
};

/** The job's numbers, with any content overrides the game was set up with. design §17.4 */
export const jobOf = (view: PlayerView): JobDef => {
  const setup = setupOf(view);
  return jobFor({ job: setup?.job ?? "bank", contentOverrides: setup?.contentOverrides ?? null });
};

export const crewSize = (view: PlayerView) => view.players.length + 1;

/** A seat at the table, in seat order (you included). */
export interface SeatInfo {
  readonly id: PlayerId;
  readonly name: string;
  readonly isBot: boolean;
  readonly you: boolean;
  /**
   * Locked in a move for the round being planned (also while a meeting
   * interrupts it). Public for everyone (owner decision, 2 Nov: `moveLocked`);
   * what they picked never is. design §5.1
   */
  readonly lockedIn: boolean;
}

/** A human seat's presence as the live channel sends it (apps/server live.ts `SeatPresence`). */
export interface SeatPresence {
  readonly online: boolean;
  /** Epoch ms on the server's clock; null: never had the game open. */
  readonly lastSeen: number | null;
}
export type Presence = Readonly<Record<PlayerId, SeatPresence>>;

/** What a seat's presence line says (owner decision, 2 Nov). Bots are bots, never "online". */
export interface PresenceInfo {
  readonly kind: "bot" | "online" | "seen" | "never" | "unknown";
  readonly text: string;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function agoText(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/** `seat`'s presence at server time `now`; `presence` null until the server has sent it. */
export function presenceInfo(seat: Pick<SeatInfo, "id" | "isBot" | "you">, presence: Presence | null, now: number): PresenceInfo {
  if (seat.isBot) return { kind: "bot", text: "bot" };
  if (seat.you) return { kind: "online", text: "online" };
  const p = presence && Object.hasOwn(presence, seat.id) ? presence[seat.id] : undefined;
  if (!p) return { kind: "unknown", text: "" };
  if (p.online) return { kind: "online", text: "online" };
  if (p.lastSeen === null) return { kind: "never", text: "not here yet" };
  return { kind: "seen", text: `seen ${agoText(now - p.lastSeen)}` };
}

export function seatsOf(view: PlayerView): SeatInfo[] {
  const order = setupOf(view)?.players ?? [...view.players, { id: view.me.id, name: "You", isBot: false }];
  const locked = new Set(view.lockedIn);
  return order.map((p) => ({
    id: p.id,
    name: p.name,
    isBot: p.isBot,
    you: p.id === view.me.id,
    lockedIn: locked.has(p.id),
  }));
}

/** Display names by player id. */
export const namesOf = (view: PlayerView): ((p: PlayerId) => string) => {
  const map = new Map(seatsOf(view).map((s) => [s.id, s.name]));
  return (p) => map.get(p) ?? p;
};

export interface PhaseInfo {
  /** e.g. "Planning" (the HUD's kicker already says the round). */
  readonly title: string;
  /** The deadline the countdown shows, and what it means ("locks in"). */
  readonly timerKey: string | null;
  readonly timerLabel: string;
}

export function phaseInfo(view: PlayerView): PhaseInfo {
  const p = view.phase;
  switch (p.kind) {
    case "setup":
      return { title: "Setting up the job", timerKey: null, timerLabel: "" };
    case "planning":
      return { title: "Planning: pick a room", timerKey: `round:${p.round}`, timerLabel: "locks in" };
    case "alibis":
      return { title: "Alibi window", timerKey: `alibis:${p.round}`, timerLabel: "alibis close in" };
    case "awaitingMeeting":
      return {
        title: `Round ${meetingAfter(p.act)} done: ${meetingName(p.act)} next`,
        timerKey: view.scheduledMeeting ? `openMeeting:${view.scheduledMeeting.meetingId}` : null,
        timerLabel: "opens in",
      };
    case "meeting":
      return { title: "Crew meeting", timerKey: `closeMeeting:${p.meetingId}`, timerLabel: "votes close in" };
    case "shakedownPending":
      return { title: "Shakedown pending", timerKey: `resolveShakedown:${p.meetingId}`, timerLabel: "lands in" };
    case "ended":
      return { title: p.outcome.result === "success" ? "Job done" : "Busted", timerKey: null, timerLabel: "" };
    default: {
      const never: never = p;
      return never;
    }
  }
}

/**
 * The deadline `key` names. A round (`round:<n>`) ends at the earlier of its own
 * deadline and `roundEarly:<n>`, set once the whole crew has locked in (owner
 * decision, 2 Nov; design §4.1).
 */
export function timerFor(timers: readonly Timer[], key: string | null): Timer | null {
  if (!key) return null;
  const own = timers.find((t) => t.key === key) ?? null;
  if (!key.startsWith("round:")) return own;
  const early = timers.find((t) => t.key === `roundEarly:${key.slice("round:".length)}`) ?? null;
  if (!own || !early) return own ?? early;
  return early.dueAt <= own.dueAt ? early : own;
}

/** Time left on `timer` at server time `now`; a paused timer keeps what it had when it stopped. */
export const remainingMs = (timer: Timer, now: number): number => Math.max(0, timer.dueAt - (timer.pausedAt ?? now));

/** "0:42", "12:05", "4h 12m", "2d 3h". Rounded up, so it never shows 0:00 early. */
export function formatCountdown(ms: number): string {
  const s = Math.ceil(Math.max(0, ms) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const m = Math.ceil(s / 60);
  if (m < 24 * 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  const h = Math.ceil(m / 60);
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** One room in the move panel: its coins this round and its bell. design §3.1, §5.1, §13 */
export interface RoomOption {
  readonly id: RoomId;
  readonly name: string;
  /** The most coins a visitor grabs here this round (Shift change included). design §3.1 */
  readonly loot: number;
  /** "Bell 2 of 4", or "Bell off" while taped off. design §5.1, §5.3 */
  readonly bell: string;
  /** Why nobody can pick it this round (Lockdown, or taped off after a raid), or null. design §5.3, §13 */
  readonly closed: string | null;
  /** Short notes: "+1 coin this round", "watch one room". */
  readonly notes: readonly string[];
  /** Security: the move must name a room to watch. design §6.1 */
  readonly watcher: boolean;
}

export function roomOptions(view: PlayerView): RoomOption[] {
  const job = jobOf(view);
  const card = view.card && view.card.round === view.round ? view.card : null;
  const effect = card ? EVENTS[card.id]?.effect : undefined;
  return view.rooms.map((id) => {
    const def = job.rooms[id];
    const notes: string[] = [];
    let loot = def?.coins ?? 0;
    if (effect?.kind === "roomSurge" && effect.room === id) {
      loot += effect.extraCoins;
      if (effect.extraCoins !== 0) notes.push(`+${effect.extraCoins} coin this round`);
    }
    if (def?.info === "watchRoom") notes.push("watch one room");
    const taped = Object.hasOwn(view.taped, id);
    const closed = taped ? `Taped off through round ${view.taped[id]}` : effect?.kind === "lockdown" && card?.room === id ? "Closed by Lockdown" : null;
    const bell = taped ? "Bell off" : `Bell ${view.bells[id] ?? 0} of ${job.alarm.bulbs}`;
    return { id, name: def?.name ?? id, loot, bell, closed, notes, watcher: def?.info === "watchRoom" };
  });
}

/** The room a missed deadline sends you to. design §5.1 */
export const defaultRoom = (view: PlayerView): RoomId => jobOf(view).defaultRoom;

/** The latest round you missed, if it is the round that just resolved (shown on the move panel); room null when you sat it out. design §3.3 */
export function justMissed(view: PlayerView): { readonly round: number; readonly room: RoomId | null } | null {
  const latest = view.caseFile.filter((x) => x.event.type === "defaultMoveAssigned").at(-1)?.event;
  if (!latest || latest.type !== "defaultMoveAssigned") return null;
  const lastResolved = view.phase.kind === "planning" ? view.phase.round - 1 : view.phase.kind === "alibis" ? view.phase.round : view.round;
  return latest.round === lastResolved ? { round: latest.round, room: latest.move?.room ?? null } : null;
}

/** The round whose alibi you may post, and the room you already claimed for it (if any). design §5.4 */
export function alibiState(view: PlayerView): { readonly round: number; readonly posted: RoomId | null } | null {
  if (view.alibiRound === null) return null;
  const round = view.alibiRound;
  let posted: RoomId | null = null;
  for (const { event } of view.ledger) if (event.type === "alibiPosted" && event.player === view.me.id && event.round === round) posted = event.room;
  return { round, posted };
}

/** The final outcome once the game has ended. design §3, §13 */
export const outcomeOf = (view: PlayerView): Outcome | null => (view.phase.kind === "ended" ? view.phase.outcome : (view.reveal?.outcome ?? null));
