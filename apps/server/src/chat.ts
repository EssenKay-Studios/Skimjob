// In-game chat: crew chat, DMs and evidence cards. design §12.1; docs/m2-plan.md M2-8
//
// Server-side only (not engine events): messages live in `chat_messages` and
// go out over the game socket (live.ts).
// - The sender is always the socket's seat, never a field of the message.
// - A DM reaches only its two players' sockets. Everyone else gets
//   `dmNotice { from, to, at }` when the host's `dmNotices` setting is on, and
//   nothing at all when it is off (no frame, so not even its timing shows).
// - An evidence card names one entry of the sender's own case file by `seq`;
//   the server re-reads it from their `viewFor`, copies `type` + payload (the
//   event without `type`, `visibility` or `seq`) and marks it verified. Typed
//   text is never verified. Secret-mode ballots can't be shared (decisions.md),
//   nor can anything that states a role or faction (engine `revealsRole`).
//   "Verified" means only "from their own case file": a camera feed can be
//   false (Hacker loop, Forger's planted sighting), so the client shows the
//   card with the web's `EVIDENCE_CARD_NOTE` (design §12.1, v2 §2).
// - Text is plain text: stored and sent as typed. Clients must render it as
//   text, never as HTML.
import { revealsRole, viewFor, type GameState, type PlayerId, type PlayerView } from "@skimjob/engine";
import type { Clock } from "./clock";
import type { Db } from "./db";
import { CHAT_HISTORY_LIMIT, CHAT_MAX_CHARS, CHAT_MAX_MARKS, CHAT_RATE, hasVisibleText } from "./settings";

/** A shared case-file entry: the event's type and fields, without seq or visibility. */
export interface EvidenceCard {
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

interface ChatBase {
  /** Random (never a counter, which would count others' DMs). */
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
  /** Crew messages and your own DMs, oldest first (the latest CHAT_HISTORY_LIMIT). */
  readonly messages: readonly ChatMessage[];
  /** Others' DMs, as notices, oldest first; empty when the host turned notices off. */
  readonly dmNotices: readonly DmNotice[];
}

/** What a client asked to post: `{ chat: { to?, text } }` or `{ chat: { to?, evidence: seq } }`. */
export type ChatRequest = { readonly to: PlayerId | null } & ({ readonly text: string } | { readonly evidence: number });

type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

// Control characters other than newline and tab, and bidi controls (they can
// make a line read as something else).
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/u;

/** A run of more than CHAT_MAX_MARKS combining marks, ignoring invisible characters in between. */
const MARK_RUN = new RegExp(`\\p{M}{${CHAT_MAX_MARKS + 1},}`, "u");
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Cf}]/gu;

/**
 * Typed text: trimmed, CRLF → LF, 1–CHAT_MAX_CHARS characters, something
 * visible in it (the nickname rule: invisible-only text is empty), no control
 * characters, no long stacks of combining marks.
 */
export function checkChatText(input: unknown): Result<string> {
  if (typeof input !== "string") return { ok: false, reason: "text must be a string" };
  const text = input.replace(/\r\n?/g, "\n").trim();
  if (!hasVisibleText(text)) return { ok: false, reason: "message is empty" };
  if (MARK_RUN.test(text.replace(INVISIBLE, ""))) return { ok: false, reason: "too many accents on one character" };
  if ([...text].length > CHAT_MAX_CHARS) return { ok: false, reason: `messages are at most ${CHAT_MAX_CHARS} characters` };
  if (BAD_CHARS.test(text)) return { ok: false, reason: "message has control characters" };
  return { ok: true, value: text };
}

/** The `chat` field of a client message, or why not. Unknown fields (a forged `from`) are refused. */
export function parseChatRequest(chat: unknown): Result<ChatRequest> {
  if (typeof chat !== "object" || chat === null || Array.isArray(chat)) return { ok: false, reason: "expected { chat: { text } }" };
  const raw = chat as Record<string, unknown>;
  for (const k of Object.keys(raw)) if (k !== "to" && k !== "text" && k !== "evidence") return { ok: false, reason: `unknown chat field ${JSON.stringify(k)}` };
  const to = raw.to ?? null;
  if (to !== null && typeof to !== "string") return { ok: false, reason: "to must be a player id" };
  const hasText = Object.hasOwn(raw, "text");
  if (hasText === Object.hasOwn(raw, "evidence")) return { ok: false, reason: "send either text or evidence" };
  if (hasText) {
    const text = checkChatText(raw.text);
    return text.ok ? { ok: true, value: { to, text: text.value } } : text;
  }
  if (!Number.isSafeInteger(raw.evidence)) return { ok: false, reason: "evidence must be the seq of one of your case-file entries" };
  return { ok: true, value: { to, evidence: raw.evidence as number } };
}

/**
 * The card for entry `seq` of the case file in `view` (the sender's own,
 * re-read by the server, never sent by the client), without seq or visibility. design §12.1
 */
