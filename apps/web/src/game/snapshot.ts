// The round's snapshot card (design §10): where everyone says they were, next to what
// everyone saw. Built only from the public ledger: alibis, the window's "no alibi" facts,
// bells, raids, the event card and the missing coins. Nothing is stored; a round has a card
// only once its alibi window has closed. Your own trust marks come from your case file.
import type { EventId, RoomId } from "@skimjob/content";
import { marksOf, type AlibiMark, type PlayerId, type PlayerView, type PublicEvent } from "@skimjob/engine";
import { bankLayout } from "../art/bankLayout";
import { roomName } from "./describeEvent";
import { seatsOf } from "./hud";

/** One crook on the card: what they say (an alibi), or a fact (no alibi, shown in their real room). */
export interface SnapshotCrook {
  readonly player: PlayerId;
  readonly kind: "says" | "fact";
}

export interface SnapshotRoom {
  readonly id: RoomId;
  readonly name: string;
  /** Lit bulbs as the round rang them; "hidden" for a bell a Hacker hid ("?"); null while taped off (no bell). */
  readonly bell: number | "hidden" | null;
  /** Coins seized in a raid on this room this round, or null. */
  readonly raided: number | null;
  /** The room rang this round with nobody saying or shown there. */
  readonly quiet: boolean;
  readonly crooks: readonly SnapshotCrook[];
}

export interface Snapshot {
  readonly round: number;
  /** One row per floor of the bank, top down, each with its rooms in play. */
  readonly floors: readonly (readonly SnapshotRoom[])[];
  /** The round's event card, or null. */
  readonly card: EventId | null;
  /** Coins that went missing this round. */
  readonly missing: number;
}

const inRound = <T extends PublicEvent["type"]>(view: PlayerView, type: T, round: number) =>
  view.ledger.flatMap(({ event: e }) => (e.type === type && "round" in e && e.round === round ? [e as Extract<PublicEvent, { type: T }>] : []));

/** The rounds that have a card: their alibi window has closed. design §10 */
export const snapshotRounds = (view: PlayerView): number[] => view.ledger.flatMap(({ event: e }) => (e.type === "alibiWindowClosed" ? [e.round] : []));

/** design §10: `round`'s card, or null before its alibi window closes. */
export function snapshotOf(view: PlayerView, round: number): Snapshot | null {
  const closed = inRound(view, "alibiWindowClosed", round)[0];
  if (!closed) return null;
  const where = new Map<PlayerId, SnapshotCrook & { room: RoomId }>();
  for (const { event: e } of view.ledger) if (e.type === "said" && e.statement.kind === "alibi" && e.statement.round === round) where.set(e.statement.player, { player: e.statement.player, kind: "says", room: e.statement.room });
  for (const f of closed.noAlibi) where.set(f.player, { player: f.player, kind: "fact", room: f.room });
  const seats = seatsOf(view).map((s) => s.id);
  const rung = inRound(view, "bellsRung", round)[0];
  const before = inRound(view, "bellsCooled", round - 1)[0];
  const hiddenBefore = new Set(inRound(view, "bellsRung", round - 1)[0]?.hidden ?? []);
  const raids = new Map(inRound(view, "roomRaided", round).map((r) => [r.room, r.seized]));
  const room = (id: RoomId): SnapshotRoom => {
    const crooks = seats.flatMap((p) => (where.get(p)?.room === id ? [{ player: p, kind: where.get(p)!.kind }] : []));
    const hidden = rung?.hidden.includes(id) ?? false;
    const lit = rung && Object.hasOwn(rung.bells, id) ? rung.bells[id]! : null;
    // It rang when its bulbs went up from where cooling left them (unknown under a hidden bell, then or now).
    const rang = lit !== null && !hiddenBefore.has(id) && lit > (before?.bells[id] ?? 0);
    return { id, name: roomName(id), bell: hidden ? "hidden" : lit, raided: raids.get(id) ?? null, quiet: rang && crooks.length === 0, crooks };
  };
  const floors = bankLayout(view.rooms, "wide").storeys.flatMap((s) => (s.rooms.length ? [s.rooms.map(room)] : []));
  const card = inRound(view, "eventFlipped", round)[0]?.card ?? null;
  const missing = inRound(view, "roundResolved", round)[0]?.missing ?? 0;
  return { round, floors, card, missing };
}

/** Your own trust marks, by "round/target". Secret to you, from your case file. design §10 */
export const myMarks = (view: PlayerView): ReadonlyMap<string, AlibiMark> => marksOf(view.caseFile.map((x) => x.event), view.me.id);
