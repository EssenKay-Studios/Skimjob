// The seat's own notes on the server (apps/server notes.ts, M2-10): the "last
// seen" seq for "while you were away" (design §13) and the private board: a
// note per player and the case board's pins (design §15.3). None of it goes
// over the live channel; it is read and written by this seat only.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { eventsSince, type PlayerId, type PlayerView } from "@skimjob/engine";
import { api, ApiError, sentence } from "../api";
import { recap, topSeq } from "./away";
import { pinSync, type PinSync } from "./pinSync";
import type { DescribeContext } from "./describeEvent";

/** Characters per note (the server's BOARD_NOTE_MAX_CHARS). */
export const NOTE_MAX_CHARS = 280;

/** Your note on each player you wrote one on (design §15.3). */
export type Board = Readonly<Record<PlayerId, string>>;

interface SeatNotes {
  readonly lastSeen: number;
  readonly board: Board;
  readonly pins: readonly string[];
}

/** Your notes and a way to change one; `board` is null while loading, with `error` if it couldn't load. */
export interface BoardChannel {
  readonly board: Board | null;
  readonly error: string | null;
  /** Saves a note (an empty one clears it). Resolves with the refusal, if any. */
  readonly save: (subject: PlayerId, note: string) => Promise<string | null>;
}

export interface AwayChannel {
  /** The recap lines to show now (empty: nothing to show). */
  readonly lines: readonly string[];
  readonly dismiss: () => void;
}

/** The seat's notes, loaded once per game page and shared by the recap, the board and the pins. */
export interface NotesLoad {
  readonly notes: SeatNotes | null;
  readonly error: string | null;
}

