// Chat on the client (M2-8b): the server's chat messages (apps/server chat.ts,
// mirrored here because the web app doesn't import the server), the feed
// state, threads, unread counts, composer limits and evidence-card text. Pure;
// the components and useGame() read through these. design §12.1, docs/m2-plan.md M2-8
import { revealsRole, type CaseFileEvent, type GameEvent, type LoggedEvent, type PlayerId, type PlayerView } from "@skimjob/engine";
import { describeEvent, type DescribeContext } from "./describeEvent";

/** The server's limits (apps/server settings.ts; chat.test.ts checks they match). */
export const CHAT_MAX_CHARS = 500;
export const CHAT_RATE = { messages: 8, windowMs: 10_000 } as const;
/** The counter shows from here on. */
export const CHAT_WARN_AT = 400;
/** Longest run of combining marks on one character (server CHAT_MAX_MARKS). */
const CHAT_MAX_MARKS = 8;

// ---------- Wire types (apps/server chat.ts) ----------

/** A shared case-file entry: the event's type and fields, without seq or visibility. */
export interface EvidenceCard {
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
}
interface ChatBase {
  readonly id: string;
  readonly from: PlayerId;
  /** The DM's recipient; null for crew chat. */
  readonly to: PlayerId | null;
  /** ISO time the server took it. */
  readonly at: string;
}
export type ChatMessage =
  | (ChatBase & { readonly text: string; readonly verified: false })
  | (ChatBase & { readonly card: EvidenceCard; readonly verified: true });
export interface DmNotice {
  readonly from: PlayerId;
  readonly to: PlayerId;
  readonly at: string;
}
export interface ChatHistory {
  readonly messages: readonly ChatMessage[];
  readonly dmNotices: readonly DmNotice[];
}
/** What the client posts: `{ chat: { to, text } }` or `{ chat: { to, evidence: seq } }`. */
export type ChatRequest = { readonly to: PlayerId | null } & ({ readonly text: string } | { readonly evidence: number });

const isStr = (x: unknown): x is string => typeof x === "string";
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** A server `chat` payload, or null if it isn't one (dropped, never half-rendered). */
export function asChatMessage(x: unknown): ChatMessage | null {
  if (!isObj(x) || !isStr(x.id) || !isStr(x.from) || !isStr(x.at) || !(x.to === null || isStr(x.to))) return null;
  if (x.verified === true && isObj(x.card) && isStr(x.card.type) && isObj(x.card.payload)) {
    return { id: x.id, from: x.from, to: x.to, at: x.at, verified: true, card: { type: x.card.type, payload: x.card.payload } };
  }
  if (x.verified === false && isStr(x.text)) return { id: x.id, from: x.from, to: x.to, at: x.at, verified: false, text: x.text };
  return null;
}
export function asDmNotice(x: unknown): DmNotice | null {
  return isObj(x) && isStr(x.from) && isStr(x.to) && isStr(x.at) ? { from: x.from, to: x.to, at: x.at } : null;
}

// ---------- Feed state ----------

export interface ChatState {
  /** Crew messages and your own DMs, oldest first, one per id. */
  readonly messages: readonly ChatMessage[];
  /** Others' DMs as notices, oldest first. */
  readonly notices: readonly DmNotice[];
  /** The server's history has arrived at least once. */
  readonly loaded: boolean;
}
export const EMPTY_CHAT: ChatState = { messages: [], notices: [], loaded: false };

export type ChatAction =
  | { readonly type: "history"; readonly history: ChatHistory }
  | { readonly type: "message"; readonly message: ChatMessage }
  | { readonly type: "notice"; readonly notice: DmNotice };

const byTime = <T extends { readonly at: string }>(xs: readonly T[]): T[] =>
  xs
    .map((x, i) => [x, i] as const)
    .sort(([a, i], [b, j]) => (a.at < b.at ? -1 : a.at > b.at ? 1 : i - j))
    .map(([x]) => x);
