// One plain line for every engine event: the ledger, the case file and (later)
// the reveal timeline and chat toasts read through this. Pure; the switches are
// exhaustive, so a new event, ability, perk or meeting-result kind fails
// typecheck until it has a line here. docs/m2-plan.md M2-6; design §13
import { EVENTS, JOBS, PERKS, ROLES, type PerkId } from "@skimjob/content";
import type { GameEvent, MeetingResult, PlayerId, ResolvedAbility, ResolvedPerk, RoomId, VoteChoice } from "@skimjob/engine";

export interface DescribeContext {
  /** The viewer: their own events read "you". */
  readonly me: PlayerId;
  /** A player's display name (falls back to the id). */
  readonly name: (player: PlayerId) => string;
  /** A meeting slot for people (the engine's slots are opaque labels, often ISO times). Default: as is. */
  readonly slot?: (slot: string) => string;
}

const ALL_ROOMS = Object.fromEntries(Object.values(JOBS).flatMap((j) => Object.values(j.rooms).map((r) => [r.id, r.name])));

/** A room's display name, e.g. "Deposit boxes". */
export const roomName = (room: RoomId): string => ALL_ROOMS[room] ?? room;
/** A role's display name, e.g. "Inside Man". */
export const roleName = (role: string): string => ROLES[role]?.name ?? role;
/** An event card's display name, e.g. "Police patrol". */
export const cardName = (card: string): string => EVENTS[card]?.name ?? card;
export const perkName = (perk: PerkId): string => PERKS[perk]?.name ?? perk;

const list = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const signed = (n: number) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "to shake down Dez" / "to shake you down". */
const shakeDown = (target: PlayerId, who: (p: PlayerId) => string) => (who(target) === "you" ? "to shake you down" : `to shake down ${who(target)}`);

export function describeEvent(event: GameEvent, ctx: DescribeContext): string {
  return cap(line(event, ctx));
}

