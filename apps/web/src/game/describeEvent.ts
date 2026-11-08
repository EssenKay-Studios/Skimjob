// One plain line for every engine event: the ledger, the case file and (later)
// the reveal timeline and chat toasts read through this. Pure; the switches are
// exhaustive, so a new event, ability, perk or meeting-result kind fails
// typecheck until it has a line here. docs/m2-plan.md M2-6; design §13
import { EVENTS, JOBS, PERKS, ROLES, type PerkId } from "@skimjob/content";
import { MEETING_TITLE } from "./meeting";
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
/** A role's display name, e.g. "Smooth Talker". */
export const roleName = (role: string): string => ROLES[role]?.name ?? role;
/** An event card's display name, e.g. "Shift change". */
export const cardName = (card: string): string => EVENTS[card]?.name ?? card;
export const perkName = (perk: PerkId): string => PERKS[perk]?.name ?? perk;

const list = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "Vault 3 bulbs and Office 1 bulb": the lit bells, or "all dark". design §5.1 */
const bells = (lit: Readonly<Record<RoomId, number>>) => {
  const on = Object.entries(lit).filter(([, n]) => n > 0);
  return on.length === 0 ? "all dark" : list(on.map(([room, n]) => `${roomName(room)} ${n} bulb${n === 1 ? "" : "s"}`));
};
/** "to shake down Dez" / "to shake you down". */
const shakeDown = (target: PlayerId, who: (p: PlayerId) => string) => (who(target) === "you" ? "to shake you down" : `to shake down ${who(target)}`);

/**
 * The note every evidence card carries (design §12.1, v2 §2): "verified" only
 * means the app really showed it in that player's own case file; a Hacker's
 * loop can make a camera feed false.
 */
