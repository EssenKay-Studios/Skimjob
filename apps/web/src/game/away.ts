// "While you were away" (design §13, M2-10): a 2–4 line summary of what changed
// since the player last looked, from `eventsSince(view, lastSeen)` only, so it
// can never say more than the player's own ledger and case file. Pure; generic
// over events (it names no role or faction: lines come from describeEvent or
// from public round results). docs/m2-plan.md M2-10
import type { GameEvent, LoggedEvent, PlayerView } from "@skimjob/engine";
import { describeEvent, type DescribeContext } from "./describeEvent";
import { meetingAfter, meetingName } from "./wording";

/** One recap line and the entries it was built from (for tests: they must all be in the viewer's view). */
export interface RecapItem {
  readonly text: string;
  readonly from: readonly number[];
}

/** At most this many lines; at least two whenever there is anything to say (the last says what's next). */
export const RECAP_MAX_LINES = 4;

/** Your own deliberate actions in the case file: you know them already, so they aren't news. */
const OWN_ACTIONS: ReadonlySet<GameEvent["type"]> = new Set<GameEvent["type"]>(["moveSubmitted", "voteSealed", "voteCast", "lootSplit"]);

const signed = (n: number) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

/** The highest seq in a view (-1 when empty): what "seen everything" means. */
export const topSeq = (view: Pick<PlayerView, "ledger" | "caseFile">): number => view.ledger.length + view.caseFile.length - 1;

/**
 * The recap of `events` (oldest first, from `eventsSince`) for `view`'s player.
 * Empty when nothing worth saying happened (e.g. only lock-in marks).
 */
export function recapItems(events: readonly LoggedEvent[], view: PlayerView, ctx: DescribeContext): RecapItem[] {
  if (events.length === 0) return [];
  const say = (e: LoggedEvent) => ({ seq: e.seq, text: describeEvent(e.event, ctx), from: [e.seq] });
  /** Candidates by priority (lower first), each with the seq it sorts by. */
  const picks: { prio: number; seq: number; text: string; from: number[] }[] = [];
  const of = <T extends GameEvent["type"]>(type: T) => events.filter((e): e is LoggedEvent<Extract<GameEvent, { type: T }>> => e.event.type === type);

  for (const e of of("gameEnded")) picks.push({ prio: 0, ...say(e) });
  for (const e of [...of("copsRaided"), ...of("raidStopped")]) picks.push({ prio: 1, ...say(e) });

  // design §13 round summaries: Haul and Heat over every round resolved while away.
  const rounds = of("roundResolved");
  if (rounds.length > 0) {
    const first = rounds[0]!.event;
    const last = rounds.at(-1)!.event;
    const haul = rounds.reduce((n, e) => n + e.event.haulDelta, 0);
    const heat = rounds.reduce((n, e) => n + e.event.heatDelta, 0);
    const which = rounds.length === 1 ? `Round ${first.round}` : `Rounds ${first.round}–${last.round}`;
    picks.push({
      prio: 2,
      seq: rounds.at(-1)!.seq,
      text: `${which} done: Haul ${signed(haul)} (now ${last.haul}), Heat ${signed(heat)} (now ${last.heat}).`,
      from: rounds.map((e) => e.seq),
    });
  }
  for (const e of of("checkpointChecked")) picks.push({ prio: 3, ...say(e) });

  // Meetings: the shakedown's result says more than the vote that called it.
  const settled = new Set([...of("shakedownResolved"), ...of("shakedownCancelled")].map((e) => e.event.target));
  for (const e of of("shakedownResolved")) picks.push({ prio: 4, ...say(e) });
  for (const e of of("shakedownCancelled")) picks.push({ prio: 4, ...say(e) });
  for (const e of of("meetingClosed")) {
    if (e.event.result.kind === "shakedown" && settled.has(e.event.result.target)) continue;
    picks.push({ prio: 4, ...say(e) });
  }
  for (const e of [...of("emergencyMeetingCalled"), ...of("meetingScheduled")]) picks.push({ prio: 5, ...say(e) });

  // Your case file: only your own entries are in it (viewFor), minus what you did yourself.
  const news = events.filter((e) => e.event.visibility.kind !== "public" && !OWN_ACTIONS.has(e.event.type));
  if (news.length === 1) picks.push({ prio: 6, ...say(news[0]!), text: `Only you: ${describeEvent(news[0]!.event, ctx)}` });
  else if (news.length > 1) picks.push({ prio: 6, seq: news.at(-1)!.seq, text: `${news.length} new entries in your case file (only you see them).`, from: news.map((e) => e.seq) });

  const next = nextUp(view);
  if (picks.length === 0) {
    // Quiet: a round began, or nothing a person would call news.
    const started = of("roundStarted").at(-1);
    if (!started) return [];
    return [{ text: describeEvent(started.event, ctx), from: [started.seq] }, ...(next ? [{ text: next, from: [] }] : [])];
  }
  const room = next ? RECAP_MAX_LINES - 1 : RECAP_MAX_LINES;
  const kept = [...picks].sort((a, b) => a.prio - b.prio || a.seq - b.seq).slice(0, room);
  const lines: RecapItem[] = kept.sort((a, b) => a.seq - b.seq).map(({ text, from }) => ({ text, from }));
  return next ? [...lines, { text: next, from: [] }] : lines;
}

export const recap = (events: readonly LoggedEvent[], view: PlayerView, ctx: DescribeContext): string[] => recapItems(events, view, ctx).map((i) => i.text);

/** What's waiting for the player now, from their own view's public phase and their own move. */
export function nextUp(view: PlayerView): string | null {
  const p = view.phase;
  switch (p.kind) {
    case "planning":
      return view.me.move ? `Now: round ${p.round}, you're locked in (you can still change it).` : `Now: round ${p.round}. Pick your room before the deadline.`;
    case "alibis":
      return `Now: the round ${p.round} alibi window is open.`;
    case "meeting":
      return view.me.vote || view.me.sealedVote ? "Now: the meeting is open; your vote is in." : "Now: the meeting is open. Cast your vote.";
    case "shakedownPending":
      return "Now: a shakedown is about to land.";
    case "awaitingMeeting":
      return `Now: round ${meetingAfter(p.act)} is done; ${meetingName(p.act)} is next.`;
    default:
      return null;
  }
}
