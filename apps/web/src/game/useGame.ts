// The live game channel (apps/server live.ts) as one React hook: the latest
// view, the deadlines, the server's clock offset, and `send` for commands.
// Reconnects with backoff when the socket drops (wifi blips, a server
// restart, a phone waking up). docs/m2-plan.md M2-6
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { PlayerCommand, PlayerView } from "@skimjob/engine";
import { asChatMessage, asDmNotice, chatReducer, EMPTY_CHAT, type ChatAction, type ChatMessage, type ChatRequest, type ChatState, type DmNotice } from "./chat";
import { formatCountdown, remainingMs, timerFor, type Timer } from "./hud";

/** A command as the client sends it: the server fills in `player` from the session. */
export type ClientCommand = PlayerCommand extends infer C ? (C extends PlayerCommand ? Omit<C, "player"> : never) : never;

export type Reply = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export type Connection = "connecting" | "open" | "reconnecting" | "signedOut";

export interface GameChannel {
  readonly view: PlayerView | null;
  readonly timers: readonly Timer[];
  /** server time − local time, ms: add it to Date.now() to read the server's clock. */
  readonly offset: number;
  readonly connection: Connection;
  readonly send: (cmd: ClientCommand) => Promise<Reply>;
  /** Crew chat, your DMs and others' DM notices (M2-8b). */
  readonly chat: ChatState;
  /** Posts a chat message or evidence card; replied to like a command. */
  readonly sendChat: (req: ChatRequest) => Promise<Reply>;
}

/** Waits before reconnect attempt n (0-based): 0.5 s, 1 s, 2 s, 4 s, then every 8 s. */
export const backoffMs = (attempt: number) => Math.min(8000, 500 * 2 ** attempt);
/** The server closes with this when the session signs out (live.ts CLOSE_SIGNED_OUT): don't retry. */
const CLOSE_SIGNED_OUT = 4401;

type Incoming =
  | { view: PlayerView; timers?: Timer[]; now?: number }
  | { ok: true; id?: string | number }
  | { rejected: true; reason: string; id?: string | number }
  | Record<string, unknown>;

/** The chat frame in a server message (`chat`, `dmNotice`, `chatHistory`), as a reducer action; null if it isn't one. */
export function chatActionOf(msg: Record<string, unknown>): ChatAction | null {
  if ("chat" in msg) {
    const message = asChatMessage(msg.chat);
    return message ? { type: "message", message } : null;
  }
  if ("dmNotice" in msg) {
    const notice = asDmNotice(msg.dmNotice);
    return notice ? { type: "notice", notice } : null;
  }
  if ("chatHistory" in msg && typeof msg.chatHistory === "object" && msg.chatHistory !== null) {
    const h = msg.chatHistory as { messages?: unknown; dmNotices?: unknown };
    const list = <T,>(xs: unknown, as: (x: unknown) => T | null): T[] => (Array.isArray(xs) ? xs.map(as).filter((x): x is T => x !== null) : []);
    return { type: "history", history: { messages: list<ChatMessage>(h.messages, asChatMessage), dmNotices: list<DmNotice>(h.dmNotices, asDmNotice) } };
  }
  return null;
}

export function socketUrl(gameId: string, loc: Pick<Location, "protocol" | "host"> = location): string {
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}/api/games/${encodeURIComponent(gameId)}/ws`;
}

export function useGame(gameId: string, enabled = true): GameChannel {
  const [view, setView] = useState<PlayerView | null>(null);
  const [timers, setTimers] = useState<readonly Timer[]>([]);
  const [offset, setOffset] = useState(0);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [chat, dispatchChat] = useReducer(chatReducer, EMPTY_CHAT);
  const socket = useRef<WebSocket | null>(null);
  const pending = useRef(new Map<string, (r: Reply) => void>());
  const nextId = useRef(1);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const failPending = () => {
      for (const resolve of pending.current.values()) resolve({ ok: false, reason: "the connection dropped; try again" });
      pending.current.clear();
    };
    const connect = () => {
      if (stopped) return;
      retry = null;
      const ws = new WebSocket(socketUrl(gameId));
      socket.current = ws;
      ws.onopen = () => {
        attempt = 0;
        setConnection("open");
      };
      ws.onmessage = (e) => {
        let msg: Incoming;
        try {
          msg = JSON.parse(String(e.data)) as Incoming;
        } catch {
          return;
        }
        if ("view" in msg && msg.view) {
          const m = msg as { view: PlayerView; timers?: Timer[]; now?: number };
          setView(m.view);
          setTimers(m.timers ?? []);
          if (typeof m.now === "number") setOffset(m.now - Date.now());
          return;
        }
        const chatAction = chatActionOf(msg as Record<string, unknown>);
        if (chatAction) return dispatchChat(chatAction);
        const id = "id" in msg ? String(msg.id) : null;
        const resolve = id ? pending.current.get(id) : undefined;
        if (!id || !resolve) return;
        pending.current.delete(id);
        if ("ok" in msg && msg.ok === true) resolve({ ok: true });
        else if ("rejected" in msg) resolve({ ok: false, reason: String(msg.reason) });
      };
      ws.onclose = (e) => {
        if (socket.current === ws) socket.current = null;
        failPending();
        if (stopped) return;
        if (e.code === CLOSE_SIGNED_OUT) return setConnection("signedOut");
        setConnection("reconnecting");
        retry = setTimeout(connect, backoffMs(attempt++));
      };
    };
    // Back online or back in front: try now rather than wait out the backoff.
    const now = () => {
      if (retry && !stopped) {
        clearTimeout(retry);
        connect();
      }
    };
    const onVisible = () => document.visibilityState === "visible" && now();
    window.addEventListener("online", now);
    document.addEventListener("visibilitychange", onVisible);
    connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      window.removeEventListener("online", now);
      document.removeEventListener("visibilitychange", onVisible);
      socket.current?.close();
      socket.current = null;
      failPending();
    };
  }, [gameId, enabled]);

  /** Sends `body` with a fresh id and resolves with the server's reply to it. */
  const request = useCallback((body: { cmd: ClientCommand } | { chat: ChatRequest }): Promise<Reply> => {
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.resolve({ ok: false, reason: "not connected; reconnecting" });
    const id = `c${nextId.current++}`;
    return new Promise<Reply>((resolve) => {
      pending.current.set(id, resolve);
      ws.send(JSON.stringify({ ...body, id }));
    });
  }, []);
  const send = useCallback((cmd: ClientCommand) => request({ cmd }), [request]);
  const sendChat = useCallback((chat: ChatRequest) => request({ chat }), [request]);

  return { view, timers, offset, connection, send, chat, sendChat };
}

/** The current time, re-rendering every `ms`. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** The countdown for deadline `key`, on the server's clock (`offset` = server − local). */
export function useCountdown(timers: readonly Timer[], key: string | null, offset: number): { text: string; ms: number; paused: boolean } | null {
  const now = useNow(500) + offset;
  const t = timerFor(timers, key);
  if (!t) return null;
  const ms = remainingMs(t, now);
  return { text: formatCountdown(ms), ms, paused: t.pausedAt !== null };
}
