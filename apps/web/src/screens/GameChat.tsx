// The chat on the game screen (M2-8b): a panel of the game shell, a side tab
// from 1024 px and a bottom sheet below that. Read marks are kept per game in
// localStorage. design §12.1, ui-style §10, docs/m2-plan.md M2-8
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlayerView } from "@skimjob/engine";
import { ChatPanel, type ChatDrafts, type ChatPerson } from "../components/Chat";
import { feedWorthy, markRead, mergeRead, shareableEntries, totalUnread, type FeedEvent, type ReadState, type ThreadId } from "../game/chat";
import { describeEvent } from "../game/describeEvent";
import { namesOf, seatsOf } from "../game/hud";
import type { GameChannel } from "../game/useGame";

/** Per game and seat, so a shared device doesn't mix two players' marks. */
const readKey = (gameId: string, player: string) => `skimjob:chat-read:${gameId}:${player}`;

function loadRead(key: string): ReadState {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as ReadState) : {};
  } catch {
    return {};
  }
}

/**
 * Per-thread read marks, kept across reloads and shared by every tab of the
 * same player: each write merges with what's stored (latest mark per thread
 * wins) and other tabs' writes are merged in as they happen, so a thread read
 * in one tab never turns unread again in another (QA, PR #38).
 */
function useChatRead(gameId: string, player: string): [ReadState, (thread: ThreadId, at: string) => void] {
  const key = readKey(gameId, player);
  const [read, setRead] = useState<ReadState>(() => loadRead(key));
  useEffect(() => {
    setRead((r) => mergeRead(r, loadRead(key)));
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) setRead((r) => mergeRead(r, loadRead(key)));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);
  const onRead = useCallback(
    (thread: ThreadId, at: string) =>
      setRead((r) => {
        const next = markRead(r, thread, at);
        if (next === r) return r;
        // Merge with the stored marks (another tab may have written since) before writing back.
        const merged = mergeRead(loadRead(key), next);
        try {
          localStorage.setItem(key, JSON.stringify(merged));
        } catch {
          // Storage full or refused: the marks last until the page closes.
        }
        return merged;
      }),
    [key],
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

/** The chat panel for the game shell, and the unread count for its tab (the read marks and the feed live here, so they follow the game while the panel is closed). */
export function useGameChat({ gameId, view, channel, dmNotices }: { gameId: string; view: PlayerView; channel: GameChannel; dmNotices: boolean }) {
  const [read, onRead] = useChatRead(gameId, view.me.id);
  // Held here, not in the panel: the shell unmounts the panel when its sheet closes or a meeting takes the sheet.
  const [drafts, setDrafts] = useState<ChatDrafts>({});
  const onDraft = useCallback((thread: ThreadId, text: string) => setDrafts((d) => ({ ...d, [thread]: text })), []);
  const events = useLiveEvents(view, channel.offset);
  const me = view.me.id;
  const people = useMemo<ChatPerson[]>(() => seatsOf(view).map((s) => ({ id: s.id, name: s.name, isBot: s.isBot })), [view]);
  const evidence = useMemo(() => {
    const name = namesOf(view);
    return shareableEntries(view)
      .slice(0, 40)
      .map((e) => ({ seq: e.seq, text: describeEvent(e.event, { me, name }) }));
  }, [view, me]);
  // The shell mounts the panel only while it is on screen, so what it shows counts as read.
  const node = (
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
      drafts={drafts}
      onDraft={onDraft}
      className="shell-chat"
    />
  );
  return { unread: totalUnread(channel.chat, me, read), node };
}
