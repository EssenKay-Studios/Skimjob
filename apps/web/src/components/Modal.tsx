// The one modal base under DialogSheet and BottomSheet. A native <dialog>: Esc,
// the focus trap, the inert page behind and the focus going back to the opener
// come from the browser. This adds the tap outside (on the dialog box itself,
// which the sheets stretch over the viewport), the page scroll lock, and the
// order of nested modals (the vote window opens over a bottom sheet).
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/** How many modals are open: the page scroll stays locked until the last one closes. Every increment has its cleanup in the same effect, so React's StrictMode double run (mount, clean up, mount) still balances. */
let openCount = 0;

/** False inside a modal that is not up yet: a dialog opened before the one it sits in would land beneath it in the top layer. */
const ParentUp = createContext(true);

export interface ModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly className: string;
  /** Id of the dialog's heading. */
  readonly labelledBy: string;
  readonly children: ReactNode;
}

export function Modal({ open, onClose, className, labelledBy, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const parentUp = useContext(ParentUp);
  const [up, setUp] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (!d || !parentUp) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
    setUp(open);
  }, [open, parentUp]);
  useEffect(() => {
    if (!open) return;
    openCount++;
    document.documentElement.classList.add("modal-open");
    return () => {
      if (--openCount === 0) document.documentElement.classList.remove("modal-open");
    };
  }, [open]);
  return (
    <ParentUp.Provider value={up}>
      <dialog
        ref={ref}
        className={className}
        aria-labelledby={labelledBy}
        // React passes close and cancel up the component tree: a dialog opened inside this one (the vote window over a sheet) must not close it too.
        onClose={(e) => e.target === e.currentTarget && onClose()}
        onCancel={(e) => {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          onClose();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {open && children}
      </dialog>
    </ParentUp.Provider>
  );
}
