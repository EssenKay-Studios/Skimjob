// Role claims and bluffs for bots (docs/roles-v2.md §4 "Claim"; design §8, §12.1).
//
// A claim is the public `claimRole` command (a `roleClaimed` on the ledger),
// once between meetings (design §11.3). Bots don't read chat, so claims are structured engine data
// and the same in the simulator and on the server.
//
// Default policy (extension.md Build notes "Bots"): ★ holders and the roles
// that leave evidence (the Hacker) bluff a low-risk role (the Rookie) nobody
// else has claimed when accused; the rest claim truthfully
// with chance 1 − their "lie". Each role's own line in the v2 §4 table adjusts
// when it claims (`CLAIM_STYLE`). These are bot settings, not game rules.
import type { RoleId } from "@skimjob/content";
import { roomDef, type PlayerCommand, type PlayerId, type PlayerView } from "@skimjob/engine";
import type { Personality } from "./personalities";
import type { Random } from "./bot";
import { claimantsOf, claimsOf, couldBeDealt, isStar, jobOf, ofType, roleOf, uniqueRole } from "./read";
import { suspicion } from "./suspicion";

/**
 * How a crew role claims (v2 §4 "Claim" column):
 * - accused: the default, when accused, with chance 1 − lie;
 * - free: also without being accused (a low-risk claim);
 * - evidence: also when it holds evidence it is about to vote on (its sightings, audit, check);
 * - rarely: when accused, at `RARELY` of the usual chance;
 * - afterSave: also after its power saved the crew (Fixer: a reopened room);
 * - afterVote: only once its own vote is in (Priest: never before a vote).
 */
export type ClaimStyle = "accused" | "free" | "evidence" | "rarely" | "afterSave" | "afterVote";

const CLAIM_STYLE: Readonly<Record<RoleId, ClaimStyle>> = {
  rookie: "free",
  lookout: "evidence",
  auditor: "evidence",
  detective: "evidence",
  smoothTalker: "rarely",
  priest: "afterVote",
  fixer: "afterSave",
};

/** Share of the usual claim chance for the "rarely" roles (bot setting). */
const RARELY = 0.25;

/** The low-risk roles a bluffing bot claims, in order. extension.md Build notes "Bots" */
export const SAFE_BLUFFS: readonly RoleId[] = ["rookie"];

/** Roles whose power leaves evidence, so they bluff too. extension.md Build notes "Bots" */
const EVIDENCE_ROLES: readonly RoleId[] = ["hacker"];

/** Whether this role bluffs when accused: a ★ role or one that leaves evidence. */
export const bluffs = (role: RoleId): boolean => isStar(role) || EVIDENCE_ROLES.includes(role);

/** Chance a bluffing bot bluffs once accused (bot setting). */
const BLUFF_WHEN_ACCUSED = 0.8;

/**
 * A bot counts as accused once its public suspicion (what anyone could work
 * out from the ledger, `publicSuspicion`) is at least this and the most of anyone's (bot setting).
 */
const ACCUSED_AT = 1.5;

/** Is a meeting about to happen or open: the time to claim. design §11.1 */
export function meetingTime(view: PlayerView): boolean {
  const k = view.phase.kind;
  return k === "meeting" || k === "awaitingMeeting" || k === "shakedownPending" || view.pendingEmergency !== null;
}

/**
 * Suspicion of every player, me included, from public data only: the ledger's
 * alibis and round summaries (each round's shortfall against the claimed
 * rooms, shared by how much each claimant could have taken), missing alibis,
 * shakedown results and double role claims. What the crew can see of me.
 */
export function publicSuspicion(view: PlayerView): Map<PlayerId, number> {
  const job = jobOf(view);
  const ids = [view.me.id, ...view.players.map((o) => o.id)];
  const score = new Map<PlayerId, number>(ids.map((id) => [id, 0]));
  const add = (id: PlayerId, n: number) => score.has(id) && score.set(id, (score.get(id) ?? 0) + n);
  const maxCoins = Math.max(...view.rooms.map((r) => roomDef(job, r).coins));
  for (const { event: e } of view.ledger) {
    if (e.type === "shakedownResolved") score.set(e.target, e.clean ? -3 : 1);
    if (e.type !== "roundResolved" || e.round === view.alibiRound) continue;
    const claims = new Map(ofType(view.ledger, "alibiPosted").filter((a) => a.round === e.round).map((a) => [a.player, a.room]));
    let expected = 0;
    for (const room of claims.values()) expected += roomDef(job, room).coins;
    const short = expected - (e.taken - e.missing);
    const weights = ids.map((id) => [id, claims.has(id) ? roomDef(job, claims.get(id) as string).coins + 1 : maxCoins + 1] as const);
    const total = weights.reduce((s, [, w]) => s + w, 0);
    for (const [id, w] of weights) {
      if (!claims.has(id)) add(id, 1.5);
      if (short > 0) add(id, (short * w) / total);
    }
  }
  for (const [role, who] of doubleClaims(view)) if (role) for (const id of who) add(id, 2);
  return score;
}