function line(e: GameEvent, ctx: DescribeContext): string {
  const you = (p: PlayerId) => p === ctx.me;
  /** "you" or the player's name, as a sentence subject or object. */
  const who = (p: PlayerId) => (you(p) ? "you" : ctx.name(p));
  const whose = (p: PlayerId) => (you(p) ? "your" : `${ctx.name(p)}'s`);
  /** Picks the verb form for the subject: "you claim" / "Dez claims". */
  const verb = (p: PlayerId, second: string, third: string) => `${who(p)} ${you(p) ? second : third}`;
  const names = (ps: readonly PlayerId[]) => list(ps.map(who));
  const slot = (s: string) => (ctx.slot ? ctx.slot(s) : s);
  const choice = (v: VoteChoice) => (v.kind === "skip" ? "to skip" : shakeDown(v.target, who));

  switch (e.type) {
    case "gameCreated":
      return `${e.players.length} players set out to rob ${JOBS[e.job]?.name ?? e.job}${e.duel ? " (Duel)" : ""}.`;
    case "rngSeeded":
      return `The deck was shuffled with seed ${e.seed}.`;
    case "roomsSet":
      return `Rooms in play: ${list(e.rooms.map(roomName))}.`;
    case "roleDealt":
      return you(e.player) ? `You were dealt the ${roleName(e.role)}.` : `${ctx.name(e.player)} was the ${roleName(e.role)}.`;
    case "snitchTargetAssigned":
      return `${whose(e.player)} Snitch target is ${who(e.target)}.`;
    case "alliesLearned": {
      // v2 §2: only what the event says (who, and how); never a role name. The learner sees it, or anyone in the reveal.
      const are = e.allies.length > 1 ? "are" : "is";
      if (e.via === "deal") return `${verb(e.player, "were", "was")} told at the deal that ${names(e.allies)} ${are} on the dark side.`;
      if (e.via === "fence") return `${whose(e.player)} full safe paid off: ${names(e.allies)} ${are} on the dark side.`;
      if (e.via === "tipOff") return `${whose(e.player)} tip-off named a dark-side ally: ${names(e.allies)}.`;
      return `The Heat ran high: ${who(e.player)} and ${names(e.allies)} now know ${you(e.player) ? "you're" : "they're"} on the same side.`;
    }
    case "moleAllies":
      // After a Double-cross the list can hold learned accomplices too (v2 §2), so "allies", not "fellow Moles".
      return `${whose(e.player)} dark-side all${e.allies.length > 1 ? "ies" : "y"}: ${names(e.allies)}.`;
    case "rngAdvanced":
      return "The dice rolled.";
    case "roundStarted":
      return `Round ${e.round} begins (Act ${e.act}).`;
    case "moveSubmitted":
      return `${verb(e.player, "picked", "picked")} the ${roomName(e.move.room)} for round ${e.round}${e.move.pocket > 0 ? `, pocketing up to ${e.move.pocket}` : ", handing everything in"}${e.move.watch ? `, watching the ${roomName(e.move.watch)}` : ""}.`;
    case "defaultMoveAssigned":
      return `${verb(e.player, "missed", "missed")} round ${e.round}'s deadline: the default move went to the ${roomName(e.move.room)}, handing everything in.`;
    case "lootSplit":
      return `Round ${e.round}, ${roomName(e.room)}: ${verb(e.player, "found", "found")} ${e.loot} loot, ${e.toHaul} to the Haul and ${e.toStash} pocketed.`;
    case "abilityResolved":
      return ability(e.ability, e.player, e.round, { you, who, whose, verb });
    case "blackmailed":
      return `Someone blackmailed ${who(e.player)} in round ${e.round} and took ${e.stolen} from the stash.`;
    case "roomSighting":
      return e.others.length === 0
        ? `Round ${e.round}: ${verb(e.player, "were", "was")} alone in the ${roomName(e.room)}.`
        : `Round ${e.round}: in the ${roomName(e.room)}, ${verb(e.player, "saw", "saw")} ${names(e.others)}.`;
    case "roomWatched": {
      const how = e.source === "security" ? "On the cameras" : e.source === "lookout" ? "On lookout" : "Tailing";
      return `Round ${e.round}, ${how.toLowerCase()}: ${e.seen.length === 0 ? "nobody" : names(e.seen)} in the ${roomName(e.room)}${you(e.player) ? "" : ` (seen by ${ctx.name(e.player)})`}.`;
    }
    case "pocketCount":
      return `Round ${e.round}, Server room: ${e.pocketed === 1 ? "1 player" : `${e.pocketed} players`} pocketed loot${you(e.player) ? "" : ` (seen by ${ctx.name(e.player)})`}.`;
    case "roundResolved":
      return `Round ${e.round}: Haul ${signed(e.haulDelta)} (now ${e.haul}), Heat ${signed(e.heatDelta)} (now ${e.heat}).`;
    case "copsRaided":
      return `The cops raided in round ${e.round} at Heat ${e.heat}. The job is blown.`;
    case "raidStopped":
      return `The cops were about to raid in round ${e.round}, but the raid was stopped: Heat is back to ${e.heat}.`;
    case "cardForeseen":
      return `${verb(e.player, "foresaw", "foresaw")} round ${e.round}'s card: ${cardName(e.card)}.`;
    case "eventFlipped":
      return `Round ${e.round} event: ${cardName(e.card)}${e.room ? ` (the ${roomName(e.room)} is closed)` : ""}.`;
    case "doubleCrossOffered":
      return `Double-cross: ${who(e.player)} and ${who(e.partner)} may swap roles in round ${e.round}.`;
    case "doubleCrossAnswered":
      return `${verb(e.player, e.accept ? "accepted" : "declined", e.accept ? "accepted" : "declined")} the double-cross in round ${e.round}.`;
    case "doubleCrossResolved":
      return e.swap
        ? `Double-cross done: ${who(e.player)} and ${who(e.partner)} swapped roles; ${verb(e.player, "are", "is")} now the ${roleName(e.swap.role)}.`
        : `No swap: the double-cross between ${who(e.player)} and ${who(e.partner)} fell through.`;
    case "raidRumourHit":
      return `Raid rumour: ${verb(e.player, "had", "had")} the biggest stash and lost ${e.lost}.`;
    case "insideTip":
      return `Inside tip${you(e.player) ? "" : ` for ${ctx.name(e.player)}`}: ${who(e.subject)} ${you(e.subject) ? "are" : "is"} the ${roleName(e.role)}.`;
    case "auditReport": {
      const short = Object.entries(e.shortfalls).filter(([, n]) => n > 0);
      return short.length === 0
        ? `Audit of round ${e.round}: nothing missing anywhere.`
        : `Audit of round ${e.round}: ${list(short.map(([room, n]) => `${roomName(room)} ${n} short`))}.`;
    }
    case "alibiPosted":
      return `${verb(e.player, "say", "says")} ${you(e.player) ? "you were" : "they were"} in the ${roomName(e.room)} in round ${e.round}.`;
    case "alibisClosed":
      return `Alibis for round ${e.round} are closed.`;
    case "roleClaimed":
      return `${verb(e.player, "claim", "claims")} to be the ${roleName(e.role)}.`;
    case "meetingProposed":
      return `${verb(e.by, "proposed", "proposed")} the Act ${e.act} meeting for ${slot(e.slot)}.`;
    case "meetingProposalAccepted":
      return `${verb(e.by, "backed", "backed")} a meeting time.`;
    case "meetingScheduled":
      return `The Act ${e.act} meeting is set for ${slot(e.slot)}${e.proposalId === null ? " (picked by the app)" : ""}.`;
    case "emergencyMeetingCalled":
      return `${verb(e.by, "called", "called")} an emergency meeting.`;
    case "meetingOpened":
      return `The ${e.kind === "emergency" ? "emergency meeting" : `Act ${e.act} meeting`} is open: time to vote.`;
    case "voteSealed":
      return `${verb(e.player, "sealed", "sealed")} a vote ${choice(e.vote)}.`;
    case "voteCast":
      return `${verb(e.player, "voted", "voted")} ${choice(e.vote)}${e.sealed ? " (sealed earlier)" : ""}.`;
    case "meetingClosed":
      return meetingResult(e.result, e.tally, who);
    case "shakedownPending":
      return `The shakedown of ${who(e.target)} passed; it lands when the window closes.`;
    case "shakedownCancelled":
      return `The shakedown of ${who(e.target)} was called off.`;
    case "shakedownResolved":
      return `${who(e.target)} ${you(e.target) ? "were" : "was"} shaken down: a stash of ${e.stashRevealed}, ${e.taken} into the Haul.${e.clean ? ` Clean! The crew paid ${e.compensation} in compensation.` : ""}`;
    case "blessingPaid":
      return `${who(e.target)} ${you(e.target) ? "were" : "was"} blessed: the bank paid the compensation, so ${e.amount} went back into the Haul.`;
    case "muscleNamed":
      return `${verb(e.player, "were", "was")} named as the ${roleName("muscle")}: ${you(e.player) ? "you" : "they"} called off the shakedown of ${who(e.target)}, who wasn't clean.`;
    case "snitchRewarded":
      return `Snitching paid: ${who(e.target)} wasn't clean, so ${whose(e.player)} ballot weighs +${e.votes} from now on.`;
    case "checkpointChecked":
      return `${e.act === 3 ? "Final target" : `Act ${e.act} checkpoint`}: Haul ${e.haul}, target ${e.target}, ${e.met ? "made it" : `missed${e.heatPenalty > 0 ? ` (Heat +${e.heatPenalty})` : ""}`}.`;
    case "perkGranted":
      return `${verb(e.player, "earned", "earned")} a ${perkName(e.perk)} perk: ${PERKS[e.perk]?.effect ?? ""}`.trim();
    case "perkUsed":
      return perk(e.perk, e.player, { you, who, whose, verb });
    case "rigPicked":
      return `${verb(e.player, "rigged", "rigged")} round ${e.round}'s card: ${cardName(e.card)}.`;
    case "alibiVerified":
      return `Verified: ${who(e.player)} really ${you(e.player) ? "were" : "was"} in the ${roomName(e.room)} in round ${e.round}.`;
    case "callOutMade":
      return `${verb(e.player, "called", "called")} out the other player for Act ${e.act}.`;
    case "callOutResolved":
      return e.caught
        ? `Call-out, Act ${e.act}: ${who(e.caller)} caught ${who(e.target)} skimming; ${e.amount} moves to ${who(e.caller)}.`
        : `Call-out, Act ${e.act}: ${who(e.caller)} got it wrong and ${you(e.caller) ? "pay" : "pays"} ${who(e.target)} ${e.amount}.`;
    case "gameEnded": {
      const o = e.outcome;
      const winners = o.winners.length === 0 ? "nobody wins" : `${names(o.winners)} ${o.winners.length === 1 && !you(o.winners[0]!) ? "wins" : "win"}`;
      return o.result === "success"
        ? `Job done! The crew got away with it: ${winners}.`
        : `Busted: the heist failed (${o.reason === "heat" ? "the Heat hit the top" : "the target was missed"}); ${winners}.`;
    }
    default: {
      const never: never = e;
      return String((never as { type: string }).type);
    }
  }
}