export function useSeatNotes(gameId: string): NotesLoad {
  const [load, setLoad] = useState<NotesLoad>({ notes: null, error: null });
  useEffect(() => {
    let live = true;
    api<SeatNotes>("GET", `/games/${encodeURIComponent(gameId)}/notes`).then(
      (notes) => live && setLoad({ notes, error: null }),
      (e: unknown) => live && setLoad({ notes: null, error: why(e) }),
    );
    return () => {
      live = false;
    };
  }, [gameId]);
  return load;
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
/** After coming back (load, or the tab back in front), how long news still opens the recap rather than being marked seen: the view may arrive late (a reconnect). */
const CATCH_UP_MS = 4000;
/** A tab hidden for less than this isn't "away" (a quick switch, or a browser shuffling tabs): no recap when it's back. */
const AWAY_MIN_HIDDEN_MS = 10_000;
/** Retry waits after a failed seen mark: 2 s, 4 s, … at most a minute. */
export const seenRetryMs = (failures: number) => Math.min(60_000, 1000 * 2 ** failures);

/**
 * The recap's state (design §13). `since` is the last seq seen, frozen while
 * the page is hidden, while catching up after a return, and while the recap
 * is up; only otherwise does it follow the view (and so get marked seen).
 */
export interface AwayState {
  /** Null until the server's mark has loaded. */
  readonly since: number | null;
  readonly open: boolean;
  /** While open: the recap covers (since, upTo], so it doesn't keep changing with live events. */
  readonly upTo: number | null;
  /** Just came back: news opens the recap instead of being marked seen. */
  readonly catchingUp: boolean;
}
export type AwayInput =
  /** The server's mark; `first`: the seat never opened the game, so there's nothing to catch up on. */
  | { readonly type: "loaded"; readonly since: number; readonly first: boolean }
  | { readonly type: "returned" }
  | { readonly type: "caughtUp" }
  | { readonly type: "dismiss"; readonly top: number }
  /** A render: is the page in front, the view's top seq, and whether anything since `since` is worth a recap. */
  | { readonly type: "tick"; readonly visible: boolean; readonly top: number; readonly news: boolean };

export const AWAY_START: AwayState = { since: null, open: false, upTo: null, catchingUp: true };

export function awayStep(s: AwayState, input: AwayInput): AwayState {
  switch (input.type) {
    case "loaded":
      return { ...s, since: input.since, catchingUp: !input.first };
    case "returned":
      return s.catchingUp ? s : { ...s, catchingUp: true };
    case "caughtUp":
      return s.catchingUp ? { ...s, catchingUp: false } : s;
    case "dismiss":
      return { since: Math.max(s.since ?? -1, input.top), open: false, upTo: null, catchingUp: false };
    case "tick": {
      if (s.since === null || !input.visible || s.open) return s;
      if (input.news && s.catchingUp) return { ...s, open: true, upTo: input.top };
      if (s.catchingUp || input.top <= s.since) return s;
      return { ...s, since: input.top };
    }
  }
}

/**
 * The seen mark on the server: the latest wanted seq, sent debounced, one
 * request at a time, retried with backoff after a failure (not on a refusal).
 */
function useSeenMark(gameId: string): (seq: number, now?: boolean) => void {
  const want = useRef(-1);
  const saved = useRef(-1);
  const failures = useRef(0);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A refusal (4xx): stop for good. */
  const stopped = useRef(false);
  const unmounted = useRef(false);
  const flushRef = useRef<() => void>(() => {});
  const schedule = useCallback((ms: number) => {
    if (timer.current || stopped.current || unmounted.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      flushRef.current();
    }, ms);
  }, []);
  flushRef.current = () => {
    const seq = want.current;
    if (busy.current || seq <= saved.current || stopped.current || unmounted.current) return;
    busy.current = true;
    api<{ lastSeen: number }>("PATCH", `/games/${encodeURIComponent(gameId)}/notes/seen`, { seq })
      .then(
        (r) => {
          saved.current = Math.max(saved.current, seq, r.lastSeen);
          failures.current = 0;
        },
        (e: unknown) => {
          // A refusal (not signed in, not seated) won't get better by asking again.
          if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429) stopped.current = true;
          failures.current++;
        },
      )
      .finally(() => {
        busy.current = false;
        if (want.current > saved.current) schedule(failures.current > 0 ? seenRetryMs(failures.current) : 0);
      });
  };
  useEffect(() => {
    // (Re)mounted (StrictMode mounts twice): sending again is fine; a refusal stays a refusal.
    unmounted.current = false;
    if (want.current > saved.current) schedule(0);
    return () => {
      unmounted.current = true;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [schedule]);
  return useCallback(
    (seq: number, now = false) => {
      if (seq <= want.current) return;
      want.current = seq;
      if (now && timer.current && failures.current === 0) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      schedule(failures.current > 0 ? seenRetryMs(failures.current) : now ? 0 : SEEN_DEBOUNCE_MS);
    },
    [schedule],
  );
}

/**
 * "While you were away" for this seat (design §13). The recap shows on return
 * (opening the game, or the tab back in front) when something changed since the
 * server's last-seen mark. Only while the page is in front, after catching up,
 * with no recap up, does the mark follow the view; dismissing marks all seen.
 *
 * Its state changes with every view, so keep it in a small component of its own
 * (Game.tsx `Away`): in the board's component it re-rendered the whole game
 * screen a second time per view, which made the page sluggish under load.
 */
export function useAwayRecap(gameId: string, view: PlayerView, ctx: DescribeContext, notes: NotesLoad): AwayChannel {
  const top = topSeq(view);
  const visible = usePageVisible();
  const [state, dispatch] = useReducer(awayStep, AWAY_START);
  const markSeen = useSeenMark(gameId);
  const viewRef = useRef(view);
  viewRef.current = view;

  const lastSeen = notes.notes?.lastSeen ?? null;
  useEffect(() => {
    // Never opened before: nothing to catch up on. No mark, no recap.
    if (lastSeen !== null) dispatch({ type: "loaded", since: lastSeen < 0 ? topSeq(viewRef.current) : lastSeen, first: lastSeen < 0 });
  }, [lastSeen]);

  // Back in front after a real absence: catch up again. Catching up ends a moment after the mark has loaded with the page in front.
  const hiddenAt = useRef<number | null>(visible ? null : Date.now());
  useEffect(() => {
    if (!visible) {
      hiddenAt.current ??= Date.now();
      return;
    }
    const since = hiddenAt.current;
    hiddenAt.current = null;
    if (since !== null && Date.now() - since >= AWAY_MIN_HIDDEN_MS) dispatch({ type: "returned" });
  }, [visible]);
  const loaded = state.since !== null;
  useEffect(() => {
    if (!state.catchingUp || !visible || !loaded) return;
    const t = setTimeout(() => dispatch({ type: "caughtUp" }), CATCH_UP_MS);
    return () => clearTimeout(t);
  }, [state.catchingUp, visible, loaded]);

  // Open: the recap is frozen at what was new when it opened (live events show on the screen anyway).
  const upTo = state.open ? state.upTo : null;
  const lines = useMemo(
    () => (state.since === null ? [] : recap(eventsSince(view, state.since).filter((e) => upTo === null || e.seq <= upTo), view, ctx)),
    [state.since, upTo, view, ctx],
  );
  const news = lines.length > 0;
  useEffect(() => dispatch({ type: "tick", visible, top, news }), [visible, top, news, state.since, state.catchingUp]);
  useEffect(() => {
    // Only what the player has looked at (followed in front, or dismissed) is marked seen.
    if (state.since !== null && !state.open) markSeen(state.since);
  }, [state.since, state.open, markSeen]);

  const dismiss = useCallback(() => {
    const seq = topSeq(viewRef.current);
    dispatch({ type: "dismiss", top: seq });
    markSeen(seq, true);
  }, [markSeen]);

  return { lines: state.open ? lines : [], dismiss };
}

/** This seat's notes on the others (design §15.3): loaded once, changed only by `save`. */
export function useSeatBoard(gameId: string, notes: NotesLoad): BoardChannel {
  const [saved, setBoard] = useState<Board | null>(null);
  const board = saved ?? notes.notes?.board ?? null;
  const error = board === null ? notes.error : null;
  const save = useCallback(
    async (subject: PlayerId, note: string) => {
      try {
        const r = await api<{ board: Board }>("PATCH", `/games/${encodeURIComponent(gameId)}/notes/board`, { subject, note });
        setBoard(r.board);
        return null;
      } catch (e) {
        return why(e);
      }
    },
    [gameId],
  );
  return useMemo(() => ({ board, error, save }), [board, error, save]);
}

/** The case board's pins (design §15.4): loaded once, private to this seat, saved as one list. */
export interface PinsChannel {
  readonly pins: ReadonlySet<string>;
  /** Null until loaded; pinning waits for the load, so it can't overwrite saved pins. */
  readonly ready: boolean;
  readonly error: string | null;
  readonly toggle: (id: string) => void;
}

export function usePins(gameId: string, notes: NotesLoad): PinsChannel {
  const [list, setList] = useState<readonly string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sync = useRef<PinSync | null>(null);
  const loaded = notes.notes?.pins ?? null;
  useEffect(() => {
    if (loaded === null) return;
    let live = true;
    const url = `/games/${encodeURIComponent(gameId)}/notes`;
    sync.current = pinSync(
      { put: (pins) => api<unknown>("PUT", `${url}/pins`, { pins }).then(() => undefined), load: () => api<SeatNotes>("GET", url).then((r) => r.pins) },
      loaded,
      (l) => live && setList(l),
      (e) => live && setError(why(e)),
    );
    setList(loaded);
    return () => {
      live = false;
    };
  }, [gameId, loaded]);
  const toggle = useCallback((id: string) => {
    setError(null);
    sync.current?.toggle(id);
  }, []);
  const pins = useMemo(() => new Set(list ?? []), [list]);
  const shown = error ?? (list === null ? notes.error : null);
  return useMemo(() => ({ pins, ready: list !== null, error: shown, toggle }), [pins, list, shown, toggle]);
}
