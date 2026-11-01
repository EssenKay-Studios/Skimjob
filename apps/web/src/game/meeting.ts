// Pure helpers behind the meetings and voting UI (docs/m2-plan.md M2-7): the
// slot planner, the emergency button, the vote dialog, the tallies, the
// shakedown window and the results banner, plus the meeting-time abilities on
// your role card. Everything is read from the player's own view, so a vote
// mode shows exactly what the view allows and nothing more. design §11.1–§11.5
import { PERKS, type PerkId } from "@skimjob/content";
import {
  rolesFor,
  type CheckpointChecked,
  type MeetingKind,
  type MeetingResult,
  type PlayerId,
  type PlayerView,
  type ShakedownResolved,
  type VoteChoice,
  type VoteVisibility,
} from "@skimjob/engine";
import { setupOf } from "./hud";

/** Duel games have no meetings or votes (design §16.1). */
export const hasMeetings = (view: PlayerView): boolean => !setupOf(view)?.duel;

/** Every other player, in seat order: who you may vote for (never yourself, design §11.2). */
export function voteTargets(view: PlayerView): { readonly id: PlayerId; readonly name: string; readonly isBot: boolean }[] {
  const order = setupOf(view)?.players ?? view.players;
  return order.filter((p) => p.id !== view.me.id).map((p) => ({ id: p.id, name: p.name, isBot: p.isBot }));
}

export const sameVote = (a: VoteChoice | null, b: VoteChoice | null): boolean =>
  a === null || b === null ? a === b : a.kind === b.kind && (a.kind === "skip" || (b.kind === "shakedown" && a.target === b.target));

/** What each vote mode tells the player, before and after the window closes. design §11.2 */
export const MODE_NOTE: Readonly<Record<VoteVisibility, string>> = {
  hiddenThenRevealed: "Ballots stay hidden while the window is open. When it closes, everyone's vote goes in the ledger.",
  open: "Open vote: everyone sees each ballot as it's cast.",
  secret: "Secret vote: only the final tally is ever shown, even after the game.",
};

export const MODE_NAME: Readonly<Record<VoteVisibility, string>> = { hiddenThenRevealed: "Hidden, then revealed", open: "Open", secret: "Secret" };

// ---------------------------------------------------------------- scheduling (§11.1)

export interface ProposalRow {
  readonly id: string;
  readonly slot: string;
  readonly by: PlayerId;
  readonly backers: number;
  /** You proposed or backed it. */
  readonly backed: boolean;
}

export interface Planner {
  readonly act: 1 | 2 | 3;
  /** The act's meeting is locked in (and not yet open). */
  readonly locked: { readonly meetingId: string; readonly slot: string } | null;
  readonly proposals: readonly ProposalRow[];
  /** Backers that lock a slot in: more than half the crew. */
  readonly needed: number;
  /** Proposing and backing are allowed now (not locked, no meeting on). */
  readonly open: boolean;
}

const meetingOn = (view: PlayerView) => view.phase.kind === "meeting" || view.phase.kind === "shakedownPending";

/** The act's meeting: proposals, backers and the locked slot. design §11.1 */
export function plannerOf(view: PlayerView): Planner {
  const crew = view.players.length + 1;
  const locked = view.scheduledMeeting ? { meetingId: view.scheduledMeeting.meetingId, slot: view.scheduledMeeting.slot } : null;
  return {
    act: view.act,
    locked,
    proposals: view.proposals
      .filter((p) => p.act === view.act)
      .map((p) => ({ id: p.id, slot: p.slot, by: p.by, backers: p.acceptedBy.length, backed: p.acceptedBy.includes(view.me.id) })),
    needed: Math.floor(crew / 2) + 1,
    open: !locked && !meetingOn(view) && view.phase.kind !== "ended",
  };
}

/** A meeting slot for people: ISO times as a local time, "act-2" as "the end of Act 2", other labels as they are. */
export function slotText(slot: string): string {
  const act = /^act-(\d)$/.exec(slot);
  if (act) return `the end of Act ${act[1]}`;
  const t = /^\d{4}-\d{2}-\d{2}T/.test(slot) ? new Date(slot) : null;
  return t && !Number.isNaN(t.getTime()) ? t.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : slot;
}

