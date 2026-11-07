// A modal sheet that rises from the bottom edge (design §15.6: bottom sheets on
// phones). Native <dialog>: Esc and a tap outside close it, focus starts inside
// and goes back to the opener, the page behind is inert. The close button is the
// only way to dismiss that needs no gesture.
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Close } from "./icons";
import { SketchFrame } from "./SketchFrame";

export interface BottomSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: ReactNode;
  readonly seed: string;
  readonly children: ReactNode;
}

export function BottomSheet({ open, onClose, title, seed, children }: BottomSheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="bsheet"
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <SketchFrame seed={seed} radius={22} shadow={0.55} className="bsheet__sheet">
          <span className="bsheet__grip" aria-hidden="true" />
          <header className="bsheet__head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="bsheet__close" aria-label="Close" onClick={onClose}>
              <Close />
            </button>
          </header>
          <div className="bsheet__body">{children}</div>
        </SketchFrame>
      )}
    </dialog>
  );
}