const noticeKey = (n: DmNotice) => `${n.from}\0${n.to}\0${n.at}`;

/**
 * Folds one server chat frame into the state. History arrives again on every
 * reconnect: it is merged by id (and notices by sender, recipient and time),
 * so nothing shows twice and whatever came in while away is filled in.
 */
export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "history": {
      const seen = new Set(state.messages.map((m) => m.id));
      const messages = [...state.messages, ...action.history.messages.filter((m) => !seen.has(m.id))];
      const keys = new Set(state.notices.map(noticeKey));
      const notices = [...state.notices, ...action.history.dmNotices.filter((n) => !keys.has(noticeKey(n)))];
      return { messages: byTime(messages), notices: byTime(notices), loaded: true };
    }
    case "message":
      if (state.messages.some((m) => m.id === action.message.id)) return state;
      return { ...state, messages: byTime([...state.messages, action.message]) };
    case "notice":
      if (state.notices.some((n) => noticeKey(n) === noticeKey(action.notice))) return state;
      return { ...state, notices: byTime([...state.notices, action.notice]) };
  }
}

// ---------- Threads and unread ----------

/** "crew", or "dm:<the other player>". */
export type ThreadId = "crew" | `dm:${string}`;
export const dmThread = (player: PlayerId): ThreadId => `dm:${player}`;
export const partnerOf = (thread: ThreadId): PlayerId | null => (thread === "crew" ? null : thread.slice(3));
export const threadOf = (m: ChatMessage, me: PlayerId): ThreadId => (m.to === null ? "crew" : dmThread(m.from === me ? m.to : m.from));

export const threadMessages = (state: ChatState, thread: ThreadId, me: PlayerId) => state.messages.filter((m) => threadOf(m, me) === thread);

/** Your DM partners: the most recently active first, then threads you opened but haven't written in yet. */
export function dmPartners(state: ChatState, me: PlayerId, opened: readonly PlayerId[] = []): PlayerId[] {
  const last = new Map<PlayerId, string>();
  for (const m of state.messages) {
    const p = partnerOf(threadOf(m, me));
    if (p) last.set(p, m.at);
  }
  const active = [...last.entries()].sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0)).map(([p]) => p);
  return [...active, ...opened.filter((p) => !last.has(p) && p !== me)];
}

/** Per thread, the time of the latest message you've read. */
export type ReadState = Readonly<Partial<Record<ThreadId, string>>>;

/** Messages from others in `thread` newer than what you've read. */
export const unreadCount = (state: ChatState, thread: ThreadId, me: PlayerId, read: ReadState): number =>
  threadMessages(state, thread, me).filter((m) => m.from !== me && m.at > (read[thread] ?? "")).length;

export function totalUnread(state: ChatState, me: PlayerId, read: ReadState): number {
  return (["crew", ...dmPartners(state, me).map(dmThread)] as ThreadId[]).reduce((n, t) => n + unreadCount(state, t, me, read), 0);
}

/** The time of `thread`'s latest message, or null. */
export const latestAt = (state: ChatState, thread: ThreadId, me: PlayerId): string | null => threadMessages(state, thread, me).at(-1)?.at ?? null;

/** Two sets of read marks (another tab's, stored ones) merged: the later mark per thread wins, so nothing goes back to unread. */
export function mergeRead(a: ReadState, b: ReadState): ReadState {
  const out: Partial<Record<ThreadId, string>> = { ...a };
  for (const [t, at] of Object.entries(b) as [ThreadId, string | undefined][]) {
    if (typeof at === "string" && at > (out[t] ?? "")) out[t] = at;
  }
  return out;
}

/** Marks `thread` read up to `at` (never backwards). */
export const markRead = (read: ReadState, thread: ThreadId, at: string): ReadState => ((read[thread] ?? "") >= at ? read : { ...read, [thread]: at });

// ---------- The feed a thread shows ----------

