// The bots' suspicion model: a score for every other player, worked out from
// the view alone. design §17.3 (and §5.3 shortfalls, §5.4 alibis, §6 Security
// and Server room, §8 Lookout, §11.3 shakedown results)
//
// Rebuilt from the ledger and case file each time it's needed, so a bot keeps
// no hidden memory of its own: same view, same scores.
import type { RoomId } from "@skimjob/content";
import { roomDef, roomLoot, type PlayerId, type PlayerView, type RoundResolved } from "@skimjob/engine";
import { jobOf, lastResolvedRound, ofType } from "./read";

/** How much each kind of evidence moves a score. Shared by every personality; they differ in when they act on it. */
export interface SuspicionWeights {
  /** Per loot of unexplained shortfall, shared among the players who could have taken it. design §5.3 */
  readonly shortfall: number;
  /** An alibi that contradicts what I saw (a sighting, Security or Lookout). design §5.4 */
  readonly lie: number;
  /** I saw them where they said they were. */
  readonly verified: number;
  /** No alibi once the round's alibi window has closed ("posting none is suspicious in itself", §5.4). */
  readonly noAlibi: number;
  /** Score after a shakedown found them clean. design §11.3 */
  readonly afterClean: number;
  /** Score after a shakedown found loot: a known skimmer, but just emptied. design §11.3 */
  readonly afterDirty: number;
}

export const SUSPICION_WEIGHTS: SuspicionWeights = {
  shortfall: 1,
  lie: 5,
  verified: 0.5,
  noAlibi: 1.5,
  afterClean: -3,
  afterDirty: 1,
};

/** Suspicion of every other player, in seat order. Higher is more suspicious. */
export function suspicion(view: PlayerView, w: SuspicionWeights = SUSPICION_WEIGHTS): Map<PlayerId, number> {
  const job = jobOf(view);
  const me = view.me.id;
  const others = view.players.map((p) => p.id);
  const score = new Map<PlayerId, number>(others.map((id) => [id, 0]));
  const add = (id: PlayerId, n: number): void => {
    const s = score.get(id);
    if (s !== undefined) score.set(id, s + n);
  };
  const last = lastResolvedRound(view);
  const alibis = new Map<number, Map<PlayerId, RoomId>>();
  for (const a of ofType(view.ledger, "alibiPosted")) {
    if (!alibis.has(a.round)) alibis.set(a.round, new Map());
    alibis.get(a.round)?.set(a.player, a.room);
  }
  const loot = (room: RoomId): number => roomDef(job, room).loot;
  const maxLoot = Math.max(...view.rooms.map(loot));

  function judgeRound({ round, haulDelta }: RoundResolved): void {
    const split = ofType(view.caseFile, "lootSplit").find((e) => e.round === round);
    if (!split) return;
    // Others' alibis only: my own contribution I know exactly.
    const claims = new Map([...(alibis.get(round) ?? [])].filter(([id]) => id !== me));
    // Where others really were (or weren't), as far as I saw.
    const seenIn = new Map<PlayerId, RoomId>();
    const notIn = new Map<PlayerId, Set<RoomId>>();
    for (const s of ofType(view.caseFile, "roomSighting")) if (s.round === round) for (const o of s.others) seenIn.set(o, s.room);
    for (const watch of ofType(view.caseFile, "roomWatched")) {
      if (watch.round !== round) continue;
      for (const o of others) {
        if (watch.seen.includes(o)) {
          seenIn.set(o, watch.room);
          continue;
        }
        let rooms = notIn.get(o);
        if (!rooms) notIn.set(o, (rooms = new Set()));
        rooms.add(watch.room);
      }
    }
    // The latest round's alibi window is still open: silence there isn't evidence yet.
    const windowClosed = round < last;

    // design §5.4: alibis against what I saw.
    for (const id of others) {
      const claim = claims.get(id);
      if (claim === undefined) {
        if (windowClosed) add(id, w.noAlibi);
        continue;
      }
      const at = seenIn.get(id);
      if ((at !== undefined && at !== claim) || notIn.get(id)?.has(claim)) add(id, w.lie);
      else if (at === claim) add(id, -w.verified);
    }

    // design §5.3: what the claimed rooms should have paid vs what the others really handed in.
    const crowd = new Map<RoomId, number>([[split.room, 1]]);
    for (const room of claims.values()) crowd.set(room, (crowd.get(room) ?? 0) + 1);
    let expected = 0;
    for (const room of claims.values()) expected += roomLoot(roomDef(job, room), crowd.get(room) ?? 1);
    let unexplained = expected - (haulDelta - split.toHaul);
    // design §6.2: the Server room says how many pocketed; if nobody else did, the gap is someone's honest mistake.
    const count = ofType(view.caseFile, "pocketCount").find((e) => e.round === round);
    if (count && count.pocketed - (split.toStash > 0 ? 1 : 0) === 0) unexplained = 0;
    if (unexplained <= 0) return;

    // Shared by how much each could have taken: their claimed room's loot (+1, since a claim can be a lie).
    // Someone I saw in the 0-loot room they claimed is in the clear; the silent could have been anywhere.
    const weights = new Map<PlayerId, number>();
    for (const id of others) {
      const claim = claims.get(id);
      if (claim === undefined) {
        if (windowClosed) weights.set(id, maxLoot + 1);
      } else if (!(seenIn.get(id) === claim && loot(claim) === 0)) {
        weights.set(id, loot(claim) + 1);
      }
    }
    const total = [...weights.values()].reduce((a, b) => a + b, 0);
    for (const [id, weight] of weights) add(id, (w.shortfall * unexplained * weight) / total);
  }

  // In ledger order, so a shakedown resets what came before it. design §11.3
  for (const { event } of view.ledger) {
    if (event.type === "roundResolved") judgeRound(event);
    else if (event.type === "shakedownResolved" && event.target !== me) {
      score.set(event.target, event.clean ? w.afterClean : w.afterDirty);
    }
  }
  return score;
}

/** The most suspicious other player and their score (first in seat order on a tie), or null with nobody else. */
export function mostSuspicious(scores: ReadonlyMap<PlayerId, number>): { readonly player: PlayerId; readonly score: number } | null {
  let best: { player: PlayerId; score: number } | null = null;
  for (const [player, score] of scores) if (!best || score > best.score) best = { player, score };
  return best;
}
