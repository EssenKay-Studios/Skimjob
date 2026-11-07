// The plan board on the client (S3b.4): the server's board frames (apps/server
// plan.ts, mirrored here because the web app doesn't import the server) and the
// edit the client posts. Pure; useGame() reads through these. The board's UI is S4.3.
// design §10
import type { PlayerId } from "@skimjob/engine";

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
