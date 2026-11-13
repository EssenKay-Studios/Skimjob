// The case board's ⚠ "doesn't add up" checks (design §15.4): pure functions over
// what one player's own view shows, gathered per round by caseLeads.ts. A check
// is a warning, never a verdict: a sighting can be planted (Plant evidence), and
// claims can be lies. Coins per room are not public, so the bell checks reason
// from the rings and who was there.
//
// Not used on purpose: the Rooftop's cooling of the hottest room can hint at a
// hidden bell through the other rooms' public cooling. That hint is inherent to
// the rule (#173), and no check reads it: a hidden bell gets no bell check.
import { MAX_ROLE_COPIES, ROLES, type JobDef, type RoleId, type RoomId } from "@skimjob/content";
import { ringsOf, roundJob, type EventTable, type PlayerId } from "@skimjob/engine";
import type { Warning } from "./caseBoard";
import { roleName, roomName, the } from "./describeEvent";

/** One room in one round, as your view shows it. */
export interface RoomRound {
  /** Rings this round; null when unknown (a hidden bell, or a bell whose start you never saw). */
  readonly rings: number | null;
  /** The room was raided: its bell capped, so it rang at least `rings`. */
  readonly raided: boolean;
  /** Blacked out this round (a public power cut): nobody is seen there. */
  readonly dark: boolean;
  /** You were there, or a feed of yours showed it with the cameras on. */
  readonly watched: boolean;
  /** Who you saw there: "room" when you were there with them (never planted), "feed" when only a feed showed them. */
  readonly seen: ReadonlyMap<PlayerId, "room" | "feed">;
  /** You grabbed here: how many coins. */
  readonly myCoins: number | null;
}

/** One resolved round of your view. */
export interface RoundFacts {
  readonly round: number;
  /** The event card that changed the round's numbers (Shift change), or null. */
  readonly card: { readonly round: number; readonly id: string; readonly room: RoomId | null } | null;
  readonly rooms: ReadonlyMap<RoomId, RoomRound>;
  readonly alibis: ReadonlyMap<PlayerId, RoomId>;
  /** design §10: who posted no alibi, in the room they really were in (a public fact as the alibi window closed). */
  readonly noAlibi: ReadonlyMap<PlayerId, RoomId>;
  /** Soft shoes bought the round before by someone else (sold less yours): that many players may ring nothing. */
  readonly softShoes: number;
  /** Plant evidence bought this round by someone else: that many feed sightings may be planted. */
  readonly planted: number;
  /** You wore Soft shoes this round. */
  readonly mySoftShoes: boolean;
  /** The bank ran dry this round, so a grab may have been cut to 0 (design §3.2). */
  readonly bankEmptied: boolean;
}

export interface CheckContext {
  readonly me: PlayerId;
  readonly myRole: RoleId;
  readonly job: JobDef;
  readonly events: EventTable;
  /** The public role list; null when Hidden. */
  readonly roleList: { readonly list: "exact" | "possible"; readonly roles: readonly RoleId[] } | null;
  readonly crewSize: number;
}

/** A warning and the lead it belongs on: a room in a round, or the crew in a round. */
export interface Found {
  readonly round: number;
  readonly room: RoomId | null;
  readonly warning: Warning;
}

const list = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const times = (n: number) => (n === 1 ? "once" : `${n} times`);

/** Whether you or your feeds saw `p` in any room this round. */
const seenAnywhere = (r: RoundFacts, p: PlayerId): boolean => [...r.rooms.values()].some((rr) => rr.seen.has(p));

/** design §15.4 Seen elsewhere and Not seen, for one round: what you saw against the alibis. */
export function storyChecks(r: RoundFacts, me: PlayerId, name: (p: PlayerId) => string): Found[] {
  const found: Found[] = [];
  const R = `R${r.round}`;
  for (const [room, rr] of r.rooms) {
    // Seen elsewhere: you or your power saw them here, their alibi says another room.
    for (const [p, how] of rr.seen) {
      const alibi = r.alibis.get(p);
      if (p === me || alibi === undefined || alibi === room) continue;
      const planted = how === "feed" && r.planted > 0 ? " A sighting can be planted." : "";
      found.push({ round: r.round, room, warning: { kind: "seenElsewhere", names: [p], text: `Said ${roomName(alibi)} in ${R}; you saw ${name(p)} in ${the(room)}.${planted}` } });
    }
  }
  for (const [p, alibi] of r.alibis) {
    if (p === me) continue;
    // Not seen: their alibi is a room you watched, and you didn't see them there. Skipped in a blacked-out room.
    const rr = r.rooms.get(alibi);
    if (rr && rr.watched && !rr.dark && !rr.seen.has(p))
      found.push({ round: r.round, room: alibi, warning: { kind: "notSeen", names: [p], text: `Said ${roomName(alibi)} in ${R}; you watched ${the(alibi)} and didn't see ${name(p)}.` } });
  }
  return found;
}

/** The most the Locksmith's muffle takes off each coin, if `role` muffles. */
const muffleOf = (role: RoleId): number => {
  const power = ROLES[role]?.power;
  return power?.kind === "muffle" ? power.fewerRings : 0;
};

/** The deal's limit on copies of `role` by what the role list shows (design §11.3): the Exact count, else what the deal allows. */
function dealtAtMost(ctx: CheckContext, role: RoleId): number {
  const list = ctx.roleList;
  if (list?.list === "exact") return list.roles.filter((r) => r === role).length;
  if (list && !list.roles.includes(role)) return 0;
  return ctx.crewSize > Object.keys(ROLES).length ? MAX_ROLE_COPIES : 1;
}