type Grammar = {
  readonly you: (p: PlayerId) => boolean;
  readonly who: (p: PlayerId) => string;
  readonly whose: (p: PlayerId) => string;
  readonly verb: (p: PlayerId, second: string, third: string) => string;
};

function ability(a: ResolvedAbility, player: PlayerId, round: number, { who, whose, verb }: Grammar): string {
  switch (a.kind) {
    case "lookout":
      return `Round ${round}: ${verb(player, "kept", "kept")} lookout on the ${list(a.rooms.map(roomName))}.`;
    case "fenceSafe":
      return `Round ${round}: ${verb(player, "moved", "moved")} ${a.amount} into the Fence safe.`;
    case "loopCameras":
      return `Round ${round}: ${verb(player, "looped", "looped")} the cameras on the ${roomName(a.room)}.`;
    case "blackmail":
      return a.correct
        ? `Round ${round}: ${verb(player, "blackmailed", "blackmailed")} ${who(a.target)} (the ${roleName(a.role)}) and took ${a.stolen}.`
        : `Round ${round}: ${verb(player, "guessed", "guessed")} ${who(a.target)} was the ${roleName(a.role)}, wrongly.`;
    case "cancelShakedown":
      return `${verb(player, "leaned", "leaned")} on the crew: the shakedown of ${who(a.target)} is off.`;
    case "tipOff":
      return `Round ${round}: ${verb(player, "tipped", "tipped")} off the cops (Heat +${a.heat}).`;
    case "audit":
      return `Audit: the ${roomName(a.room)} came up ${a.shortfall} short in round ${a.round}.`;
    case "checkStash":
      return `Stash check: ${who(a.target)} ${a.dirty ? `holds ${a.threshold} or more (not clean)` : `holds less than ${a.threshold} (clean)`}.`;
    case "bless":
      return `${verb(player, "blessed", "blessed")} ${who(a.target)} for Act ${a.act}.`;
    case "bagman":
      return `Round ${round}: ${verb(player, "handed", "handed")} everything in, so the bank added +${a.bonus} to the Haul.`;
    case "fixer":
      return `Round ${round}: ${verb(player, "stopped", "stopped")} the raid and lost ${a.lost} from ${whose(player)} stash.`;
    default: {
      const never: never = a;
      return String((never as { kind: string }).kind);
    }
  }
}

