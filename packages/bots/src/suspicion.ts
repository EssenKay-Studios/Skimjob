// The bots' suspicion model: a score for every other player, worked out from
// the view alone. design §17.3 (and §5.3 shortfalls, §5.4 alibis, §6 Security
// and Server room, §8 Lookout, §11.3 shakedown results)
//
// Rebuilt from the ledger and case file each time it's needed, so a bot keeps
// no hidden memory of its own: same view, same scores.
import { ROLES, type RoleId, type RoomId } from "@skimjob/content";
import { roomDef, roomLoot, type AbilityResolved, type PlayerId, type PlayerView, type RoundResolved } from "@skimjob/engine";
import { claimantsOf, claimsOf, jobOf, ofType, uniqueRole } from "./read";

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
  /** My Detective check said their stash is at or above the clean threshold (v2 §2). */
  readonly checkedDirty: number;
  /** Per loot my Audit found missing from a room, shared among the others who claimed it (v2 §2). */
  readonly audited: number;
  /**
   * A role claim I know is false (v2 §4): it names my own role, contradicts my
   * Peek or Inside tip, or claims a role that can't pocket after loot was found
   * on them. Half as much for changing one's claimed role.
   */
  readonly falseClaim: number;
  /** A unique role claimed by two players: one of them lies (v2 §4), so both. */
  readonly doubleClaim: number;
  /** A claim I can't check, standing alone: a little trust. */
  readonly claimed: number;
  /** My Peek or Inside tip says they hold a Wildcard or Lone wolf role. */
  readonly knownDark: number;
}

export const SUSPICION_WEIGHTS: SuspicionWeights = {
  shortfall: 1,
  lie: 5,
  verified: 0.5,
  noAlibi: 1.5,
  afterClean: -3,
  afterDirty: 1,
  checkedDirty: 3,
  audited: 1,
  falseClaim: 6,
  doubleClaim: 2,
  claimed: -0.5,
  knownDark: 8,
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
    const windowClosed = view.alibiRound !== round; // design §5.4

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
    // My own hand-in.
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

  /** v2 §2: what my own Auditor / Detective power found. */
  function judgePower(ability: AbilityResolved["ability"]): void {
    if (ability.kind === "checkStash" && ability.dirty) add(ability.target, w.checkedDirty);
    if (ability.kind !== "audit" || ability.shortfall === 0) return;
    const claimants = [...(alibis.get(ability.round) ?? [])].filter(([id, room]) => id !== me && room === ability.room).map(([id]) => id);
    for (const id of claimants) add(id, (w.audited * ability.shortfall) / claimants.length);
  }

  // In log order (seq), so a shakedown resets what came before it. design §11.3
  const powers = view.caseFile.filter((e) => e.event.type === "abilityResolved");
  const events = powers.length === 0 ? view.ledger : [...view.ledger, ...powers].sort((a, b) => a.seq - b.seq);
  for (const { event } of events) {
    if (event.type === "roundResolved") judgeRound(event);
    else if (event.type === "abilityResolved") judgePower(event.ability);
    else if (event.type === "shakedownResolved" && event.target !== me) score.set(event.target, event.clean ? w.afterClean : w.afterDirty);
  }
  judgeClaims(view, add, w);
  return score;
}

/** What I know of other players' roles: my latest Peek or Inside tip on each (it can be stale after a Double-cross). */
export function knownRoles(view: PlayerView): Map<PlayerId, RoleId> {
  const known = new Map<PlayerId, RoleId>();
  for (const { event: e } of view.caseFile) {
    if (e.type === "insideTip") known.set(e.subject, e.role);
    if (e.type === "perkUsed" && e.perk.kind === "peek") known.set(e.perk.target, e.perk.role);
  }
  return known;
}

/** v2 §4: role claims against what I know, double claims, and roles I've learned. */
function judgeClaims(view: PlayerView, add: (id: PlayerId, n: number) => void, w: SuspicionWeights): void {
  const me = view.me.id;
  const known = knownRoles(view);
  for (const [id, role] of known) if (id !== me && ROLES[role] && ROLES[role].tag !== "teamPlayer") add(id, w.knownDark);
  for (const [id, roles] of claimsOf(view)) {
    if (id === me) continue;
    const role = roles.at(-1) as RoleId;
    if (new Set(roles).size > 1) add(id, w.falseClaim / 2);
    const knownRole = known.get(id);
    if (knownRole !== undefined) add(id, knownRole === role ? w.claimed : w.falseClaim);
    else if (uniqueRole(role) && role === view.me.role) add(id, w.falseClaim);
    else if (uniqueRole(role) && claimantsOf(view, role).length > 1) add(id, w.doubleClaim);
    else add(id, w.claimed);
  }
}

/** The most suspicious other player and their score (first in seat order on a tie), or null with nobody else. */
export function mostSuspicious(scores: ReadonlyMap<PlayerId, number>): { readonly player: PlayerId; readonly score: number } | null {
  let best: { player: PlayerId; score: number } | null = null;
  for (const [player, score] of scores) if (!best || score > best.score) best = { player, score };
  return best;
}
