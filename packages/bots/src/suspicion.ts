// The bots' suspicion model: a score for every other player, worked out from
// the view alone. design §19.3 (and §5.3 shortfalls, §5.4 alibis, §3.4 Security
//, §11.1 powers, §9.6 shakedown results)
//
// Rebuilt from the ledger and case file each time it's needed, so a bot keeps
// no hidden memory of its own: same view, same scores.
import type { RoleId, RoomId } from "@skimjob/content";
import { roomDef, type AbilityResolved, type PlayerId, type PlayerView, type RoundResolved } from "@skimjob/engine";
import { claimantsOf, claimsOf, copiesOf, jobOf, ofType, winsSunk } from "./read";

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
  /** Per coin my Audit found short of a room's claimants' grabs, shared among the others who claimed it (design §11.1). */
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
  /** My Peek or Inside tip says they hold a role that also wins a heist sunk by theft (the Mole, the Fixer, §8.4). */
  readonly knownDark: number;
}

export const SUSPICION_WEIGHTS: SuspicionWeights = {
  shortfall: 1,
  lie: 5,
  verified: 0.5,
  noAlibi: 1.5,
  afterClean: -3,
  afterDirty: 1,
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
  const coins = (room: RoomId): number => roomDef(job, room).coins;
  const maxCoins = Math.max(...view.rooms.map(coins));

  function judgeRound({ round, taken, missing }: RoundResolved): void {
    const split = ofType(view.caseFile, "coinsGrabbed").find((e) => e.round === round);
    if (!split) return;
    // Others' alibis only: my own contribution I know exactly.
    const claims = new Map([...(alibis.get(round) ?? [])].filter(([id]) => id !== me));
    // Where others really were (or weren't), as far as I saw.
    const seenIn = new Map<PlayerId, RoomId>();
    const notIn = new Map<PlayerId, Set<RoomId>>();
    for (const s of ofType(view.caseFile, "roomSighting")) if (s.round === round) for (const o of s.others) seenIn.set(o, s.room);
    for (const watch of ofType(view.caseFile, "roomWatched")) {
      // design §11.1: a blacked-out room's feed shows nobody, which tells nothing.
      if (watch.round !== round || watch.offline) continue;
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

    // What the claimed rooms could have paid (their coin limits) vs what the others really handed in.
    // design §5.3: a raided room's grabs were seized (public), so a claim there explains nothing missing.
    const raided = new Set(ofType(view.ledger, "roomRaided").filter((e) => e.round === round).map((e) => e.room));
    let expected = 0;
    for (const room of claims.values()) if (!raided.has(room)) expected += roomDef(job, room).coins;
    // Handed in this round (design §7.4), less my own hand-in.
    let unexplained = expected - (taken - missing - split.duffel);
    if (unexplained <= 0) return;

    // Shared by how much each could have taken: their claimed room's coins (+1, since a claim can be a lie).
    // Someone I saw in the 0-coin room they claimed is in the clear; the silent could have been anywhere.
    const weights = new Map<PlayerId, number>();
    for (const id of others) {
      const claim = claims.get(id);
      if (claim === undefined) {
        if (windowClosed) weights.set(id, maxCoins + 1);
      } else if (!(seenIn.get(id) === claim && coins(claim) === 0)) {
        weights.set(id, coins(claim) + 1);
      }
    }
    const total = [...weights.values()].reduce((a, b) => a + b, 0);
    for (const [id, weight] of weights) add(id, (w.shortfall * unexplained * weight) / total);
  }

  /** design §11.1: what my own Detective or Auditor power found against the alibis. */
  function judgePower(ability: AbilityResolved["ability"]): void {
    if (ability.kind === "detect") {
      // A grab bigger than the claimed room allows is a lie.
      const said = alibis.get(ability.round)?.get(ability.target);
      if (said !== undefined && ability.grabbed > coins(said)) add(ability.target, w.lie);
      return;
    }
    if (ability.kind !== "audit") return;
    const claimants = [...(alibis.get(ability.round) ?? [])].filter(([id, room]) => id !== me && room === ability.room).map(([id]) => id);
    // What the claimants' full grabs would have handed in, less what reached the duffel (my own hand-in there included).
    const mine = ofType(view.caseFile, "coinsGrabbed").find((e) => e.round === ability.round && e.room === ability.room)?.duffel ?? 0;
    const short = claimants.length * coins(ability.room) - (ability.duffel - mine);
    if (short > 0) for (const id of claimants) add(id, (w.audited * short) / claimants.length);
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

/** What I know of other players' roles: my latest Peek or Inside tip on each. */
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
  for (const [id, role] of known) if (id !== me && winsSunk(role)) add(id, w.knownDark);
  for (const [id, roles] of claimsOf(view)) {
    if (id === me) continue;
    const role = roles.at(-1) as RoleId;
    if (new Set(roles).size > 1) add(id, w.falseClaim / 2);
    const knownRole = known.get(id);
    if (knownRole !== undefined) add(id, knownRole === role ? w.claimed : w.falseClaim);
    else if (role === view.me.role && copiesOf(view, role) === 1) add(id, w.falseClaim);
    else if (claimantsOf(view, role).length > copiesOf(view, role)) add(id, w.doubleClaim);
    else add(id, w.claimed);
  }
}

/** The most suspicious other player and their score (first in seat order on a tie), or null with nobody else. */
export function mostSuspicious(scores: ReadonlyMap<PlayerId, number>): { readonly player: PlayerId; readonly score: number } | null {
  let best: { player: PlayerId; score: number } | null = null;
  for (const [player, score] of scores) if (!best || score > best.score) best = { player, score };
  return best;
}
