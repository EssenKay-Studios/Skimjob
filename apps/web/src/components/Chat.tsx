// The chat panel (M2-8b, ui-style "Chat"): a Crew tab plus one tab per DM,
// a feed of chirp-style messages with DM notices, evidence cards and game
// events inline, and a composer with the server's length and rate limits.
// Message text is always a React text node: never HTML, never markdown.
// design §12.1, docs/m2-plan.md M2-8
import { useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { PlayerId } from "@skimjob/engine";
import type { DescribeContext } from "../game/describeEvent";
import {
  cardText,
  CHAT_MAX_CHARS,
  chatTime,
  composerStatus,
  dmPartners,
  dmThread,
  feedFor,
  latestAt,
  noticeText,
  partnerOf,
  unreadCount,
  type ChatMessage,
  type ChatRequest,
  type ChatState,
  type EvidenceCard,
  type FeedEvent,
  type FeedItem,
  type ReadState,
  type ThreadId,
} from "../game/chat";
import type { Connection, Reply } from "../game/useGame";
import { sentence } from "../api";
import { Avatar } from "./Avatar";
import { Button } from "./Button";
import { Bubble, Close, Evidence, Plus, Send } from "./icons";
import { FrameArt, SketchFrame, useElementSize } from "./SketchFrame";
import { Underline } from "./Underline";
import "./chat.css";

export interface ChatPerson {
  readonly id: PlayerId;
  readonly name: string;
  readonly isBot: boolean;
}

/** A case-file entry the picker offers as an evidence card. */
export interface ShareableEntry {
  readonly seq: number;
  readonly text: string;
}

const plainName = (name: string) => name.replace(/^Bot · /, "");

/** A clay count badge (unread messages). Nothing at 0. */
export function ChatBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="chat-badge num" aria-hidden="true">
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** A shared case-file entry: verified by the app, and honest that cameras can be fooled. design §12.1 */
export function EvidenceCardView({ card, from, ctx, seed }: { card: EvidenceCard; from: PlayerId; ctx: DescribeContext; seed: string }) {
  const mine = from === ctx.me;
  return (
    <SketchFrame seed={seed} radius={12} shadow={0.35} grain={false} fill="var(--manilla)" className="evidence" role="group" aria-label="Evidence card, verified">
      <p className="evidence__stamp">
        <span className="evidence__icon" aria-hidden="true">
          <Evidence />
        </span>
        Verified case file
      </p>
      <p className="evidence__text">{cardText(card, from, ctx)}</p>
      <p className="meta evidence__note">
        The app really showed this to {mine ? "you" : ctx.name(from)}. Cameras can be tampered with.
      </p>
    </SketchFrame>
  );
}

type FeedCtx = DescribeContext & { readonly bot: (p: PlayerId) => boolean; readonly seatName: (p: PlayerId) => string };

function MessageRow({ m, ctx }: { m: ChatMessage; ctx: FeedCtx }) {
  const mine = m.from === ctx.me;
  const name = ctx.name(m.from);
  return (
    <li className={mine ? "chat-msg is-mine" : "chat-msg"}>
      <Avatar name={plainName(ctx.seatName(m.from))} size={32} bot={ctx.bot(m.from)} title={mine ? "You" : name} />
      <div className="chat-msg__body">
        <p className="chat-msg__meta">
          <span className="chat-msg__name">{mine ? "You" : name}</span>
          <time className="meta" dateTime={m.at}>
            {chatTime(m.at)}
          </time>
        </p>
        {m.verified ? <EvidenceCardView card={m.card} from={m.from} ctx={ctx} seed={`ev-${m.id}`} /> : <p className="chat-msg__text">{m.text}</p>}
      </div>
    </li>
  );
}

function FeedRow({ item, ctx }: { item: FeedItem; ctx: FeedCtx }) {
  if (item.kind === "message") return <MessageRow m={item.message} ctx={ctx} />;
  if (item.kind === "notice") {
    return (
      <li className="chat-note">
        <span className="chat-note__icon" aria-hidden="true">
          <Bubble />
        </span>
        <span>
          {noticeText(item.notice, ctx.name, item.mutual)}
          {item.count > 1 && <span className="num"> ×{item.count}</span>}
        </span>
        <time className="meta" dateTime={item.at}>
          {chatTime(item.at)}
        </time>
      </li>
    );
  }
  return (
    <li className="chat-event">
      <span className="chat-event__dot" aria-hidden="true" />
      <span>{item.text}</span>
    </li>
  );
}

/** Whether the page is in front (a hidden tab doesn't mark anything read). */
function usePageVisible(): boolean {
  const [on, setOn] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const f = () => setOn(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", f);
    return () => document.removeEventListener("visibilitychange", f);
  }, []);
  return on;
}