/** A public game event the client saw arrive, stamped with when (for the crew feed's inline rows). */
export interface FeedEvent {
  readonly key: string;
  readonly at: string;
  readonly text: string;
}
export type FeedItem =
  | { readonly kind: "message"; readonly key: string; readonly at: string; readonly message: ChatMessage }
  | {
      readonly kind: "notice";
      readonly key: string;
      readonly at: string;
      /** The first notice of the run. */
      readonly notice: DmNotice;
      readonly count: number;
      /** The run has DMs both ways. */
      readonly mutual: boolean;
    }
  | { readonly kind: "event"; readonly key: string; readonly at: string; readonly text: string };

const samePair = (a: DmNotice, b: DmNotice) => (a.from === b.from && a.to === b.to) || (a.from === b.to && a.to === b.from);

/**
 * What `thread` shows, oldest first. The crew feed also has DM notices (a run
 * of notices for the same two players folds into one, with a count) and the
 * game events that arrived while you watched.
 */
export function feedFor(state: ChatState, thread: ThreadId, me: PlayerId, events: readonly FeedEvent[] = []): FeedItem[] {
  const msgs: FeedItem[] = threadMessages(state, thread, me).map((m) => ({ kind: "message", key: m.id, at: m.at, message: m }));
  if (thread !== "crew") return msgs;
  const notes: FeedItem[] = state.notices.map((n) => ({ kind: "notice", key: `n:${noticeKey(n)}`, at: n.at, notice: n, count: 1, mutual: false }));
  const evs: FeedItem[] = events.map((e) => ({ kind: "event", key: `e:${e.key}`, at: e.at, text: e.text }));
  const out: FeedItem[] = [];
  for (const item of byTime([...msgs, ...notes, ...evs])) {
    const prev = out.at(-1);
    if (item.kind === "notice" && prev?.kind === "notice" && samePair(prev.notice, item.notice)) {
      out[out.length - 1] = { ...prev, at: item.at, count: prev.count + 1, mutual: prev.mutual || prev.notice.from !== item.notice.from };
    } else out.push(item);
  }
  return out;
}

/** design §12.1: the crew sees *that* two players messaged, never what. */
export const noticeText = (n: DmNotice, name: (p: PlayerId) => string, mutual = false): string =>
  mutual ? `${name(n.from)} and ${name(n.to)} are DMing` : `${name(n.from)} is DMing ${name(n.to)}`;

// ---------- Composer ----------

/** Characters as the server counts them: trimmed, CRLF → LF, code points. */
export const chatLength = (text: string): number => [...text.replace(/\r\n?/g, "\n").trim()].length;

/** How long until another message is allowed, given your accepted messages' times (0 = now). */
export function rateWaitMs(sent: readonly number[], now: number): number {
  const recent = sent.filter((t) => t > now - CHAT_RATE.windowMs).sort((a, b) => a - b);
  if (recent.length < CHAT_RATE.messages) return 0;
  return recent[recent.length - CHAT_RATE.messages]! + CHAT_RATE.windowMs - now;
}

export interface ComposerStatus {
  readonly length: number;
  readonly empty: boolean;
  /** Over CHAT_MAX_CHARS. */
  readonly over: boolean;
  /** Show the counter. */
  readonly warn: boolean;
  /** ms to wait before sending (rate limit), 0 if none. */
  readonly waitMs: number;
  readonly canSend: boolean;
  /** One line for the status row, or null. */
  readonly note: string | null;
}

// The server's text rules (apps/server chat.ts checkChatText, settings.ts
// hasVisibleText), so Send stays off for text it would refuse anyway.
/** Letters that draw nothing: the Hangul fillers and the braille blank. */
const BLANK_LETTERS = /[\u115f\u1160\u2800\u3164\uffa0]/gu;
const hasVisibleText = (text: string) =>
  text.normalize("NFKC").replace(/\p{Default_Ignorable_Code_Point}/gu, "").replace(BLANK_LETTERS, "").replace(/[\p{Cf}\p{M}\s]/gu, "").length > 0;
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const MARK_RUN = new RegExp(`\\p{M}{${CHAT_MAX_MARKS + 1},}`, "u");
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Cf}]/gu;