export const EVIDENCE_CARD_NOTE = "Verified: from their own case file. Cameras can be tampered with.";

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
      return `${e.players.length} players set out to rob ${JOBS[e.job]?.name ?? e.job}.`;
    case "rngSeeded":
      return `The deck was shuffled with seed ${e.seed}.`;
    case "roomsSet":
      return `Rooms in play: ${list(e.rooms.map(roomName))}.`;
    case "bankFilled":
      return `The bank holds ${e.coins} coins.`;
    case "roleDealt":
      return you(e.player) ? `You were dealt the ${roleName(e.role)}.` : `${ctx.name(e.player)} was the ${roleName(e.role)}.`;
    case "roleListShown":
      return `${e.list === "exact" ? "Roles in play" : "Roles that could be in play"}: ${list(e.roles.map(roleName))}.`;
    case "shopDealt":
      return e.perks.length === 0 ? "No shop in this game." : `The shop has ${list(e.perks.map(perkName))} on sale.`;
    case "rngAdvanced":
      return "The dice rolled.";
    case "roundStarted":
      return `Round ${e.round} begins.`;
    case "moveLocked":
      return `${verb(e.player, "locked", "locked")} in a move for round ${e.round}.`;
    case "moveSubmitted":
      return `${verb(e.player, "picked", "picked")} the ${roomName(e.move.room)} for round ${e.round}${e.move.pocket > 0 ? `, pocketing ${e.move.pocket} of ${e.move.duffel + e.move.pocket}` : ", handing everything in"}${e.move.watch ? `, watching the ${roomName(e.move.watch)}` : ""}.`;
    case "defaultMoveAssigned":
      // design §3.3 (owner, 7 Nov): with the Lobby taped off, a missed move sits the round out.
      return e.move
        ? `${verb(e.player, "missed", "missed")} round ${e.round}'s deadline: the default move went to the ${roomName(e.move.room)}, handing everything in.`
        : `${verb(e.player, "missed", "missed")} round ${e.round}'s deadline: the default room is taped off, so ${you(e.player) ? "you sat" : "they sat"} the round out.`;
    case "coinsGrabbed":
      // design §5.3: in a raided room the police seized the whole grab.
      return e.seized > 0
        ? `Round ${e.round}, ${roomName(e.room)}: ${verb(e.player, "grabbed", "grabbed")} ${e.seized} coins, and the police seized them all.`
        : `Round ${e.round}, ${roomName(e.room)}: ${verb(e.player, "grabbed", "grabbed")} ${e.duffel + e.pocket} coins, ${e.duffel} to the duffel and ${e.pocket} pocketed.`;
    case "abilityResolved":
      return ability(e.ability, e.player, e.round, { you, who, whose, verb });
    case "abilityAlreadyDone":
      // design §11.4: another copy of the role did it first; the use isn't spent.
      return `Round ${e.round}: already done this round by another copy of ${you(e.player) ? "your" : "their"} role; ${you(e.player) ? "your" : "their"} power is not spent.`;
    case "sinsAbsolved":
      return `Round ${e.round}: ${you(e.player) ? "your" : `${whose(e.player)}`} sins were absolved.`;
    case "roomSighting":
      return e.others.length === 0
        ? `Round ${e.round}: ${verb(e.player, "were", "was")} alone in the ${roomName(e.room)}.`
        : `Round ${e.round}: in the ${roomName(e.room)}, ${verb(e.player, "saw", "saw")} ${names(e.others)}.`;
    case "roomWatched": {
      const how = e.source === "security" ? "On the cameras" : e.source === "lookout" ? "On lookout" : "Tailing";
      // design §11.1: a blacked-out room's cameras are offline.
      if (e.offline) return `Round ${e.round}, ${how.toLowerCase()}: cameras offline in the ${roomName(e.room)}${you(e.player) ? "" : ` (seen by ${ctx.name(e.player)})`}.`;
      return `Round ${e.round}, ${how.toLowerCase()}: ${e.seen.length === 0 ? "nobody" : names(e.seen)} in the ${roomName(e.room)}${you(e.player) ? "" : ` (seen by ${ctx.name(e.player)})`}.`;
    }
    case "roundResolved":
      return `Round ${e.round}: ${e.taken} taken, ${e.missing} ${e.missing === 1 ? "coin" : "coins"} went missing, ${e.bank} coins left in the bank.`;
    case "duffelSplit":
      return `Round ${e.round}: the duffel split ${e.cut} each (share now ${e.share}, kitty ${e.kitty}).`;
    case "bellsRung":
      // design §5.1, §11.1: a hidden bell shows "?".
      return `Round ${e.round} bells: ${bells(e.bells)}${e.hidden.length > 0 ? `; ${list(e.hidden.map(roomName))} ?` : ""}.`;
    case "roomRaided":
      return `Raid! The police hit the ${roomName(e.room)} in round ${e.round} and seized ${e.seized} coin${e.seized === 1 ? "" : "s"}. It is taped off through round ${e.closedThrough}. Wanted ${e.wanted}.`;
    case "bellsCooled":
      return `After round ${e.round} the bells cooled: ${bells(e.bells)}.`;
    case "roomReopened":
      return `The tape is off the ${roomName(e.room)}: it opens again next round.`;
    case "powerCut":
      return `Power cut in the ${roomName(e.room)} this round.`;
    case "eventFlipped":
      return `Round ${e.round} event: ${cardName(e.card)}${e.room ? ` (the ${roomName(e.room)} is closed)` : ""}.`;
    case "insideTip":
      return `Inside tip${you(e.player) ? "" : ` for ${ctx.name(e.player)}`}: ${who(e.subject)} ${you(e.subject) ? "are" : "is"} the ${roleName(e.role)}.`;
    case "auditReport": {
      // design §13: how many coins reached the duffel from each room.
      const handedIn = Object.entries(e.duffel).filter(([, n]) => n > 0);
      return handedIn.length === 0
        ? `Audit of round ${e.round}: no coins reached the duffel.`
        : `Audit of round ${e.round}: ${list(handedIn.map(([room, n]) => `${roomName(room)} ${n}`))} reached the duffel.`;
    }
    case "alibiPosted":
      return `${verb(e.player, "say", "says")} ${you(e.player) ? "you were" : "they were"} in the ${roomName(e.room)} in round ${e.round}.`;
    case "alibisClosed":
      return `Alibis for round ${e.round} are closed.`;
    case "roleClaimed":
      return `${verb(e.player, "claim", "claims")} to be the ${roleName(e.role)}.`;
    case "meetingProposed":
      return `${verb(e.by, "proposed", "proposed")} the next meeting for ${slot(e.slot)}.`;
    case "meetingProposalAccepted":
      return `${verb(e.by, "backed", "backed")} a meeting time.`;
    case "meetingScheduled":
      return `The next meeting is set for ${slot(e.slot)}${e.proposalId === null ? " (picked by the app)" : ""}.`;
    case "emergencyMeetingCalled":
      return `${verb(e.by, "called", "called")} an emergency meeting.`;
    case "meetingOpened":
      return `The ${MEETING_TITLE[e.kind].toLowerCase()} is open: time to vote.`;
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
      return `${who(e.target)} ${you(e.target) ? "were" : "was"} shaken down: a stash of ${e.stashRevealed}, ${e.taken} set aside for the next split.${e.clean ? " Clean: nothing above the share." : ""}`;
    case "tokenEarned":
      return `${verb(e.player, "earned", "earned")} a token.`;
    case "perkBought":
      return `${verb(e.player, "bought", "bought")} a ${perkName(e.perk)} perk for ${e.cost} token${e.cost === 1 ? "" : "s"}: ${PERKS[e.perk]?.effect ?? ""}`.trim();
    case "perkUsed":
      return perk(e.perk, e.player, { you, who, whose, verb });
    case "rigPicked":
      return `${verb(e.player, "rigged", "rigged")} round ${e.round}'s card: ${cardName(e.card)}.`;
    case "alibiVerified":
      return `Verified: ${who(e.player)} really ${you(e.player) ? "were" : "was"} in the ${roomName(e.room)} in round ${e.round}.`;
    case "gameEnded": {
      const o = e.outcome;
      const winners = o.winners.length === 0 ? "nobody wins" : `${names(o.winners)} ${o.winners.length === 1 && !you(o.winners[0]!) ? "wins" : "win"}`;
      return o.result === "success"
        ? `Job done! The crew got away with it: ${winners}.`
        : o.reason === "bust"
          ? `Busted: Wanted hit the bust line and the heist failed; ${o.escapees.length === 0 ? "nobody was on the Rooftop" : `${names(o.escapees)} got away over the Rooftop`}; ${winners}.`
          : `The heist was sunk by theft: under two-thirds of the coins taken reached the crew; ${winners}.`;
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

function ability(a: ResolvedAbility, player: PlayerId, round: number, { you, who, whose, verb }: Grammar): string {
  switch (a.kind) {
    case "lookout":
      return `Round ${round}: ${verb(player, "kept", "kept")} lookout on the ${list(a.rooms.map(roomName))}.`;
    case "hide":
      return `Round ${round}: ${verb(player, "hid", "hid")} the ${roomName(a.room)}'s bell${a.bulbs === null ? "" : `; it really shows ${a.bulbs} lit`}.`;
    case "blackout":
      return `Round ${round}: ${verb(player, "cut", "cut")} the power in the ${roomName(a.room)} for next round.`;
    case "absolve":
      return a.taken === null
        ? `Round ${round}: ${verb(player, "absolved", "absolved")} ${who(a.target)}, but the bust came first.`
        : `Round ${round}: ${verb(player, "absolved", "absolved")} ${who(a.target)}: ${a.taken} set aside for the next split.`;
    case "ring":
      return `Round ${round}: ${verb(player, "tipped", "tipped")} off the police: the ${roomName(a.room)}'s bell rang once more.`;
    case "reopen":
      return `Round ${round}: ${verb(player, "tore", "tore")} the tape off the ${roomName(a.room)}.`;
    case "audit":
      return `Audit: ${a.duffel} ${a.duffel === 1 ? "coin" : "coins"} reached the duffel from the ${roomName(a.room)} in round ${a.round}.`;
    case "detect":
      return `Round ${a.round}: ${who(a.target)} grabbed ${a.grabbed} ${a.grabbed === 1 ? "coin" : "coins"}.`;
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
    default: {
      const never: never = p;
      return String((never as { kind: string }).kind);
    }
  }
}

function meetingResult(
  r: MeetingResult,
  tally: { readonly skip: number; readonly targets: Readonly<Record<PlayerId, number>> },
  who: (p: PlayerId) => string,
): string {
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