/** A `datetime-local` value (local wall time) as the ISO slot the server opens the meeting at; null if it isn't a time. */
export function slotFromLocal(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const t = new Date(value);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

/** `ms` (epoch) as a `datetime-local` value in local time, minutes only. */
export function localInputValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface EmergencyState {
  readonly canCall: boolean;
  /** Why not, or what it costs. */
  readonly note: string;
}

const perkCount = (view: PlayerView, perk: PerkId) => view.me.roleState.perks.filter((p) => p === perk).length;

/** One emergency meeting per player per game, plus one per Emergency perk; one waiting at a time. design §11.1, §8.3 */
export function emergencyOf(view: PlayerView): EmergencyState {
  const extra = perkCount(view, "emergency");
  const used = view.me.emergencyMeetingUsed;
  if (view.phase.kind === "ended") return { canCall: false, note: "The game is over." };
  if (used && extra === 0) return { canCall: false, note: "You've called your emergency meeting for this game." };
  if (meetingOn(view)) return { canCall: false, note: "A meeting is on right now." };
  if (view.pendingEmergency) return { canCall: false, note: "An emergency meeting has already been called." };
  return {
    canCall: true,
    note: used ? `Your ${PERKS.emergency.name} perk pays for this one (${extra} left).` : "One per player per game. Everyone is told, and rounds pause while it runs.",
  };
}

// ---------------------------------------------------------------- the vote window (§11.2)

export interface BallotRow {
  readonly player: PlayerId;
  readonly vote: VoteChoice | null;
}

export interface OpenMeeting {
  readonly meetingId: string;
  readonly kind: MeetingKind;
  readonly act: 1 | 2 | 3;
  readonly calledBy: PlayerId | null;
  readonly mode: VoteVisibility;
  /** Your ballot so far, and whether it came from your sealed vote. */
  readonly mine: VoteChoice | null;
  readonly fromSealed: boolean;
  /**
   * Other players' ballots you may see now: everyone's in Open mode (public as
   * cast), none in the other modes. Never yours (that's `mine`).
   */
  readonly ballots: readonly BallotRow[];
  /** Ballots you see through a Ballot perk (also in Secret mode). design §8.3 */
  readonly seen: readonly BallotRow[];
  /** The live tally: Open mode only (one per ballot, so a Smooth Talker's weight never shows). */
  readonly live: Tally | null;
}

/** The open vote window, read from the view. design §11.2 */
export function openMeetingOf(view: PlayerView): OpenMeeting | null {
  const p = view.phase;
  if (p.kind !== "meeting") return null;
  const id = p.meetingId;
  let kind: MeetingKind = "regular";
  let act = view.act;
  let calledBy: PlayerId | null = null;
  const latest = new Map<PlayerId, VoteChoice>();
  let fromSealed = false;
  for (const { event: e } of view.ledger) {
    if (e.type === "meetingOpened" && e.meetingId === id) ({ kind, act } = e);
    else if (e.type === "emergencyMeetingCalled" && e.meetingId === id) calledBy = e.by;
    else if (e.type === "voteCast" && e.meetingId === id && e.player !== view.me.id) latest.set(e.player, e.vote);
  }
  // Your own ballots: public in Open mode (ledger), private or secret otherwise (case file).
  for (const { event: e } of [...view.ledger, ...view.caseFile]) if (e.type === "voteCast" && e.meetingId === id && e.player === view.me.id) fromSealed = e.sealed;
  const mode = view.voteVisibility;
  const ballots = mode === "open" ? voteTargets(view).filter((t) => latest.has(t.id)).map((t) => ({ player: t.id, vote: latest.get(t.id)! })) : [];
  const seen = Object.entries(view.me.seenBallots).map(([player, vote]) => ({ player, vote }));
  const live = mode === "open" ? tallyOf([...ballots.map((b) => b.vote!), ...(view.me.vote ? [view.me.vote] : [])]) : null;
  return { meetingId: id, kind, act, calledBy, mode, mine: view.me.vote, fromSealed: fromSealed && view.me.vote !== null, ballots, seen, live };
}

// ---------------------------------------------------------------- tallies

export interface Tally {
  readonly skip: number;
  readonly targets: Readonly<Record<PlayerId, number>>;
}

export function tallyOf(votes: readonly VoteChoice[]): Tally {
  let skip = 0;
  const targets: Record<PlayerId, number> = {};
  for (const v of votes) {
    if (v.kind === "skip") skip++;
    else targets[v.target] = (targets[v.target] ?? 0) + 1;
  }
  return { skip, targets };
}

export interface TallyRow {
  /** A player id, or "skip". */
  readonly key: string;
  readonly target: PlayerId | null;
  readonly votes: number;
  /** Share of the biggest count (0–1), for the bar. */
  readonly share: number;
  /** The single biggest count (ui-style: hatched gold). */
  readonly leading: boolean;
  /** What the crew decided (ui-style: green). */
  readonly passed: boolean;
}

/** Bars for a tally: targets by votes, then Skip; the leader and the passed option marked. */
export function tallyRows(tally: Tally, result: MeetingResult | null = null): TallyRow[] {
  const entries: [string, PlayerId | null, number][] = [
    ...Object.entries(tally.targets)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([p, n]): [string, PlayerId | null, number] => [p, p, n]),
    ["skip", null, tally.skip],
  ];
  const max = Math.max(0, ...entries.map((e) => e[2]));
  const leaders = entries.filter((e) => e[2] === max && max > 0).length;
  return entries.map(([key, target, votes]) => ({
    key,
    target,
    votes,
    share: max > 0 ? votes / max : 0,
    leading: leaders === 1 && votes === max && max > 0,
    passed: result !== null && ((result.kind === "shakedown" && result.target === target) || (result.kind === "skipped" && target === null)),
  }));
}

