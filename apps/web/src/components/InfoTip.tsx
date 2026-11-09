// <InfoTip>: the small "i" that opens one line of content text (design §15.6
// "Info on everything", §20.5). The line always comes from content, never from
// the caller. A 44 px button; a tap pins the tip, a mouse hover or keyboard
// focus previews it, Esc, the close button, a tap elsewhere or the "i" leaving the
// screen closes it; a scroll or resize only moves it along. The tip is a native
// popover, so it sits above sheets and is never clipped.
import { infoText, type InfoRef } from "@skimjob/content";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent } from "react";
import { Close } from "./icons";
import { SketchFrame } from "./SketchFrame";
import "./infotip.css";

/** How long the tip stays open after the pointer leaves, so the pointer can cross the gap onto it (WCAG 1.4.13). */
const GRACE_MS = 200;
const MARGIN = 8;
const GAP = 4;
const WIDTH = 260;
/** Closes the tip that is open now, if any. */
let openTip: (() => void) | undefined;

export function InfoTip({ info }: { readonly info: InfoRef }) {
  const entry = infoText(info);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const pinned = useRef(false);
  const leaving = useRef<number>(0);
  const [open, setOpen] = useState(false);

  const close = useCallback(() => {
    window.clearTimeout(leaving.current);
    pinned.current = false;
    setOpen(false);
  }, []);

  // Put the tip under the button (or above, when there is no room), inside the viewport.
  const place = useCallback(() => {
    const el = tip.current;
    const b = button.current;
    if (!el || !b) return;
    const r = b.getBoundingClientRect();
    const width = Math.min(WIDTH, window.innerWidth - 2 * MARGIN);
    // The width first: the height depends on how the line wraps.
    el.style.width = `${width}px`;
    const height = el.offsetHeight;
    const below = r.bottom + GAP;
    const wanted = below + height > window.innerHeight - MARGIN && r.top - GAP - height >= MARGIN ? r.top - GAP - height : below;
    const top = Math.max(MARGIN, Math.min(wanted, window.innerHeight - height - MARGIN));
    el.style.left = `${Math.min(Math.max(r.left + r.width / 2 - width / 2, MARGIN), window.innerWidth - width - MARGIN)}px`;
    el.style.top = `${top}px`;
  }, []);

  useLayoutEffect(() => {
    const el = tip.current;
    if (!el) return;
    if (!open) {
      if (el.matches(":popover-open")) el.hidePopover();
      return;
    }
    el.showPopover();
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    // One tip at a time: opening this one closes the one before (say, still in its hover grace).
    openTip?.();
    openTip = close;
    const outside = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    // A scroll (any element, the focus scroll included) or a resize moves the tip with its "i", once a frame.
    let frame = 0;
    const follow = () => {
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), place()));
    };
    // The "i" scrolled or clipped fully out of view takes its tip with it.
    const seen = new IntersectionObserver(([e]) => e && !e.isIntersecting && close());
    if (button.current) seen.observe(button.current);
    // Esc closes the tip only, not the sheet it may sit in, wherever the focus is.
    const escape = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (root.current?.contains(document.activeElement)) button.current?.focus();
      close();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    // The visual viewport can settle after the window's resize (a zoomed-out page springing back): follow that too.
    window.visualViewport?.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
      window.visualViewport?.removeEventListener("resize", follow);
      cancelAnimationFrame(frame);
      seen.disconnect();
      if (openTip === close) openTip = undefined;
    };
  }, [open, close, place]);

  useEffect(() => () => window.clearTimeout(leaving.current), []);

  if (!entry) return null;

  // Focus moving to another control closes it; a tap on the tip's own text (no new focus) does not.
  const onBlur = (e: FocusEvent) => {
    const to = e.relatedTarget as Node | null;
    if (to && !root.current?.contains(to)) close();
  };
  const mouse = (e: PointerEvent) => e.pointerType === "mouse";

  return (
    <span
      ref={root}
      className="infotip"
      onBlur={onBlur}
      onPointerEnter={(e) => {
        if (!mouse(e)) return;
        window.clearTimeout(leaving.current);
        setOpen(true);
      }}
      onPointerLeave={(e) => {
        if (!mouse(e) || pinned.current) return;
        leaving.current = window.setTimeout(close, GRACE_MS);
      }}
    >
      <button
        ref={button}
        type="button"
        className="infotip__btn"
        aria-label={`About ${entry.name}`}
        aria-expanded={open}
        aria-controls={id}
        aria-describedby={`${id}-text`}
        onFocus={(e) => {
          // Focus coming back from the tip's own close button must not reopen it.
          if (root.current?.contains(e.relatedTarget as Node | null) || !e.currentTarget.matches(":focus-visible")) return;
          window.clearTimeout(leaving.current);
          setOpen(true);
        }}
        onClick={() => {
          if (open && pinned.current) return close();
          window.clearTimeout(leaving.current);
          pinned.current = true;
          setOpen(true);
        }}
      >
        <span className="infotip__i" aria-hidden="true">
          i
        </span>
      </button>
      <div ref={tip} id={id} className="infotip__pop" popover="manual" role="note" aria-label={entry.name}>
        <SketchFrame seed={`infotip-${entry.name}`} radius={10} shadow={0.38} className="infotip__tip">
          <header className="infotip__head">
            <h3>{entry.name}</h3>
            <button type="button" className="infotip__close" aria-label="Close" onClick={() => {
                close();
                button.current?.focus();
              }}>
              <Close />
            </button>
          </header>
          <p id={`${id}-text`}>{entry.text}</p>
        </SketchFrame>
      </div>
    </span>
  );
}