export function composerStatus(text: string, sent: readonly number[], now: number): ComposerStatus {
  const length = chatLength(text);
  const normalised = text.replace(/\r\n?/g, "\n").trim();
  const empty = !hasVisibleText(normalised);
  const over = length > CHAT_MAX_CHARS;
  const bad = !empty && BAD_CHARS.test(normalised) ? "Control or text-direction characters can't be sent." : !empty && MARK_RUN.test(normalised.replace(INVISIBLE, "")) ? "Too many accents on one character." : null;
  const waitMs = rateWaitMs(sent, now);
  const note = over
    ? `Too long by ${length - CHAT_MAX_CHARS}: messages are at most ${CHAT_MAX_CHARS} characters.`
    : bad
      ? bad
      : waitMs > 0
      ? `Slow down: ${CHAT_RATE.messages} messages per ${CHAT_RATE.windowMs / 1000} s. Send again in ${Math.ceil(waitMs / 1000)} s.`
      : null;
  return { length, empty, over, warn: length >= CHAT_WARN_AT, waitMs, canSend: !empty && !over && !bad && waitMs === 0, note };
}

// ---------- Evidence cards ----------

/** The case-file event a card was copied from, as the sender saw it (for describeEvent). */
const cardEvent = (card: EvidenceCard, from: PlayerId): GameEvent =>
  ({ ...card.payload, type: card.type, visibility: { kind: "private", player: from } }) as unknown as GameEvent;

/** One line for a shared card, from the reader's side ("Dez saw…"); a plain fallback for a type this client doesn't know. */
export function cardText(card: EvidenceCard, from: PlayerId, ctx: DescribeContext): string {
  try {
    const text = describeEvent(cardEvent(card, from), ctx);
    // describeEvent's exhaustive fallback is the bare type name (one word).
    if (text && text.includes(" ") && !/undefined|\[object/.test(text)) return text;
  } catch {
    // An entry this build can't read: fall through.
  }
  return `A case-file entry (${card.type}).`;
}

/**
 * Your case-file entries you could share, newest first. Mirrors the server's
 * refusals (apps/server chat.ts evidenceCard) so the picker doesn't offer
 * them: role cards (anything stating a role or faction, design §8), secret
 * ballots, sealed votes, and ballots of a meeting still open. design §11.2
 */
export function shareableEntries(view: Pick<PlayerView, "caseFile" | "ledger">): LoggedEvent<CaseFileEvent>[] {
  const closed = new Set(view.ledger.flatMap((e) => (e.event.type === "meetingClosed" ? [e.event.meetingId] : [])));
  return view.caseFile
    .filter(({ event }) => {
      if (revealsRole(event)) return false;
      if (event.visibility.kind === "secret") return false;
      if (event.type === "voteSealed") return false;
      if (event.type === "voteCast") return closed.has(event.meetingId);
      return true;
    })
    .reverse();
}

/** "14:05" in the reader's locale. */
export const chatTime = (iso: string): string => {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? "" : t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

/**
 * Public events worth a line in the crew feed (ui-style "Chat": game events as
 * compact rows). Setup and per-player chatter (alibis, proposals) stay in the
 * ledger only, so the feed doesn't drown the talk.
 */
const QUIET_EVENTS: ReadonlySet<string> = new Set(["gameCreated", "roomsSet", "bankFilled", "roundStarted", "alibiPosted", "alibisClosed", "meetingProposed", "meetingProposalAccepted", "moveLocked"]);
export const feedWorthy = (event: GameEvent): boolean => event.visibility.kind === "public" && !QUIET_EVENTS.has(event.type);
