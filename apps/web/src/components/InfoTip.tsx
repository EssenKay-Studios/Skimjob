// <InfoTip>: the small "i" that opens one line of content text (design §15.6
// "Info on everything", §20.5). The line always comes from content, never from
// the caller. A 44 px button; a tap pins the tip, a mouse hover or keyboard
// focus previews it, Esc, the close button, a tap elsewhere or a scroll closes
// it. The tip is a native popover, so it sits above sheets and is never clipped.
import { infoText, type InfoRef } from "@skimjob/content";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent } from "react";
import { Close } from "./icons";
import { SketchFrame } from "./SketchFrame";
import "./infotip.css";

const MARGIN = 8;
const GAP = 4;
const WIDTH = 260;

export function InfoTip({ info }: { readonly info: InfoRef }) {
  const entry = infoText(info);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const pinned = useRef(false);
  const [open, setOpen] = useState(false);

  const close = useCallback(() => {
    pinned.current = false;
    setOpen(false);
  }, []);

  // Show the popover and put it under the button (or above, when there is no room), inside the viewport.
  useLayoutEffect(() => {
    const el = tip.current;
    const b = button.current;
    if (!el || !b) return;
    if (!open) {
      if (el.matches(":popover-open")) el.hidePopover();
      return;
    }
    el.showPopover();
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
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", close, true);
    // Only a new width closes it: a phone's keyboard or address bar changes the height alone.
    let width = window.innerWidth;
    const resized = () => {
      if (window.innerWidth !== width) close();
    };
    window.addEventListener("resize", resized);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", resized);
    };
  }, [open, close]);

  if (!entry) return null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !open) return;
    // Esc closes the tip only, not the sheet it may sit in.
    e.preventDefault();
    e.stopPropagation();
    close();
    button.current?.focus();
  };
  const onBlur = (e: FocusEvent) => {
    if (!root.current?.contains(e.relatedTarget as Node | null)) close();
  };
  const mouse = (e: PointerEvent) => e.pointerType === "mouse";

  return (
    <span
      ref={root}
      className="infotip"
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      onPointerEnter={(e) => mouse(e) && setOpen(true)}
      onPointerLeave={(e) => mouse(e) && !pinned.current && setOpen(false)}
    >
      <button
        ref={button}
        type="button"
        className="infotip__btn"
        aria-label={`About ${entry.name}`}
        aria-expanded={open}
        aria-controls={id}
        onFocus={(e) => {
          // Focus coming back from the tip's own close button must not reopen it.
          if (!root.current?.contains(e.relatedTarget as Node | null) && e.currentTarget.matches(":focus-visible")) setOpen(true);
        }}
        onClick={() => {
          if (open && pinned.current) return close();
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
          <p>{entry.text}</p>
        </SketchFrame>
      </div>
    </span>
  );
}
