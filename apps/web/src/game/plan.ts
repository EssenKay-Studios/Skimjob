// The plan board on the client (S3b.4): the server's board frames (apps/server
// plan.ts, mirrored here because the web app doesn't import the server) and the
// edit the client posts, and what the plan panel (components/PlanBoard.tsx) reads off a
// board or a resolved round's snapshot. Pure; useGame() reads through these.
// design §10
import { POWER_CLAIM_TARGET, ROLES } from "@skimjob/content";
import type { PlanEditRecord, PlanSnapshot, PlayerId, PlayerView } from "@skimjob/engine";

/** "Hacker → Vault" or "Detective → Eli": `target` is a room or a player, by the role's power. */
export interface PowerClaim {
  readonly role: string;
  readonly target: string;
}
/** One seat's entry. Seats with nothing on the board are not listed. */
export interface PlanEntry {
  readonly player: PlayerId;
  /** Where the crew put this avatar on the proposed plan (anyone may move it). */
  readonly placed: string | null;
  /** The seat's own room claim (✋). */
  readonly room: string | null;
  readonly power: PowerClaim | null;
  readonly agreed: boolean;
}
export interface PlanBoard {
  /** The round it belongs to. */
  readonly round: number;
  /** In seat order. */
  readonly entries: readonly PlanEntry[];
}
/** What the client posts: `{ plan: { place?, room?, power?, agree? } }`. A field left out stays as it is; null clears. */
export interface PlanEdit {
  /** Put anyone's avatar on a room of the proposed plan, or take it off with null. */
  readonly place?: { readonly player: PlayerId; readonly room: string | null };
  readonly room?: string | null;
  readonly power?: PowerClaim | null;
  readonly agree?: boolean;
}

const isStr = (x: unknown): x is string => typeof x === "string";
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

function asEntry(x: unknown): PlanEntry | null {
  if (!isObj(x) || !isStr(x.player) || !(x.placed === null || isStr(x.placed)) || !(x.room === null || isStr(x.room)) || typeof x.agreed !== "boolean") return null;
  if (x.power === null) return { player: x.player, placed: x.placed, room: x.room, power: null, agreed: x.agreed };
  if (!isObj(x.power) || !isStr(x.power.role) || !isStr(x.power.target)) return null;
  return { player: x.player, placed: x.placed, room: x.room, power: { role: x.power.role, target: x.power.target }, agreed: x.agreed };
}

/** A server `plan` payload, or null if it isn't one (dropped, never half-rendered); bad entries are dropped. */
export function asPlanBoard(x: unknown): PlanBoard | null {
  if (!isObj(x) || typeof x.round !== "number" || !Number.isFinite(x.round) || !Array.isArray(x.entries)) return null;
  return { round: x.round, entries: x.entries.map(asEntry).filter((e): e is PlanEntry => e !== null) };
}

/** "4 of 6 agreed": `seats` counts every seat, bots too. design §10 */
export const agreedText = (entries: readonly Pick<PlanEntry, "agreed">[], seats: number) => `${entries.filter((e) => e.agreed).length} of ${seats} agreed`;

/** Whether a role's pledge names a room or a player ("Hacker → Vault", "Detective → Eli"). design §10 */
export const pledgeAims = (role: string): "room" | "player" | undefined => {
  const kind = ROLES[role]?.power.kind;
  return kind === undefined ? undefined : POWER_CLAIM_TARGET[kind];
};

/** Every role whose power can be pledged, by name: any role may be claimed, true or not. design §10 */
export const pledgeRoles = (): readonly { readonly id: string; readonly name: string }[] =>
  Object.entries(ROLES)
    .filter(([id]) => pledgeAims(id) !== undefined)
    .map(([id, r]) => ({ id, name: r.name }));

/** The plan of the latest round that has one (the engine logs none when nobody used the board). design §10 */
export function lastPlan(view: PlayerView): { readonly round: number; readonly plan: PlanSnapshot } | null {
  for (const { event: e } of [...view.ledger].reverse()) if (e.type === "said" && e.statement.kind === "plan") return { round: e.statement.round, plan: e.statement.plan };
  return null;
}

/** The snapshot's history, the edit with the most time left first; a bot's edit (no time left on record) came with the round's start, so it leads. design §10 */
export const historyOrder = (history: readonly PlanEditRecord[]): PlanEditRecord[] =>
  history.map((e, i) => ({ e, i })).sort((a, b) => (b.e.msBeforeDeadline ?? Infinity) - (a.e.msBeforeDeadline ?? Infinity) || a.i - b.i).map((x) => x.e);

/**
 * When an edit was made, as time left to the round's deadline: never a wall
 * time (the log has none). No time left on record marks a bot's edit. design §10
 */
export function beforeDeadline(ms: number | null): string {
  if (ms === null) return "bot";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "under a minute before the deadline";
  if (min < 60) return `${min} min before the deadline`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} h ${min % 60} min before the deadline`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h before the deadline`;
}

/** One history row in words: "Ben moved themselves to the Vault". `room` and `role` give display names. design §10 */
export function editText(e: PlanEditRecord, name: (p: PlayerId) => string, room: (r: string) => string, role: (r: string) => string): string {
  const who = name(e.actor);
  switch (e.kind) {
    case "place":
      return e.value === null ? `${who} took ${e.subject === e.actor ? "themselves" : name(e.subject)} off the board` : `${who} moved ${e.subject === e.actor ? "themselves" : name(e.subject)} to the ${room(e.value)}`;
    case "room":
      return e.value === null ? `${who} dropped their room claim` : `${who} claimed the ${room(e.value)}`;
    case "power":
      return e.value === null ? `${who} dropped their pledge` : `${who} pledged ${role(e.value)} → ${pledgeAims(e.value) === "player" ? name(e.target!) : room(e.target!)}`;
    case "agree":
      return e.value === "true" ? `${who} agreed` : `${who} took back their agreement`;
  }
}