function perk(p: ResolvedPerk, player: PlayerId, { you, who, whose, verb }: Grammar): string {
  switch (p.kind) {
    case "peek":
      return `Peek: ${who(p.target)} ${you(p.target) ? "are" : "is"} the ${roleName(p.role)}.`;
    case "shield":
      return `A Shield saved ${who(player)}: the shakedown was cancelled.`;
    case "extraVote":
      return `${verb(player, "spent", "spent")} +Vote: the ballot weighs one more this meeting.`;
    case "ballot":
      return `${verb(player, "are", "is")} watching ${whose(p.target)} ballot this meeting.`;
    case "tail":
      return `${verb(player, "tailed", "tailed")} the ${roomName(p.room)} this round.`;
    case "alibi":
      return `${verb(player, "had", "had")} the round ${p.round} alibi (${roomName(p.room)}) stamped Verified.`;
    case "recharge":
      return `${verb(player, "recharged", "recharged")} ${whose(player)} role's power.`;
    case "rig":
      return `${verb(player, "rigged", "rigged")} round ${p.round}'s card: ${list(p.cards.map(cardName))} to pick from.`;
    case "emergency":
      return `${verb(player, "spent", "spent")} an ${perkName("emergency")} perk to call an extra emergency meeting.`;
    default: {
      const never: never = p;
      return String((never as { kind: string }).kind);
    }
  }
}

function meetingResult(r: MeetingResult, tally: { readonly skip: number; readonly targets: Readonly<Record<PlayerId, number>> }, who: (p: PlayerId) => string): string {
  const votes = (n: number) => (n === 1 ? "1 vote" : `${n} votes`);
  switch (r.kind) {
    case "shakedown":
      return `The crew voted ${shakeDown(r.target, who)} (${votes(tally.targets[r.target] ?? 0)}).`;
    case "skipped":
      return `The crew voted to skip (${votes(tally.skip)}).`;
    case "noMajority":
      return "No majority: nobody is shaken down.";
    case "noQuorum":
      return "Too few votes: nothing happens.";
    default: {
      const never: never = r;
      return String((never as { kind: string }).kind);
    }
  }
}