export interface ChatPanelProps {
  readonly me: PlayerId;
  /** Everyone at the table, you included. */
  readonly people: readonly ChatPerson[];
  readonly chat: ChatState;
  readonly read: ReadState;
  readonly onRead: (thread: ThreadId, at: string) => void;
  readonly send: (req: ChatRequest) => Promise<Reply>;
  readonly connection: Connection;
  /** Your case-file entries that can be shared, newest first. */
  readonly evidence: readonly ShareableEntry[];
  /** Public game events seen arriving, for the crew feed. */
  readonly events?: readonly FeedEvent[];
  /** Whether others are told that a DM happened (the host's setting). */
  readonly dmNotices?: boolean;
  /** On screen now (the side panel, or the open sheet): new messages count as read. */
  readonly visible: boolean;
  /** Shown as a close button (the phone / tablet sheet). */
  readonly onClose?: () => void;
  /** Focus the composer when this changes (the sheet opening). */
  readonly focusKey?: number;
  readonly className?: string;
}

export function ChatPanel(props: ChatPanelProps) {
  const { me, people, chat, read, onRead, send, connection, evidence, events = [], dmNotices = true, visible, onClose, focusKey, className } = props;
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const ctx = useMemo(
    () => ({
      me,
      name: (p: PlayerId) => (p === me ? "You" : (byId.get(p)?.name ?? p)),
      seatName: (p: PlayerId) => byId.get(p)?.name ?? p,
      bot: (p: PlayerId) => byId.get(p)?.isBot ?? false,
    }),
    [me, byId],
  );
  const [thread, setThread] = useState<ThreadId>("crew");
  const [opened, setOpened] = useState<readonly PlayerId[]>([]);
  const [picker, setPicker] = useState<"none" | "dm" | "evidence">("none");
  const partners = dmPartners(chat, me, opened);
  const partner = partnerOf(thread);
  const humans = people.filter((p) => p.id !== me && !p.isBot);
  const items = useMemo(() => feedFor(chat, thread, me, events), [chat, thread, me, events]);
  const pageVisible = usePageVisible();
  const composer = useRef<HTMLTextAreaElement>(null);
  const sent = useRef<number[]>([]);
  const headId = useId();

  // ---- scrolling: follow the latest unless you've scrolled up to read ----
  const feed = useRef<HTMLOListElement>(null);
  const atBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [newBelow, setNewBelow] = useState(false);
  const lastThread = useRef<ThreadId | null>(null);
  const wasVisible = useRef(false);
  const last = items.at(-1);
  const toEnd = () => {
    const el = feed.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottomRef.current = true;
    setAtBottom(true);
    setNewBelow(false);
  };
  useLayoutEffect(() => {
    const jump = lastThread.current !== thread || (visible && !wasVisible.current);
    lastThread.current = thread;
    wasVisible.current = visible;
    const mine = last?.kind === "message" && last.message.from === me;
    if (jump || atBottomRef.current || mine) toEnd();
    else if (last) setNewBelow(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.key, thread, visible]);
  const onScroll = () => {
    const el = feed.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    atBottomRef.current = bottom;
    setAtBottom(bottom);
    if (bottom) setNewBelow(false);
  };

  // ---- read marks: what you can see at the bottom of an on-screen feed ----
  const latest = latestAt(chat, thread, me);
  useEffect(() => {
    if (visible && pageVisible && atBottom && latest) onRead(thread, latest);
  }, [visible, pageVisible, atBottom, latest, thread, onRead]);

  useEffect(() => {
    if (focusKey) composer.current?.focus({ preventScroll: true });
  }, [focusKey]);

  const openThread = (t: ThreadId) => {
    setThread(t);
    setPicker("none");
  };
  const startDm = (p: PlayerId) => {
    setOpened((xs) => (xs.includes(p) ? xs : [...xs, p]));
    openThread(dmThread(p));
    composer.current?.focus({ preventScroll: true });
  };

  const threadName = partner ? ctx.name(partner) : "the crew";
  return (
    <SketchFrame as="section" seed="chat-panel" radius={18} shadow={0.5} className={["chat", className].filter(Boolean).join(" ")} aria-labelledby={headId}>
      <div className="chat__head">
        <h2 id={headId} className="chat__title">
          <Underline seed="chat">Chat</Underline>
        </h2>
        {onClose && <Button variant="small" seed="chat-close" icon={<Close />} aria-label="Close chat" onClick={onClose} />}
      </div>

      <div className="chat__tabs" role="group" aria-label="Conversations">
        <ThreadTab label="Crew" unread={unreadCount(chat, "crew", me, read)} on={thread === "crew"} onClick={() => openThread("crew")} seed="tab-crew" />
        {partners.map((p) => (
          <ThreadTab key={p} label={ctx.name(p)} unread={unreadCount(chat, dmThread(p), me, read)} on={thread === dmThread(p)} onClick={() => openThread(dmThread(p))} seed={`tab-${p}`} dm />
        ))}
        <Button variant="small" seed="chat-new-dm" icon={<Plus />} aria-expanded={picker === "dm"} onClick={() => setPicker(picker === "dm" ? "none" : "dm")}>
          DM
        </Button>
      </div>

      {picker === "dm" && (
        <div className="chat__picker" role="group" aria-label="Message a player privately">
          {humans.length === 0 ? (
            <p className="meta">Nobody to DM: everyone else here is a bot, and bots don't read messages.</p>
          ) : (
            humans.map((p) => (
              <Button key={p.id} variant="secondary" seed={`dm-${p.id}`} className="chat__person" onClick={() => startDm(p.id)}>
                <Avatar name={plainName(p.name)} size={26} title={p.name} />
                <span className="chat__ellipsis">{p.name}</span>
              </Button>
            ))
          )}
        </div>
      )}

      <p className="meta chat__note">
        {partner
          ? `Only you and ${threadName} see what's said here.${dmNotices ? " The crew sees that you two are talking." : ""}`
          : "Everyone in the crew sees this. Typed claims aren't proof: share evidence for that."}
      </p>
      {connection !== "open" && (
        <p className="chat__conn" role="status">
          {connection === "signedOut" ? "Signed out: sign in again to chat." : "Connection lost. Trying again; you'll catch up on anything missed."}
        </p>
      )}

      <div className="chat__feed-wrap">
        <ol ref={feed} className="chat__feed" onScroll={onScroll} aria-label={partner ? `Messages with ${threadName}` : "Crew messages"} aria-live="polite" tabIndex={0}>
          {items.map((item) => (
            <FeedRow key={item.key} item={item} ctx={ctx} />
          ))}
          {items.length === 0 && (
            <li className="chat__empty meta">{!chat.loaded ? "Loading the chat…" : partner ? `Nothing yet. Say something to ${threadName}.` : "No messages yet. Say hi to the crew."}</li>
          )}
        </ol>
        {newBelow && !atBottom && (
          <Button variant="small" seed="chat-jump" className="chat__jump" onClick={toEnd}>
            New messages ↓
          </Button>
        )}
      </div>

      <Composer
        key={thread}
        inputRef={composer}
        sent={sent}
        to={partner}
        toName={threadName}
        send={send}
        online={connection === "open"}
        evidence={evidence}
        picking={picker === "evidence"}
        onPick={(on) => setPicker(on ? "evidence" : "none")}
      />
    </SketchFrame>
  );
}

function ThreadTab({ label, unread, on, onClick, seed, dm }: { label: string; unread: number; on: boolean; onClick: () => void; seed: string; dm?: boolean }) {
  return (
    <Button variant="toggle" seed={seed} pressed={on} onClick={onClick} className="chat__tab">
      <span className="chat__ellipsis">{label}</span>
      <ChatBadge count={unread} />
      <span className="visually-hidden">
        {dm ? " (direct message)" : ""}
        {unread > 0 ? `, ${unread} unread` : ""}
      </span>
    </Button>
  );
}

interface ComposerProps {
  readonly inputRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Times of your accepted messages, shared by every thread (the server's limit is per player). */
  readonly sent: React.RefObject<number[]>;
  readonly to: PlayerId | null;
  readonly toName: string;
  readonly send: (req: ChatRequest) => Promise<Reply>;
  readonly online: boolean;
  readonly evidence: readonly ShareableEntry[];
  readonly picking: boolean;
  readonly onPick: (on: boolean) => void;
}

function Composer({ inputRef, sent, to, toName, send, online, evidence, picking, onPick }: ComposerProps) {
  const id = useId();
  const sentTimes = sent.current;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const [boxRef, size] = useElementSize<HTMLDivElement>();
  const status = composerStatus(text, sentTimes, Date.now());
  // Re-check when the rate-limit wait runs out.
  useEffect(() => {
    if (status.waitMs <= 0) return;
    const t = setTimeout(tick, Math.min(status.waitMs, 1000));
    return () => clearTimeout(t);
  });

  const post = async (req: ChatRequest): Promise<boolean> => {
    setBusy(true);
    setError(null);
    const r = await send(req);
    setBusy(false);
    if (!r.ok) {
      setError(sentence(r.reason));
      return false;
    }
    sentTimes.push(Date.now());
    while (sentTimes.length > 50) sentTimes.shift();
    return true;
  };
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!status.canSend || busy || !online) return;
    if (await post({ to, text })) {
      setText("");
      inputRef.current?.focus({ preventScroll: true });
    }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };
  const share = async (seq: number) => {
    if (busy || !online || status.waitMs > 0) return;
    if (await post({ to, evidence: seq })) onPick(false);
  };

  const note = error ?? status.note;
  const counter = status.warn || status.over;
  return (
    <form className="chat__composer" onSubmit={submit}>
      {picking && (
        <div className="chat__evidence" role="group" aria-label="Share a case-file entry">
          <p className="meta">Share a case-file entry with {toName}. It shows as verified.</p>
          {evidence.length === 0 ? (
            <p className="meta">Your case file is empty so far.</p>
          ) : (
            <ul className="chat__evidence-list">
              {evidence.map((e) => (
                <li key={e.seq}>
                  <Button variant="ghost" seed={`pick-${e.seq}`} className="chat__evidence-pick" disabled={busy || !online || status.waitMs > 0} onClick={() => void share(e.seq)}>
                    {e.text}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="chat__compose-row">
        <Button variant="small" seed="chat-evidence" icon={<Evidence />} aria-label="Share evidence" aria-expanded={picking} pressed={picking} onClick={() => onPick(!picking)} />
        <div className={status.over ? "chat__box is-over" : "chat__box"} ref={boxRef}>
          {size && <FrameArt w={size.w} h={size.h} seed="chat-box" radius={10} wobble={0.8} stroke={1.3} shadow={0} grain={false} />}
          <label className="visually-hidden" htmlFor={`${id}-in`}>
            {to ? `Message ${toName}` : "Message the crew"}
          </label>
          <textarea
            id={`${id}-in`}
            ref={inputRef}
            className="chat__input"
            rows={1}
            value={text}
            placeholder={to ? `Message ${toName}…` : "Message the crew…"}
            aria-describedby={`${id}-st`}
            aria-invalid={status.over}
            onChange={(e) => {
              setText(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={onKey}
          />
        </div>
        <Button type="submit" variant="primary" seed="chat-send" icon={<Send />} className="chat__send" aria-label="Send" disabled={!status.canSend || busy || !online} />
      </div>
      <p id={`${id}-st`} className={note ? "chat__status is-bad" : "chat__status"} aria-live="polite">
        <span>{note ?? (online ? "Enter to send · Shift+Enter for a new line" : "Offline: sending is paused.")}</span>
        {counter && (
          <span className={status.over ? "num chat__count is-over" : "num chat__count"}>
            {status.length}/{CHAT_MAX_CHARS}
          </span>
        )}
      </p>
    </form>
  );
}
