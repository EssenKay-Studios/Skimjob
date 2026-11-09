// A modal sheet that rises from the bottom edge (design §15.6: bottom sheets on
// phones), on the shared Modal base: Esc and a tap outside close it, focus starts
// inside and goes back to the opener, the page behind is inert. The close button
// is the way to dismiss that needs no gesture; dragging the grip down dismisses
// it too (touch, pen and mouse, through pointer events).
import { useId, useRef, type PointerEvent, type ReactNode } from "react";
import { Close } from "./icons";
import { Modal } from "./Modal";
import { SketchFrame } from "./SketchFrame";

/** How far the grip is dragged down (px) before letting go dismisses the sheet. */
const DISMISS_DRAG = 80;

export interface BottomSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: ReactNode;
  readonly seed: string;
  readonly children: ReactNode;
}

/** Drag handlers for the grip: the sheet follows the finger, then goes or springs back. */
function useGripDrag(onClose: () => void) {
  const from = useRef<number | null>(null);
  const sheet = (e: PointerEvent) => e.currentTarget.closest<HTMLElement>(".bsheet__sheet");
  const drop = (e: PointerEvent) => {
    from.current = null;
    sheet(e)?.style.removeProperty("transform");
  };
  return {
    onPointerDown: (e: PointerEvent) => {
      from.current = e.clientY;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: PointerEvent) => {
      if (from.current !== null) sheet(e)?.style.setProperty("transform", `translateY(${Math.max(0, e.clientY - from.current)}px)`);
    },
    onPointerUp: (e: PointerEvent) => {
      const dragged = from.current === null ? 0 : e.clientY - from.current;
      drop(e);
      if (dragged >= DISMISS_DRAG) onClose();
    },
    onPointerCancel: drop,
  };
}

export function BottomSheet({ open, onClose, title, seed, children }: BottomSheetProps) {
  const titleId = useId();
  const grip = useGripDrag(onClose);
  return (
    <Modal open={open} onClose={onClose} className="bsheet" labelledBy={titleId}>
      <SketchFrame seed={seed} radius={22} shadow={0.55} className="bsheet__sheet">
        <span className="bsheet__grip" aria-hidden="true" {...grip} />
        <header className="bsheet__head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="bsheet__close" aria-label="Close" onClick={onClose}>
            <Close />
          </button>
        </header>
        <div className="bsheet__body">{children}</div>
      </SketchFrame>
    </Modal>
  );
}