/** Unique roles claimed by more than one player, and who claimed them. */
function doubleClaims(view: PlayerView): Map<RoleId, PlayerId[]> {
  const out = new Map<RoleId, PlayerId[]>();
  for (const role of new Set(ofType(view.ledger, "roleClaimed").map((c) => c.role))) {
    const who = claimantsOf(view, role);
    if (uniqueRole(role) && who.length > 1) out.set(role, who);
  }
  return out;
}

/**
 * Is the bot accused (v2 §4: "when accused at a meeting")? A shakedown of it is
 * pending, a visible ballot in the open meeting names it, someone else claimed its
 * role, or it is the crew's top public suspect.
 */
export function accused(view: PlayerView): "shakedown" | "suspected" | null {
  const me = view.me.id;
  const phase = view.phase;
  if (phase.kind === "shakedownPending" && phase.target === me) return "shakedown";
  if (phase.kind === "meeting") {
    const ballots = ofType(view.ledger, "voteCast").filter((v) => v.meetingId === phase.meetingId && v.vote.kind === "shakedown" && v.vote.target === me);
    if (ballots.length > 0) return "shakedown";
  }
  if (claimantsOf(view, view.me.role).some((id) => id !== me) && uniqueRole(view.me.role)) return "suspected";
  const pub = publicSuspicion(view);
  const mine = pub.get(me) ?? 0;
  return mine >= ACCUSED_AT && [...pub.values()].every((s) => s <= mine) ? "suspected" : null;
}

/** The bluff a bluffing bot would claim now: its earlier claim, else a low-risk role that could be dealt and nobody else claimed. */
export function bluffFor(view: PlayerView): RoleId | null {
  const mine = claimsOf(view).get(view.me.id)?.at(-1);
  if (mine !== undefined) return mine;
  const taken = new Set(ofType(view.ledger, "roleClaimed").filter((c) => c.player !== view.me.id).map((c) => c.role));
  return SAFE_BLUFFS.find((r) => r !== view.me.role && !taken.has(r) && couldBeDealt(view, r)) ?? null;
}

/** v2 §4 "evidence": the bot holds its own evidence against the player it is about to vote for. */
function holdsEvidence(view: PlayerView): boolean {
  const scores = suspicion(view);
  const top = [...scores].sort((a, b) => b[1] - a[1])[0];
  if (!top || top[1] <= 0) return false;
  const [target] = top;
  const { power } = roleOf(view);
  const abilities = ofType(view.caseFile, "abilityResolved").map((e) => e.ability);
  if (power.kind === "checkStash") return abilities.some((a) => a.kind === "checkStash" && a.dirty && a.target === target);
  if (power.kind === "audit") return abilities.some((a) => a.kind === "audit" && a.shortfall > 0);
  if (power.kind === "lookout") {
    // A sighting that contradicts the target's alibi.
    const alibis = ofType(view.ledger, "alibiPosted").filter((a) => a.player === target);
    return ofType(view.caseFile, "roomWatched").some((w) => {
      const said = alibis.find((a) => a.round === w.round)?.room;
      return said !== undefined && (w.seen.includes(target) ? said !== w.room : said === w.room);
    });
  }
  return false;
}

/** v2 §4 "afterSave": the Fixer reopened a taped-off room (design §11.1). */
function saved(view: PlayerView): boolean {
  return roleOf(view).power.kind === "reopen" && ofType(view.caseFile, "abilityResolved").some((e) => e.ability.kind === "reopen");
}

/**
 * The role to claim now, or null. Only around meetings (v2 §4: "when accused
 * at a meeting"), once between meetings. Most bots tell the truth;
 * ★ and evidence-leaving roles bluff (`bluffFor`).
 */
export function chooseClaim(view: PlayerView, p: Personality, random: Random, voted = view.me.vote !== null): RoleId | null {
  if (!meetingTime(view)) return null;
  if (ofType(view.ledger, "roleClaimed").some((c) => c.player === view.me.id && c.stretch === view.stretch)) return null;
  const blame = accused(view);
  if (bluffs(view.me.role)) {
    if (blame === null || random() >= BLUFF_WHEN_ACCUSED) return null;
    return bluffFor(view);
  }
  const role = view.me.role;
  const truth = 1 - p.lie;
  const chance = (() => {
    switch (CLAIM_STYLE[role] ?? "accused") {
      case "free":
        return truth;
      case "evidence":
        return holdsEvidence(view) && view.phase.kind === "meeting" ? 1 : blame ? truth : 0;
      case "rarely":
        return blame ? truth * RARELY : 0;
      case "afterSave":
        return saved(view) ? 1 : blame ? truth : 0;
      case "afterVote":
        return view.phase.kind === "meeting" && voted && blame ? truth : 0;
      case "accused":
        return blame ? truth : 0;
    }
  })();
  return chance > 0 && random() < chance ? role : null;
}

/** The claim command, if the bot claims now. */
export function claimCommands(view: PlayerView, p: Personality, random: Random, voted = view.me.vote !== null): PlayerCommand[] {
  const role = chooseClaim(view, p, random, voted);
  return role === null ? [] : [{ type: "claimRole", player: view.me.id, role }];
}
