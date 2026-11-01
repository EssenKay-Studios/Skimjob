// The chat on the game screen (M2-8b): a side panel from 1024 px, and below
// that a "Chat" button (with the unread count) that opens it as a sheet:
// full screen on phones, a bottom sheet on tablets. Read marks are kept per
// game in localStorage. design §12.1, ui-style §10, docs/m2-plan.md M2-8
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlayerView } from "@skimjob/engine";
import { Button } from "../components/Button";
import { ChatBadge, ChatPanel, type ChatPerson } from "../components/Chat";
import { Bubble } from "../components/icons";
import { feedWorthy, markRead, shareableEntries, totalUnread, type FeedEvent, type ReadState, type ThreadId } from "../game/chat";
import { describeEvent } from "../game/describeEvent";
import { namesOf, seatsOf } from "../game/hud";
import type { GameChannel } from "../game/useGame";

/** The side panel takes over from here (docs: "on 1024+ px it is a side panel"). */
export const CHAT_DOCK_QUERY = "(min-width: 1024px)";

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const f = () => setOn(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, [query]);
  return on;
}

const readKey = (gameId: string) => `skimjob:chat-read:${gameId}`;

/** Per-thread read marks, kept across reloads (best effort: private mode may refuse storage). */
function useChatRead(gameId: string): [ReadState, (thread: ThreadId, at: string) => void] {
  const [read, setRead] = useState<ReadState>(() => {
    try {
      const raw = localStorage.getItem(readKey(gameId));
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      return typeof parsed === "object" && parsed !== null ? (parsed as ReadState) : {};
    } catch {
      return {};
    }
  });
  const onRead = useCallback(
    (thread: ThreadId, at: string) =>
      setRead((r) => {
        const next = markRead(r, thread, at);
        if (next !== r) {
          try {
            localStorage.setItem(readKey(gameId), JSON.stringify(next));
          } catch {
            // Storage full or refused: the marks last until the page closes.
          }
        }
        return next;
      }),
    [gameId],
  );
  return [read, onRead];
}

/** Public events that arrive while the screen is open, stamped on the server's clock, for the crew feed. */
function useLiveEvents(view: PlayerView, offset: number): readonly FeedEvent[] {
  const seen = useRef<number | null>(null);
  const [events, setEvents] = useState<readonly FeedEvent[]>([]);
  useEffect(() => {
    const top = view.ledger.reduce((n, e) => Math.max(n, e.seq), 0);
    if (seen.current === null) {
      seen.current = top;
      return;
    }
    const since = seen.current;
    seen.current = Math.max(since, top);
    const fresh = view.ledger.filter((e) => e.seq > since && feedWorthy(e.event));
    if (fresh.length === 0) return;
    const at = new Date(Date.now() + offset).toISOString();
    const name = namesOf(view);
    setEvents((xs) => [...xs, ...fresh.map((e) => ({ key: String(e.seq), at, text: describeEvent(e.event, { me: view.me.id, name }) }))].slice(-60));
  }, [view, offset]);
  return events;
}

export function GameChat({ gameId, view, channel, dmNotices }: { gameId: string; view: PlayerView; channel: GameChannel; dmNotices: boolean }) {
  const docked = useMedia(CHAT_DOCK_QUERY);
  const [open, setOpen] = useState(false);
  const [focusKey, setFocusKey] = useState(0);
  const [read, onRead] = useChatRead(gameId);
  const events = useLiveEvents(view, channel.offset);
  const me = view.me.id;
  const people = useMemo<ChatPerson[]>(() => seatsOf(view).map((s) => ({ id: s.id, name: s.name, isBot: s.isBot })), [view]);
  const evidence = useMemo(() => {
    const name = namesOf(view);
    return shareableEntries(view)
      .slice(0, 40)
      .map((e) => ({ seq: e.seq, text: describeEvent(e.event, { me, name }) }));
  }, [view, me]);
  const unread = totalUnread(channel.chat, me, read);
  const sheet = !docked;

  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".chat-fab")?.focus());
  }, []);
  useEffect(() => {
    if (!sheet || !open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    document.documentElement.classList.add("chat-sheet-open");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("chat-sheet-open");
    };
  }, [sheet, open, close]);

  return (
    <>
      <div
        className={sheet ? "chat-dock is-sheet" : "chat-dock is-docked"}
        hidden={sheet && !open}
        {...(sheet && { role: "dialog", "aria-modal": true, "aria-label": "Chat" })}
      >
        {sheet && <div className="chat-dock__scrim" aria-hidden="true" onClick={close} />}
        <ChatPanel
          me={me}
          people={people}
          chat={channel.chat}
          read={read}
          onRead={onRead}
          send={channel.sendChat}
          connection={channel.connection}
          evidence={evidence}
          events={events}
          dmNotices={dmNotices}
          visible={docked || open}
          focusKey={focusKey}
          className="chat-dock__panel"
          {...(sheet && { onClose: close })}
        />
      </div>
      {sheet && !open && (
        <Button
          variant="primary"
          seed="chat-fab"
          className="chat-fab"
          icon={<Bubble />}
          aria-label={`Open chat${unread > 0 ? `, ${unread} unread` : ""}`}
          onClick={() => {
            setOpen(true);
            setFocusKey((k) => k + 1);
          }}
        >
          Chat
          <ChatBadge count={unread} />
        </Button>
      )}
    </>
  );
}