export function evidenceCard(view: PlayerView, seq: number): Result<EvidenceCard> {
  const entry = view.caseFile.find((e) => e.seq === seq);
  if (!entry) return { ok: false, reason: "that isn't an entry of your case file" };
  const event = entry.event;
  // design §8: roles are claimed "truthfully or as a bluff"; a verified role
  // card (your deal, a Peek, an Inside tip, allies) would end bluffing.
  if (revealsRole(event)) return { ok: false, reason: "role cards can't be shared: role claims stay unverified" };
  // design §11.2: a secret ballot stays secret, so it can't be made provable either.
  if (event.visibility.kind === "secret") return { ok: false, reason: "secret ballots can't be shared" };
  // design §11.2 hidden-then-revealed: no proving a ballot while its vote is
  // open. A ballot cast in a meeting can be shared once that meeting closed;
  // a sealed vote is a ballot for a meeting still to come, so never (its cast
  // ballot can be, after the meeting).
  if (event.type === "voteSealed") return { ok: false, reason: "sealed votes can't be shared" };
  if (event.type === "voteCast" && !view.ledger.some((e) => e.event.type === "meetingClosed" && e.event.meetingId === event.meetingId)) {
    return { ok: false, reason: "ballots can be shared once the meeting has closed" };
  }
  const { type, visibility: _visibility, ...payload } = event;
  return { ok: true, value: { type, payload } };
}

/** Who a DM may go to: another human player of this game. */
function checkRecipient(state: GameState, from: PlayerId, to: PlayerId): string | null {
  const seat = state.config.players.find((p) => p.id === to);
  if (!seat) return "no such player";
  if (to === from) return "you can't message yourself";
  if (seat.isBot) return "bots don't read messages";
  return null;
}

interface Row {
  id: string;
  from_player: string;
  to_player: string | null;
  sent_at: Date | string;
  text: string | null;
  card: EvidenceCard | string | null;
}
const iso = (t: Date | string) => new Date(t).toISOString();
const toMessage = (r: Row): ChatMessage => {
  const base = { id: r.id, from: r.from_player, to: r.to_player, at: iso(r.sent_at) };
  if (r.card === null) return { ...base, text: r.text ?? "", verified: false };
  return { ...base, card: typeof r.card === "string" ? (JSON.parse(r.card) as EvidenceCard) : r.card, verified: true };
};

export interface Chat {
  /** Checks, rate-limits and stores one message from `from`. The caller delivers it. */
  post(gameId: string, state: GameState, from: PlayerId, request: ChatRequest): Promise<Result<{ message: ChatMessage; notice: DmNotice | null }>>;
  /** What `player` gets on (re)connect: crew chat, their own DMs, and notices of others' DMs if on. */
  history(gameId: string, player: PlayerId): Promise<ChatHistory>;
  /** Senders the rate limiter still remembers (tests: stale ones are dropped). */
  rateTracked(): number;
}

export function createChat(db: Db, clock: Clock): Chat {
  /** Per game and player, the times of their recent accepted messages. Memory only. */
  const recent = new Map<string, number[]>();
  let lastSweep = clock.now();
  /** At most once a window, forgets senders with nothing left in it (ended games, people gone quiet). */
  const sweep = (now: number) => {
    if (now - lastSweep < CHAT_RATE.windowMs) return;
    lastSweep = now;
    for (const [key, times] of recent) if (times.every((t) => t <= now - CHAT_RATE.windowMs)) recent.delete(key);
  };

  const dmNoticesOn = async (gameId: string) => {
    const [row] = await db.query<{ on: boolean | null }>("select (settings->>'dmNotices')::boolean as on from games where id = $1", [gameId]);
    return row?.on ?? true; // design §12.1: on by default
  };

  return {
    rateTracked: () => recent.size,
    async post(gameId, state, from, request) {
      if (request.to !== null) {
        const bad = checkRecipient(state, from, request.to);
        if (bad) return { ok: false, reason: bad };
      }
      let text: string | null = null;
      let card: EvidenceCard | null = null;
      if ("text" in request) text = request.text;
      else {
        const c = evidenceCard(viewFor(state, from), request.evidence);
        if (!c.ok) return c;
        card = c.value;
      }
      const now = clock.now();
      sweep(now);
      const key = `${gameId}\0${from}`;
      const times = (recent.get(key) ?? []).filter((t) => t > now - CHAT_RATE.windowMs);
      if (times.length >= CHAT_RATE.messages) return { ok: false, reason: "slow down: too many messages" };
      recent.set(key, [...times, now]);
      const [row] = await db.query<Row>(
        "insert into chat_messages (game_id, from_player, to_player, sent_at, text, card) values ($1, $2, $3, $4, $5, $6) returning id, from_player, to_player, sent_at, text, card",
        [gameId, from, request.to, new Date(now), text, card === null ? null : JSON.stringify(card)],
      );
      const message = toMessage(row!);
      const notice = message.to !== null && (await dmNoticesOn(gameId)) ? { from: message.from, to: message.to, at: message.at } : null;
      return { ok: true, value: { message, notice } };
    },

    async history(gameId, player) {
      const rows = await db.query<Row>(
        `select id, from_player, to_player, sent_at, text, card from chat_messages
         where game_id = $1 and (to_player is null or from_player = $2 or to_player = $2)
         order by n desc limit $3`,
        [gameId, player, CHAT_HISTORY_LIMIT],
      );
      const notices = (await dmNoticesOn(gameId))
        ? await db.query<Pick<Row, "from_player" | "to_player" | "sent_at">>(
            `select from_player, to_player, sent_at from chat_messages
             where game_id = $1 and to_player is not null and from_player <> $2 and to_player <> $2
             order by n desc limit $3`,
            [gameId, player, CHAT_HISTORY_LIMIT],
          )
        : [];
      return {
        messages: rows.reverse().map(toMessage),
        dmNotices: notices.reverse().map((r) => ({ from: r.from_player, to: r.to_player!, at: iso(r.sent_at) })),
      };
    },
  };
}