/** Could another player hold a Locksmith-like role (per the role list, less your own copy)? */
function otherMuffle(ctx: CheckContext): number {
  let most = 0;
  for (const role of Object.keys(ROLES)) {
    const left = dealtAtMost(ctx, role) - (role === ctx.myRole ? 1 : 0);
    if (left > 0) most = Math.max(most, muffleOf(role));
  }
  return most;
}

/** Sum of `xs` after zeroing the `k` biggest. */
const sumWithoutTop = (xs: readonly number[], k: number): { sum: number; rest: number[] } => {
  const sorted = [...xs].sort((a, b) => b - a);
  const rest = sorted.slice(Math.max(0, k));
  return { sum: rest.reduce((a, b) => a + b, 0), rest };
};

/**
 * design §15.4 Too quiet and Too loud, for one round. Counted in a room: the
 * players seen there, whose alibi is that room or who had no alibi there (a
 * fact), and you if you grabbed there.
 * No bell check runs on a hidden bell (or any bell whose rings you can't know).
 */
export function bellChecks(r: RoundFacts, ctx: CheckContext, name: (p: PlayerId) => string): Found[] {
  const found: Found[] = [];
  const job = roundJob(ctx.job, r.card, ctx.events);
  const muffle = otherMuffle(ctx);
  const R = `R${r.round}`;
  for (const [room, rr] of r.rooms) {
    if (rr.rings === null || !Object.hasOwn(job.rooms, room)) continue;
    const def = job.rooms[room]!;
    // A "no alibi" fact puts a player in its room for sure (a sighting elsewhere was planted).
    const counted = new Set<PlayerId>([...rr.seen.keys()].filter((p) => (r.noAlibi.get(p) ?? room) === room));
    for (const [p, at] of r.noAlibi) if (at === room) counted.add(p);
    // A player seen anywhere this round counts only where they were seen; otherwise where their alibi puts them.
    for (const [p, at] of r.alibis) if (at === room && !seenAnywhere(r, p)) counted.add(p);
    counted.delete(ctx.me);
    const others = [...counted];
    const mine = rr.myCoins === null ? 0 : r.mySoftShoes ? 0 : ringsOf(def, rr.myCoins, muffleOf(ctx.myRole));
    const here = rr.myCoins !== null;
    if (others.length === 0 && !rr.watched) continue;

    // Too quiet: the least they can ring, in the best case for each of them.
    if (!rr.raided && others.length > 0) {
      const least = ringsOf(def, r.bankEmptied ? 0 : Math.min(1, def.coins), muffle);
      // Plant evidence: that many feed-only sightings (with no alibi or fact on the room) may not be there at all.
      const feedOnly = others.filter((p) => rr.seen.get(p) === "feed" && r.alibis.get(p) !== room && r.noAlibi.get(p) !== room);
      const fixed = others.filter((p) => !feedOnly.includes(p));
      const afterPlant = sumWithoutTop(feedOnly.map(() => least), r.planted);
      // Soft shoes: that many of them may ring nothing.
      const min = mine + sumWithoutTop([...fixed.map(() => least), ...afterPlant.rest], r.softShoes).sum;
      if (rr.rings < min)
        found.push({
          round: r.round,
          room,
          warning: { kind: "tooQuiet", names: others, text: `${cap(the(room))} rang ${times(rr.rings)} in ${R}; ${list(others.map(name))} there should ring at least ${min}${here ? " with you" : ""}.` },
        });
    }
    // Too loud: more than everyone counted could ring at the most (an unseen visitor, or a Mole's ring).
    const most = mine + others.length * ringsOf(def, def.coins);
    if (rr.rings > most)
      found.push({
        round: r.round,
        room,
        warning: { kind: "tooLoud", names: [], text: `${cap(the(room))} rang ${rr.raided ? "at least " : ""}${times(rr.rings)} in ${R}; who was there can ring at most ${most}.` },
      });
  }
  return found;
}

/** design §15.4 Over-claimed role: more players claim a role than were dealt it. `claims`: each other player's latest role claim, with its round. */
export function overClaimed(claims: ReadonlyMap<PlayerId, { readonly role: RoleId; readonly round: number }>, ctx: CheckContext, name: (p: PlayerId) => string): Found[] {
  const byRole = new Map<RoleId, PlayerId[]>();
  for (const [p, c] of claims) if (p !== ctx.me) byRole.set(c.role, [...(byRole.get(c.role) ?? []), p]);
  const found: Found[] = [];
  for (const [role, who] of byRole) {
    const dealt = dealtAtMost(ctx, role);
    const yours = role === ctx.myRole ? 1 : 0;
    if (who.length <= dealt - yours) continue;
    const round = Math.max(...who.map((p) => claims.get(p)!.round));
    const limit =
      dealt === 0 ? "it isn't in play" : ctx.roleList?.list === "exact" ? `${dealt} ${dealt === 1 ? "was" : "were"} dealt` : `at most ${dealt} can be`;
    found.push({
      round,
      room: null,
      warning: { kind: "overClaimed", names: who, text: `${list(who.map(name))} claim${who.length === 1 ? "s" : ""} the ${roleName(role)}; ${limit}${yours ? ", and you are one" : ""}.` },
    });
  }
  return found;
}