// ---------------------------------------------------------------- results (§11.3, §11.4)

export interface MeetingOutcome {
  readonly meetingId: string;
  readonly kind: MeetingKind;
  readonly act: 1 | 2 | 3;
  readonly result: MeetingResult;
  readonly tally: Tally;
  /** Everyone's ballot once the window closed (Hidden and Open modes); null in Secret mode. design §11.2 */
  readonly ballots: readonly BallotRow[] | null;
  /** The shakedown window is running (the neutral "the crew is deciding…" state). */
  readonly deciding: boolean;
  readonly shakedown: ShakedownResolved | null;
  readonly cancelled: boolean;
  /** The Muscle who called off a dirty player's shakedown (public `muscleNamed`). */
  readonly muscle: PlayerId | null;
  /** The bank paid a blessed player's compensation (Priest): the amount back in the Haul. */
  readonly blessing: number | null;
  readonly checkpoint: CheckpointChecked | null;
  /** Still the latest news: no round has resolved and no meeting opened since. */
  readonly fresh: boolean;
}

/** The latest closed meeting and what followed it: shakedown, compensation, blessing, checkpoint. */
export function latestOutcome(view: PlayerView): MeetingOutcome | null {
  let start = -1;
  for (let i = view.ledger.length - 1; i >= 0; i--) {
    if (view.ledger[i]!.event.type === "meetingClosed") {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  const closed = view.ledger[start]!.event;
  if (closed.type !== "meetingClosed") return null;
  const id = closed.meetingId;
  let kind: MeetingKind = "regular";
  let act = view.act;
  for (const { event: e } of view.ledger) if (e.type === "meetingOpened" && e.meetingId === id) ({ kind, act } = e);
  let shakedown: ShakedownResolved | null = null;
  let cancelled = false;
  let muscle: PlayerId | null = null;
  let blessing: number | null = null;
  let checkpoint: CheckpointChecked | null = null;
  let fresh = true;
  for (const { event: e } of view.ledger.slice(start + 1)) {
    if (e.type === "roundResolved" || e.type === "meetingOpened") {
      fresh = false;
      break;
    }
    if (e.type === "shakedownResolved" && e.meetingId === id) shakedown = e;
    else if (e.type === "shakedownCancelled" && e.meetingId === id) cancelled = true;
    else if (e.type === "muscleNamed" && e.meetingId === id) muscle = e.player;
    else if (e.type === "blessingPaid" && e.meetingId === id) blessing = e.amount;
    else if (e.type === "checkpointChecked" && checkpoint === null) checkpoint = e;
  }
  const ballots = closed.ballots ? voteTargetsAll(view).filter((p) => Object.hasOwn(closed.ballots!, p)).map((p) => ({ player: p, vote: closed.ballots![p]! })) : null;
  const deciding = view.phase.kind === "shakedownPending" && view.phase.meetingId === id;
  return { meetingId: id, kind, act, result: closed.result, tally: closed.tally, ballots, deciding, shakedown, cancelled, muscle, blessing, checkpoint, fresh };
}

/** Everyone in seat order, you included. */
const voteTargetsAll = (view: PlayerView): PlayerId[] => (setupOf(view)?.players ?? [...view.players, { id: view.me.id }]).map((p) => p.id);

/** The shakedown window: who the vote went against. Identical for every player, Muscle or not, cancelled or not. design §11.3 */
export function decidingOf(view: PlayerView): { readonly meetingId: string; readonly target: PlayerId } | null {
  return view.phase.kind === "shakedownPending" ? { meetingId: view.phase.meetingId, target: view.phase.target } : null;
}

// ---------------------------------------------------------------- abilities during meetings

export type AbilityOffer =
  /** Muscle: call off the pending shakedown (once per game; irreversible). design §8, §11.3 */
  | { readonly kind: "cancelShakedown"; readonly target: PlayerId }
  /** Priest: bless another player for this act (once per act). design §8 (v2 §2) */
  | { readonly kind: "bless"; readonly targets: readonly PlayerId[] }
  /** +Vote perk: your ballot weighs one more in this meeting. design §8.3 */
  | { readonly kind: "extraVote" }
  /** Ballot perk: watch one player's ballot in this meeting (not in Open mode). design §8.3 */
  | { readonly kind: "ballot"; readonly targets: readonly PlayerId[] };

/** The meeting-time powers and perks you can use right now. The Smooth Talker's weight is automatic and never shown. */
export function abilityOffers(view: PlayerView): AbilityOffer[] {
  if (view.phase.kind === "ended" || view.phase.kind === "setup" || !hasMeetings(view)) return [];
  const setup = setupOf(view);
  const power = rolesFor({ contentOverrides: setup?.contentOverrides ?? null })[view.me.role]?.power;
  const others = voteTargets(view).map((t) => t.id);
  const out: AbilityOffer[] = [];
  const p = view.phase;
  if (power?.kind === "cancelShakedown" && p.kind === "shakedownPending" && view.me.roleState.usedThisGame < power.perGame) {
    const done = view.caseFile.some(({ event: e }) => e.type === "abilityResolved" && e.ability.kind === "cancelShakedown" && e.ability.meetingId === p.meetingId);
    if (!done) out.push({ kind: "cancelShakedown", target: p.target });
  }
  if (power?.kind === "bless" && view.me.roleState.usedThisAct < power.perAct) {
    const pending = p.kind === "shakedownPending" ? p.target : null;
    out.push({ kind: "bless", targets: others.filter((o) => o !== pending) });
  }
  if (p.kind === "meeting") {
    const spent = (kind: "extraVote") =>
      view.caseFile.some(({ event: e }) => e.type === "perkUsed" && e.perk.kind === kind && "meetingId" in e.perk && e.perk.meetingId === p.meetingId);
    if (perkCount(view, "extraVote") > 0 && !spent("extraVote")) out.push({ kind: "extraVote" });
    if (perkCount(view, "ballot") > 0 && view.voteVisibility !== "open") {
      const watching = new Set(Object.keys(view.me.seenBallots));
      const targets = others.filter((o) => !watching.has(o));
      if (targets.length > 0) out.push({ kind: "ballot", targets });
    }
  }
  return out;
}

/** Perk tokens you hold, as "Ballot ×2". */
export function perksHeld(view: PlayerView): { readonly id: PerkId; readonly name: string; readonly count: number }[] {
  const counts = new Map<PerkId, number>();
  for (const p of view.me.roleState.perks) counts.set(p, (counts.get(p) ?? 0) + 1);
  return [...counts].map(([id, count]) => ({ id, name: PERKS[id]?.name ?? id, count }));
}
