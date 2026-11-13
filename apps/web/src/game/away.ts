// "While you were away" (design §15.4): a 2–4 line summary of what changed since
// the player last looked, from `eventsSince(view, lastSeen)` only, so it can
// never say more than the player's own ledger and case file. Pure; generic over
// events (it names no role or faction). Each line is the case board's own fact
// line from describeEvent, so the ledger, the recap and the case board say a
// fact the same way.
import type { GameEvent, LoggedEvent, PlayerView } from "@skimjob/engine";
import { describeEvent, type DescribeContext } from "./describeEvent";
import { bailPromptOf, MEETING_TITLE } from "./meeting";

/** One recap line and the entries it was built from (for tests: they must all be in the viewer's view). */
export interface RecapItem {
  readonly text: string;
  readonly from: readonly number[];
}

/** At most this many lines; at least two whenever there is anything to say (the last says what's next). */
export const RECAP_MAX_LINES = 4;

/** Your own deliberate actions in the case file (your trust marks included, design §10.3): you know them already, so they aren't news. */
const OWN_ACTIONS: ReadonlySet<GameEvent["type"]> = new Set<GameEvent["type"]>(["moveSubmitted", "voteSealed", "voteCast", "coinsGrabbed", "alibiMarked"]);

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
  // design §5.3: raids (with Wanted) and a reopened room.
  for (const e of [...of("roomRaided"), ...of("roomReopened")]) picks.push({ prio: 1, ...say(e) });

  // design §7.4: coins taken and missing and the bank, as the case board's Haul line; several rounds add up in one.
  const rounds = of("roundResolved");
  if (rounds.length === 1) picks.push({ prio: 2, ...say(rounds[0]!) });
  else if (rounds.length > 1) {
    const last = rounds.at(-1)!.event;
    const taken = rounds.reduce((n, e) => n + e.event.taken, 0);
    const missing = rounds.reduce((n, e) => n + e.event.missing, 0);
    picks.push({
      prio: 2,
      seq: rounds.at(-1)!.seq,
      text: `Rounds ${rounds[0]!.event.round}–${last.round}: ${taken} taken, ${missing} ${missing === 1 ? "coin" : "coins"} went missing, ${last.bank} coins left in the bank.`,
      from: rounds.map((e) => e.seq),
    });
  }

  // design §10.2: the latest snapshot card is out. Its alibis and "no alibi" facts are on the card, not their own lines.
  const card = of("alibiWindowClosed").at(-1);
  if (card) picks.push({ prio: 6, seq: card.seq, text: `Round ${card.event.round}'s snapshot card is in the case board.`, from: [card.seq] });

  // Meetings: the shakedown's result says more than the vote that called it.
  const settled = new Set([...of("shakedownResolved"), ...of("shakedownCancelled")].map((e) => e.event.target));
  for (const e of of("shakedownResolved")) picks.push({ prio: 4, ...say(e) });
  for (const e of of("shakedownCancelled")) picks.push({ prio: 4, ...say(e) });
  for (const e of of("meetingClosed")) {
    if (e.event.result.kind === "shakedown" && settled.has(e.event.result.target)) continue;
    picks.push({ prio: 4, ...say(e) });
  }
  // What people said (design §15.4): role claims, with emergencies called and meetings set.
  const claims = of("said").filter((e) => e.event.statement.kind === "role");
  for (const e of [...of("emergencyMeetingCalled"), ...of("meetingScheduled"), ...claims]) picks.push({ prio: 5, ...say(e) });

  // Your case file: only your own entries are in it (viewFor), minus what you did yourself.
  const news = events.filter((e) => e.event.visibility.kind !== "public" && !OWN_ACTIONS.has(e.event.type));
  if (news.length === 1) picks.push({ prio: 7, ...say(news[0]!), text: `Only you: ${describeEvent(news[0]!.event, ctx)}` });
  else if (news.length > 1) picks.push({ prio: 7, seq: news.at(-1)!.seq, text: `${news.length} new entries in your case file (only you see them).`, from: news.map((e) => e.seq) });

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
    case "meeting":
      return view.me.vote || view.me.sealedVote ? "Now: the meeting is open; your vote is in." : "Now: the meeting is open. Cast your vote.";
    case "shakedownPending":
      return bailPromptOf(view) ? "Now: a shakedown is about to land on you. Use your Bail, or keep it." : "Now: a shakedown is about to land.";
    case "awaitingMeeting":
      return `Now: the ${MEETING_TITLE[p.meeting].toLowerCase()} is next.`;
    case "alibi":
      return `Now: round ${p.round}'s alibi window is open.`;
    case "result":
      return `Now: round ${p.round}'s result is in.`;
    default:
      return null;
  }
}
