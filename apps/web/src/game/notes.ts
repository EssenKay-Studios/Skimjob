// The seat's own notes on the server (apps/server notes.ts, M2-10): the "last
// seen" seq for "while you were away" (design §13) and the private suspicion
// board (design §12.3). Neither goes over the live channel; both are read and
// written by this seat only.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { eventsSince, type PlayerId, type PlayerView } from "@skimjob/engine";
import { api, ApiError, sentence } from "../api";
import { recap, topSeq } from "./away";
import type { DescribeContext } from "./describeEvent";

export const SUSPICION_TAGS = ["trusted", "unsure", "suspicious"] as const;
export type SuspicionTag = (typeof SUSPICION_TAGS)[number];
export const TAG_LABELS: Readonly<Record<SuspicionTag, string>> = { trusted: "Trusted", unsure: "Unsure", suspicious: "Suspicious" };
/** Characters per note (the server's BOARD_NOTE_MAX_CHARS). */
export const NOTE_MAX_CHARS = 280;

export interface BoardMark {
  readonly tag: SuspicionTag | null;
  readonly note: string;
}
export type Board = Readonly<Record<PlayerId, BoardMark>>;

interface SeatNotes {
  readonly lastSeen: number;
  readonly board: Board;
}

/** The board and a way to change one mark; `error` if it couldn't be loaded. */
export interface BoardChannel {
  readonly board: Board | null;
  readonly error: string | null;
  /** Saves a mark (tag null and an empty note clears it). Resolves with the refusal, if any. */
  readonly save: (subject: PlayerId, mark: BoardMark) => Promise<string | null>;
}

export interface AwayChannel {
  /** The recap lines to show now (empty: nothing to show). */
  readonly lines: readonly string[];
  readonly dismiss: () => void;
}

const why = (e: unknown) => (e instanceof ApiError ? sentence(e.message) : "Something went wrong.");

/** Whether the page is in front. A hidden tab isn't "looking". */
function usePageVisible(): boolean {
  const [on, setOn] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const f = () => setOn(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", f);
    return () => document.removeEventListener("visibilitychange", f);
  }, []);
  return on;
}

/** How long the seen mark waits before it's sent (so a burst of events is one request). */
const SEEN_DEBOUNCE_MS = 1200;

/**
 * Both notes for this seat. The recap: on return (opening the game, or the tab
 * coming back to the front), what changed since the server's last-seen mark.
 * While the page is in front and no recap is up, the mark follows the view;
 * dismissing the recap marks everything seen. design §13
 */
export function useSeatNotes(gameId: string, view: PlayerView, ctx: DescribeContext): { away: AwayChannel; board: BoardChannel } {
  const top = topSeq(view);
  const visible = usePageVisible();
  /** The last seq seen (null: still loading or unknown); frozen while the recap is up or the page is hidden. */
  const [since, setSince] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sent = useRef(-1);
  const viewRef = useRef(view);
  viewRef.current = view;
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const linesFrom = useCallback((seq: number) => recap(eventsSince(viewRef.current, seq), viewRef.current, ctxRef.current), []);

  const markSeen = useCallback(
    (seq: number) => {
      if (seq <= sent.current) return;
      sent.current = seq;
      api<{ lastSeen: number }>("PATCH", `/games/${encodeURIComponent(gameId)}/notes/seen`, { seq }).catch(() => {
        sent.current = -1; // try again at the next change
      });
    },
    [gameId],
  );

  useEffect(() => {
    let live = true;
    api<SeatNotes>("GET", `/games/${encodeURIComponent(gameId)}/notes`).then(
      (n) => {
        if (!live) return;
        setBoard(n.board);
        sent.current = n.lastSeen;
        // Never opened before: nothing to catch up on.
        const seq = n.lastSeen < 0 ? topSeq(viewRef.current) : n.lastSeen;
        setSince(seq);
        setOpen(linesFrom(seq).length > 0);
      },
      (e: unknown) => live && setError(why(e)),
    );
    return () => {
      live = false;
    };
  }, [gameId, linesFrom]);

  // Back in front: anything new since the mark gets a recap.
  const wasVisible = useRef(visible);
  useEffect(() => {
    if (visible && !wasVisible.current && since !== null && linesFrom(since).length > 0) setOpen(true);
    wasVisible.current = visible;
  }, [visible, since, linesFrom]);

  // Looking at it: the mark follows the view.
  useEffect(() => {
    if (since === null || open || !visible || top <= since) return;
    setSince(top);
  }, [since, open, visible, top]);
  useEffect(() => {
    if (since === null || since <= sent.current) return;
    const t = setTimeout(() => markSeen(since), SEEN_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [since, markSeen]);

  const dismiss = useCallback(() => {
    setOpen(false);
    const seq = topSeq(viewRef.current);
    setSince(seq);
    markSeen(seq);
  }, [markSeen]);

  const lines = useMemo(() => (open && since !== null ? recap(eventsSince(view, since), view, ctx) : []), [open, since, view, ctx]);

  const save = useCallback(
    async (subject: PlayerId, mark: BoardMark) => {
      try {
        const r = await api<{ board: Board }>("PATCH", `/games/${encodeURIComponent(gameId)}/notes/board`, { subject, tag: mark.tag, note: mark.note });
        setBoard(r.board);
        setError(null);
        return null;
      } catch (e) {
        return why(e);
      }
    },
    [gameId],
  );

  return { away: { lines, dismiss }, board: { board, error, save } };
}
